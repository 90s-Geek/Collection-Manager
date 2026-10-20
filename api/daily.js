// api/daily.js
// Set of the Day + Part of the Day, picked on the server.
//
// The browser used to make the pick itself: a catalog-size lookup, a page
// of candidates, then one Rebrickable call per theme or part category on
// that page — 10–20 calls in a burst, which is what tripped the rate limit.
// This route does the same date-seeded math server-side, resolves names
// from one bulk theme/category list it keeps in memory, and returns just
// the finished pick.
//
// Browser usage (see fetchDailyPick() in search.js):
//   /api/daily?kind=sotd&date=2026-10-19&spin=0
//   /api/daily?kind=potd&date=2026-10-19&spin=2
//
// date is the visitor's LOCAL date, so the pick still flips at your
// midnight, not UTC's. A given kind+date+spin always gives the same answer,
// so Vercel's CDN caches each one: the first page load of the day does the
// work and every reload after that is a single cached response.
//
// Requires a signed-in Supabase session (X-Auth-Token header, see _auth.js).

import { requireUser } from './_auth.js';

const RB_BASE = 'https://rebrickable.com/api/v3/';

// Must match the lists and numbers in search.js so the browser fallback
// and the server agree on what counts as a valid pick.
const SOTD = {
    filter: 'min_parts=50',
    pageSize: 10,
    attempts: 3,
    fallbackPages: 200,
    exclude: [
        'bulk bricks', 'bulk', 'service packs', 'znap', 'scala accessories',
        'supplemental', 'educational', 'dacta', 'individual elements',
        'storage', 'quatro', 'duplo accessories', 'soft bricks'
    ]
};
const POTD = {
    pageSize: 15,
    attempts: 5,
    fallbackPages: 300,
    exclude: [
        'sticker', 'instructions', 'catalog', 'box', 'gear',
        'duplo', 'primo', 'quatro', 'book'
    ]
};

const DAY_MS  = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// Same origin check as api/rebrickable.js
const ALLOWED_ORIGINS = ['https://www.90sgeek.org', 'https://90sgeek.org'];
function fromOwnSite(req) {
    if (req.headers['sec-fetch-site'] === 'same-origin') return true;
    const origin  = req.headers.origin || '';
    const referer = req.headers.referer || '';
    return ALLOWED_ORIGINS.includes(origin) ||
           ALLOWED_ORIGINS.some(o => referer === o || referer.startsWith(o + '/'));
}

// --- Warm-instance memory ---
// Lost on a cold start, which just costs a couple of extra calls.
const mem = {
    themes:   { at: 0, byId: new Map() },   // theme_id -> name
    cats:     { at: 0, byId: new Map() },   // part_cat_id -> name
    counts:   {}                            // 'sets' | 'parts' -> { at, count }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One Rebrickable call, retried after a pause if we hit the rate limit
async function rb(pathOrUrl, apiKey) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : RB_BASE + pathOrUrl;
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
            headers: { Authorization: `key ${apiKey}`, Accept: 'application/json' }
        });
        if (res.status === 429) {
            const wait = Math.min(Number(res.headers.get('retry-after')) * 1000 || 1100 * (attempt + 1), 3000);
            await sleep(wait);
            continue;
        }
        if (!res.ok) throw new Error(`Rebrickable ${res.status} on ${url.replace(RB_BASE, '')}`);
        return res.json();
    }
    throw new Error('Rebrickable rate limit');
}

// Every theme (or part category) in one or two calls instead of one per id
async function loadNameList(slot, path, apiKey) {
    if (slot.byId.size && Date.now() - slot.at < DAY_MS) return slot.byId;
    const byId = new Map();
    let next = `${path}?page_size=1000`;
    while (next) {
        const data = await rb(next, apiKey);
        for (const row of data.results || []) byId.set(row.id, row.name);
        next = data.next || null;
    }
    if (byId.size) { slot.byId = byId; slot.at = Date.now(); }
    return slot.byId;
}

// A theme too new for the cached list gets looked up on its own
async function themeName(id, apiKey) {
    const themes = await loadNameList(mem.themes, 'lego/themes/', apiKey);
    if (themes.has(id)) return themes.get(id);
    try {
        const t = await rb(`lego/themes/${id}/`, apiKey);
        if (t?.name) themes.set(id, t.name);
        return t?.name || 'Unknown';
    } catch { return 'Unknown'; }
}

async function categoryName(id, apiKey) {
    const cats = await loadNameList(mem.cats, 'lego/part_categories/', apiKey);
    return cats.get(id) || 'Unknown';
}

