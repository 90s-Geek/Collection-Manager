// api/rebrickable.js
// Server-side proxy for the Rebrickable API so the API key never reaches
// the browser. The key comes from the Vercel environment variable
// REBRICKABLE_API_KEY.
//
// Browser usage (see rebrickableFetch() in core.js):
//   /api/rebrickable?path=lego/sets/10305-1/
//   /api/rebrickable?path=lego/sets/&search=castle&page_size=20
//
// Requires a signed-in Supabase session (X-Auth-Token header, see _auth.js).

import { requireUser } from './_auth.js';

// Only the catalog endpoints the site uses — nothing account-related
const ALLOWED_PATH = /^lego\/(sets|themes|parts|part_categories|minifigs|colors)(\/[A-Za-z0-9._-]+)*\/?$/;

// Requests must come from the site itself. This stops other websites from
// using the proxy through visitors' browsers. The sign-in check below is
// the real lock, since a script can fake these headers.
const ALLOWED_ORIGINS = ['https://www.90sgeek.org', 'https://90sgeek.org'];

function fromOwnSite(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true;
  const origin  = req.headers.origin || '';
  const referer = req.headers.referer || '';
  return ALLOWED_ORIGINS.includes(origin) ||
         ALLOWED_ORIGINS.some(o => referer === o || referer.startsWith(o + '/'));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!fromOwnSite(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!(await requireUser(req, res))) return;

  const { path, ...params } = req.query;
  if (typeof path !== 'string' || path.includes('..') || !ALLOWED_PATH.test(path)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const apiKey = process.env.REBRICKABLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'REBRICKABLE_API_KEY not configured' });

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => qs.append(k, item));
    else if (v != null) qs.append(k, v);
  }
  const cleanPath = path.endsWith('/') ? path : path + '/';
  const url = `https://rebrickable.com/api/v3/${cleanPath}${qs.toString() ? '?' + qs.toString() : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `key ${apiKey}`, Accept: 'application/json' }
    });
    const body = await upstream.text();

    // Catalog data barely changes: let Vercel's CDN cache good responses for a
    // day (and serve a stale copy for up to a week while it refreshes). Repeat
    // lookups then never reach Rebrickable or count against the rate limit.
    res.setHeader('Cache-Control', upstream.ok
      ? 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
      : 'no-store');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.status(upstream.status).send(body);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Could not reach Rebrickable' });
  }
}