// How many pages the catalog listing has (re-checked weekly)
async function pageCount(key, path, filter, pageSize, fallback, apiKey) {
    const hit = mem.counts[key];
    if (hit && Date.now() - hit.at < WEEK_MS) return Math.ceil(hit.count / pageSize);
    try {
        const data = await rb(`${path}?page_size=1${filter ? '&' + filter : ''}`, apiKey);
        if (!(data.count > 0)) throw new Error();
        mem.counts[key] = { at: Date.now(), count: data.count };
        return Math.ceil(data.count / pageSize);
    } catch {
        return fallback;
    }
}

// Same generator as search.js: FNV-1a hash of the seed into mulberry32,
// so a date + spin always lands on the same pick.
function seededRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const isExcluded = (name, list) => !!name && list.some(ex => name.toLowerCase().includes(ex));

async function pickSet(date, spin, apiKey) {
    const totalPages = await pageCount('sets', 'lego/sets/', SOTD.filter, SOTD.pageSize, SOTD.fallbackPages, apiKey);
    const rand = seededRandom(`${date}|sotd|${spin}`);
    let lastErr = null;

    for (let attempt = 0; attempt < SOTD.attempts; attempt++) {
        const page = 1 + Math.floor(rand() * totalPages);
        const pick = Math.floor(rand() * SOTD.pageSize);
        try {
            const data = await rb(`lego/sets/?page=${page}&page_size=${SOTD.pageSize}&${SOTD.filter}&ordering=set_num`, apiKey);
            const candidates = data.results || [];
            if (!candidates.length) throw new Error('No sets returned');

            const named = [];
            for (const s of candidates) named.push({ ...s, theme_name: await themeName(s.theme_id, apiKey) });
            const valid = named.filter(s => !isExcluded(s.theme_name, SOTD.exclude));
            if (!valid.length) throw new Error('No valid sets after filtering');

            const s = valid[pick % valid.length];
            return {
                set_num: s.set_num, name: s.name, year: s.year, num_parts: s.num_parts,
                theme_id: s.theme_id, theme_name: s.theme_name, set_img_url: s.set_img_url
            };
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No set found');
}

async function pickPart(date, spin, apiKey) {
    const totalPages = await pageCount('parts', 'lego/parts/', '', POTD.pageSize, POTD.fallbackPages, apiKey);
    const rand = seededRandom(`${date}|potd|${spin}`);
    let lastErr = null;

    for (let attempt = 0; attempt < POTD.attempts; attempt++) {
        const page = 1 + Math.floor(rand() * totalPages);
        const pick = Math.floor(rand() * POTD.pageSize);
        try {
            const data = await rb(`lego/parts/?page=${page}&page_size=${POTD.pageSize}&ordering=part_num`, apiKey);
            const candidates = (data.results || []).filter(p => p.part_img_url);
            if (!candidates.length) throw new Error('No parts with images on this page');

            const named = [];
            for (const p of candidates) named.push({ ...p, category_name: await categoryName(p.part_cat_id, apiKey) });
            const valid = named.filter(p => !isExcluded(p.category_name, POTD.exclude));
            if (!valid.length) throw new Error('No valid parts after filtering');

            const p = valid[pick % valid.length];
            return {
                part_num: p.part_num, name: p.name, part_url: p.part_url,
                part_img_url: p.part_img_url, part_cat_id: p.part_cat_id, category_name: p.category_name
            };
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No part found');
}

// Only today-ish dates (any time zone), so the cache can't be filled with junk
function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const t = Date.parse(`${s}T12:00:00Z`);
    return !isNaN(t) && Math.abs(t - Date.now()) <= 2 * DAY_MS;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!fromOwnSite(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!(await requireUser(req, res))) return;

    const { kind, date } = req.query;
    const spin = Number(req.query.spin ?? 0);
    if ((kind !== 'sotd' && kind !== 'potd') || !validDate(date) ||
        !Number.isInteger(spin) || spin < 0 || spin > 500) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(400).json({ error: 'Invalid request' });
    }

    const apiKey = process.env.REBRICKABLE_API_KEY;
    if (!apiKey) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(500).json({ error: 'REBRICKABLE_API_KEY not configured' });
    }

    try {
        const body = kind === 'sotd'
            ? { set:  await pickSet(date, spin, apiKey) }
            : { part: await pickPart(date, spin, apiKey) };
        // The answer for this date+spin never changes, so cache it at the
        // edge for two days (covers every time zone's version of "today").
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=172800');
        return res.status(200).json(body);
    } catch (e) {
        console.error(`daily ${kind} ${date} #${spin}:`, e.message);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(502).json({ error: 'Could not pick from Rebrickable' });
    }
}
