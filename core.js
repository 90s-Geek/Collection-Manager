// ============================================================
// core.js — shared across index.html, collection.html, wantlist.html
// Config, Supabase client, toast/nav UI, formatting helpers,
// filter-state persistence, retail price cache, and the shared
// image lightbox + item detail modal (used by collection & wantlist).
// ============================================================
// --- Active nav link ---
document.querySelectorAll('.nav a').forEach(a => {
    if (a.href === location.href || a.pathname === location.pathname) {
        a.classList.add('active');
    }
});

// --- CONFIGURATION ---
const REBRICKABLE_API_KEY = '05a143eb0b36a4439e8118910912d050';
const SUPABASE_URL = 'https://sgmibyooymrocvojchxu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnbWlieW9veW1yb2N2b2pjaHh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzk0OTYsImV4cCI6MjA4NzExNTQ5Nn0.nLXsVr6mvsCQJijHsO2wkw49e0J4JZ-2oiLTpKZGmu0';

// --- Retail Price Cache (Brickset) ---
// Keyed by set_num → retail price in USD (or null if unavailable)
const retailPriceCache = {};

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentSet = null;

// --- Search pagination state ---
function showToast(message, type = 'success') {
    // type: 'success' | 'error' | 'warning' | 'info'
    const colors = {
        success: { bg: 'rgba(0,255,136,0.08)',  border: 'rgba(0,255,136,0.35)',  text: '#00ff88', dot: '#00ff88' },
        error:   { bg: 'rgba(255,68,102,0.08)', border: 'rgba(255,68,102,0.35)', text: '#ff4466', dot: '#ff4466' },
        warning: { bg: 'rgba(255,183,48,0.08)', border: 'rgba(255,183,48,0.35)', text: '#ffb730', dot: '#ffb730' },
        info:    { bg: 'rgba(0,229,255,0.08)',  border: 'rgba(0,229,255,0.35)',  text: '#00e5ff', dot: '#00e5ff' },
    };
    const c = colors[type] || colors.info;

    const container = document.getElementById('toast-container') || createToastContainer();

    const toast = document.createElement('div');
    toast.style.cssText = `
        display:flex;align-items:center;gap:10px;
        background:#101610;border:1px solid ${c.border};color:${c.text};
        padding:11px 16px;font-family:'JetBrains Mono','Courier New',monospace;font-size:0.78em;
        box-shadow:0 4px 24px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.03);
        border-radius:8px;
        opacity:0;transform:translateX(14px);
        transition:opacity 0.22s,transform 0.22s;
        pointer-events:none;line-height:1.4;max-width:300px;word-break:break-word;
    `;
    const dot = document.createElement('span');
    dot.style.cssText = `
        width:6px;height:6px;border-radius:50%;
        background:${c.dot};flex-shrink:0;
        box-shadow:0 0 6px ${c.dot};
    `;
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(dot);
    toast.appendChild(text);
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });
    });

    // Animate out after delay
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(14px)';
        setTimeout(() => toast.remove(), 280);
    }, 3400);
}

function createToastContainer() {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.style.cssText = `
        position:fixed;bottom:24px;right:24px;
        display:flex;flex-direction:column;gap:8px;
        z-index:9999;pointer-events:none;
    `;
    document.body.appendChild(el);
    return el;
}

// --- Escape key closes any open modal or lightbox ---
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Don't close import modal if actively importing
    const importModal = document.getElementById('import-modal');
    if (importModal && importModal.dataset.importing) return;
    closeLightbox();
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
});

// --- Quick Links (single source of truth for all pages) ---
const QUICK_LINKS = [
    { label: 'eBay',       url: 'https://www.ebay.com/sch/i.html?_nkw=lego' },
    { label: 'Rebrickable', url: 'https://rebrickable.com' },
    { label: 'BrickLink',  url: 'https://www.bricklink.com' },
    { label: 'BrickOwl',    url: 'https://www.brickowl.com' },
    { label: 'BrickEconomy', url: 'https://www.brickeconomy.com' },
];

function renderQuickLinks() {
    const nav = document.querySelector('.quick-links');
    if (!nav) return;
    nav.innerHTML = '<span class="quick-links-title">LINKS</span>' +
        QUICK_LINKS.map(link =>
            `<a href="${link.url}" target="_blank" rel="noopener">${link.label}</a>`
        ).join('');
}

// --- Condition Options (single source of truth) ---
const CONDITIONS = [
    { value: 'Sealed',     label: 'Sealed',     color: '#00ff00' },
    { value: 'Complete',   label: 'Complete',   color: '#00ffff' },
    { value: 'Incomplete', label: 'Incomplete', color: '#ffaa00' },
    { value: 'Display',    label: 'Display',    color: '#ff00ff' },
];

function conditionBadge(condition) {
    const c = CONDITIONS.find(x => x.value === condition);
    if (!c) return '';
    return `<span style="font-size:0.7em;border:1px solid ${c.color};color:${c.color};padding:1px 6px;margin-left:6px;vertical-align:middle;">${c.label}</span>`;
}

// --- Image Fallback ---
// Attaches onerror handler to replace broken LEGO set images with a placeholder
function attachImgFallback(imgEl) {
    imgEl.onerror = function() {
        this.onerror = null;
        this.style.background = '#111';
        this.style.border = '1px solid #333';
        // Inline SVG placeholder — no external dependency needed
        this.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='80' viewBox='0 0 100 80'><rect width='100' height='80' fill='%23111'/><text x='50' y='36' text-anchor='middle' font-family='monospace' font-size='22' fill='%23333'>⊘</text><text x='50' y='56' text-anchor='middle' font-family='monospace' font-size='9' fill='%23333'>NO IMAGE</text></svg>`;
    };
}

function conditionSelectHTML(selected = '') {
    return `<select id="condition-select" style="background:#000;color:#00ff00;border:1px solid #00ff00;padding:6px 10px;font-family:'Courier New',monospace;font-size:0.85em;margin-top:10px;width:100%;">
        <option value="">— Set Condition —</option>
        ${CONDITIONS.map(c => `<option value="${c.value}"${selected === c.value ? ' selected' : ''}>${c.label}</option>`).join('')}
    </select>`;
}


// Escapes user input before injecting into innerHTML to prevent XSS
function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// --- Persistent Filter State ---
// Saves/restores sort+filter selections across page reloads via localStorage
function filterStateKey() {
    return `lego_filters_${document.body.dataset.page || 'collection'}`;
}

function saveFilterState() {
    const state = {
        sort:      document.getElementById('sort-select')?.value || '',
        theme:     document.getElementById('filter-theme')?.value || '',
        year:      document.getElementById('filter-year')?.value || '',
        name:      document.getElementById('filter-name')?.value || '',
        condition: document.getElementById('filter-condition')?.value || '',
    };
    try { localStorage.setItem(filterStateKey(), JSON.stringify(state)); } catch {}
}

function restoreFilterState() {
    try {
        const raw = localStorage.getItem(filterStateKey());
        if (!raw) return;
        const state = JSON.parse(raw);
        if (state.sort)      { const el = document.getElementById('sort-select');      if (el) el.value = state.sort; }
        if (state.theme)     { const el = document.getElementById('filter-theme');     if (el) el.value = state.theme; }
        if (state.year)      { const el = document.getElementById('filter-year');      if (el) el.value = state.year; }
        if (state.name)      { const el = document.getElementById('filter-name');      if (el) el.value = state.name; }
        if (state.condition) { const el = document.getElementById('filter-condition'); if (el) el.value = state.condition; }
    } catch {}
}

// Populates the theme/year/condition filter dropdowns from a data set.
// Used by both collection.html and wantlist.html (the condition dropdown
// simply doesn't exist on wantlist.html, so that block is a no-op there).
function populateFilterDropdowns(data) {
    // Themes — sorted A-Z, unique
    const themes = [...new Set(data.map(i => i.theme).filter(Boolean))].sort();
    const themeSelect = document.getElementById('filter-theme');
    if (themeSelect) {
        const currentTheme = themeSelect.value;
        themeSelect.innerHTML = '<option value="">All Themes</option>';
        themes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            if (t === currentTheme) opt.selected = true;
            themeSelect.appendChild(opt);
        });
    }

    // Years — sorted newest first, unique
    const years = [...new Set(data.map(i => i.year).filter(Boolean))].sort((a, b) => b - a);
    const yearSelect = document.getElementById('filter-year');
    if (yearSelect) {
        const currentYear = yearSelect.value;
        yearSelect.innerHTML = '<option value="">All Years</option>';
        years.forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (String(y) === currentYear) opt.selected = true;
            yearSelect.appendChild(opt);
        });
    }

    // Condition — fixed list, only on collection page
    const conditionSelect = document.getElementById('filter-condition');
    if (conditionSelect) {
        const currentCondition = conditionSelect.value;
        conditionSelect.innerHTML = '<option value="">All Conditions</option>';
        CONDITIONS.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.value;
            opt.textContent = c.label;
            if (c.value === currentCondition) opt.selected = true;
            conditionSelect.appendChild(opt);
        });
    }
}

// Avoids redundant Rebrickable API calls for themes already fetched this session
const themeCache = {};

// --- BrickEconomy deep-link ---
// Builds a search URL for a set on BrickEconomy using the set number.
// e.g. "75192-1" → https://www.brickeconomy.com/search?query=75192-1
function brickEconomyUrl(setNum) {
    if (!setNum) return null;
    return `https://www.brickeconomy.com/search?query=${encodeURIComponent(setNum)}`;
}

// --- Fetch Retail Price via Netlify proxy ---
// Brickset's API blocks direct browser fetch() calls (no CORS headers).
// The Netlify function at /.netlify/functions/brickset proxies the call
// server-side and returns the price fields we need with proper CORS headers.
async function fetchRetailPrice(setNum) {
    if (setNum in retailPriceCache) return retailPriceCache[setNum];
    try {
        const url = `/.netlify/functions/brickset?setNumber=${encodeURIComponent(setNum)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Proxy error ${res.status}`);
        const data = await res.json();
        const price = data.result?.retailPrice ?? null;
        retailPriceCache[setNum] = price ? Number(price) : null;
    } catch {
        retailPriceCache[setNum] = null;
    }
    return retailPriceCache[setNum];
}

// Fetch retail prices for an array of set_nums in parallel
async function prefetchRetailPrices(setNums) {
    const unique = [...new Set(setNums)].filter(n => !(n in retailPriceCache));
    if (!unique.length) return;
    await Promise.allSettled(unique.map(n => fetchRetailPrice(n)));
}

async function fetchTheme(id) {
    if (themeCache[id]) return themeCache[id];
    try {
        const r = await fetch(`https://rebrickable.com/api/v3/lego/themes/${id}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        const t = await r.json();
        themeCache[id] = t.name || "Unknown";
    } catch {
        themeCache[id] = "Unknown";
    }
    return themeCache[id];
}

// --- Controls Panel Toggle ---
function toggleControls() {
    const title = document.getElementById('controls-toggle');
    const body  = document.getElementById('controls-body');
    if (!title || !body) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    title.classList.toggle('open', !isOpen);
    title.setAttribute('aria-expanded', String(!isOpen));
    // Persist state
    try { localStorage.setItem('controls_open_' + (document.body.dataset.page || 'collection'), String(!isOpen)); } catch {}
}

// Restore controls panel open/closed state on load
function restoreControlsState() {
    const key = 'controls_open_' + (document.body.dataset.page || 'collection');
    let open = true; // default open
    try {
        const stored = localStorage.getItem(key);
        if (stored !== null) open = stored === 'true';
    } catch {}
    const title = document.getElementById('controls-toggle');
    const body  = document.getElementById('controls-body');
    if (!title || !body) return;
    body.classList.toggle('open', open);
    title.classList.toggle('open', open);
    title.setAttribute('aria-expanded', String(open));
}


let filterDebounce;
function debouncedFilter() {
    clearTimeout(filterDebounce);
    filterDebounce = setTimeout(() => {
        if (isWantlistPage()) {
            applyWantlistControls();
        } else {
            applyControls();
        }
    }, 200);
}

window.onload = () => {
    renderQuickLinks();
    restoreControlsState();
    // Check if the dashboard container exists (index.html)
    if (document.getElementById('last-added-container')) {
        loadLastAdded();
        loadPresenceCache().then(() => {
            // Load SOTD after presence cache is ready so badges show correctly
            loadSetOfTheDay();
        });
    }
    // Check if the full list exists (collection.html)
    if (document.getElementById('collection-list')) {
        if (document.body.dataset.page === 'wantlist') {
            loadWantlist();
        } else {
            loadCollection();
        }
    }
};

let _lbImages = [];   // [{src, label}]
let _lbIndex  = 0;

function _lbGetOverlay() {
    let overlay = document.getElementById('lightbox-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'lightbox-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) closeLightbox(); });
        document.body.appendChild(overlay);
    }
    return overlay;
}

function _lbBuildShell(name, setNum, partsVal, yearVal) {
    return `
        <div class="lightbox-box" id="lightbox-box">
            <button class="lightbox-close" onclick="closeLightbox()">✕</button>
            <div class="lightbox-img-wrap" id="lightbox-img-wrap">
                <button class="lightbox-img-nav prev" id="lb-prev" onclick="lbNav(-1)" disabled>&#8249;</button>
                <img src="" alt="${escapeHTML(name)}" id="lightbox-img">
                <button class="lightbox-img-nav next" id="lb-next" onclick="lbNav(1)" disabled>&#8250;</button>
                <div class="lightbox-img-counter" id="lb-counter"></div>
            </div>
            <div class="lightbox-thumbs" id="lightbox-thumbs"></div>
            <div class="lightbox-title">${escapeHTML(name)}</div>
            <div class="lightbox-meta-row">
                <div class="lightbox-stat">
                    <span class="lightbox-stat-val" id="lightbox-parts-count">${partsVal}</span>
                    <span class="lightbox-stat-label">PARTS</span>
                </div>
                <div class="lightbox-stat-divider"></div>
                <div class="lightbox-stat">
                    <span class="lightbox-stat-val" id="lightbox-minifig-count">…</span>
                    <span class="lightbox-stat-label">MINIFIGS</span>
                </div>
                <div class="lightbox-stat-divider"></div>
                <div class="lightbox-stat">
                    <span class="lightbox-stat-val">${yearVal ?? '—'}</span>
                    <span class="lightbox-stat-label">YEAR</span>
                </div>
            </div>
            <div id="lightbox-minifigs" class="lightbox-minifigs"></div>
            <a href="https://rebrickable.com/sets/${setNum}/" target="_blank" rel="noopener" class="lightbox-rebrickable-link">VIEW ON REBRICKABLE ↗</a>
        </div>
    `;
}

// Show image at index in the gallery
function lbShowImage(idx) {
    if (!_lbImages.length) return;
    _lbIndex = Math.max(0, Math.min(idx, _lbImages.length - 1));
    const img = document.getElementById('lightbox-img');
    const wrap = document.getElementById('lightbox-img-wrap');
    const counter = document.getElementById('lb-counter');
    const prev = document.getElementById('lb-prev');
    const next = document.getElementById('lb-next');
    if (!img) return;

    wrap && wrap.classList.add('loading');
    img.onload  = () => wrap && wrap.classList.remove('loading');
    img.onerror = () => { wrap && wrap.classList.remove('loading'); attachImgFallback(img); };
    img.src = _lbImages[_lbIndex].src;

    if (counter) counter.textContent = _lbImages.length > 1 ? `${_lbIndex + 1} / ${_lbImages.length}` : '';
    if (prev) prev.disabled = _lbIndex === 0;
    if (next) next.disabled = _lbIndex === _lbImages.length - 1;

    // Highlight active thumb
    document.querySelectorAll('.lightbox-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === _lbIndex);
    });
}

function lbNav(dir) {
    lbShowImage(_lbIndex + dir);
}

// Rebuild thumb strip from _lbImages
function lbRenderThumbs() {
    const strip = document.getElementById('lightbox-thumbs');
    if (!strip) return;
    if (_lbImages.length <= 1) { strip.style.display = 'none'; return; }
    strip.style.display = 'flex';
    strip.innerHTML = _lbImages.map((img, i) => `
        <div class="lightbox-thumb${i === _lbIndex ? ' active' : ''}" onclick="lbShowImage(${i})" title="${escapeHTML(img.label)}">
            <img src="${img.src}" alt="${escapeHTML(img.label)}" onerror="this.parentElement.style.display='none'">
            <div class="lightbox-thumb-label">${escapeHTML(img.label)}</div>
        </div>
    `).join('');
    // Update nav buttons
    const prev = document.getElementById('lb-prev');
    const next = document.getElementById('lb-next');
    if (prev) prev.disabled = _lbIndex === 0;
    if (next) next.disabled = _lbIndex === _lbImages.length - 1;
}

// Add extra images to gallery after initial load
function lbAddImages(newImgs) {
    if (!newImgs.length) return;
    _lbImages = [..._lbImages, ...newImgs];
    lbRenderThumbs();
    // Update counter
    const counter = document.getElementById('lb-counter');
    if (counter && _lbImages.length > 1) counter.textContent = `${_lbIndex + 1} / ${_lbImages.length}`;
    const next = document.getElementById('lb-next');
    if (next) next.disabled = _lbIndex === _lbImages.length - 1;
}

async function openImageLightbox() {
    if (!currentSet) return;
    const overlay = _lbGetOverlay();

    _lbImages = currentSet.set_img_url ? [{ src: currentSet.set_img_url, label: 'Main' }] : [];
    _lbIndex  = 0;

    overlay.innerHTML = _lbBuildShell(currentSet.name, currentSet.set_num, currentSet.num_parts ?? '—', currentSet.year);
    overlay.classList.add('active');

    lbShowImage(0);
    lbRenderThumbs();

    // Fetch extra images + minifigs in parallel
    fetchExtraImages(currentSet.set_num);
    fetchMinifigs(currentSet.set_num);
}

// Fetch alternate/extra images for the lightbox gallery from Rebrickable
async function fetchExtraImages(setNum) {
    // Try alternates (MOC builds) — these have images and are linked to the set
    try {
        const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/alternates/?page_size=12`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (res.ok) {
            const data = await res.json();
            const imgs = (data.results || [])
                .filter(m => m.set_img_url)
                .map(m => ({ src: m.set_img_url, label: m.name || 'Alt Build' }));
            if (imgs.length) lbAddImages(imgs);
        }
    } catch {}

    // Try Brickset CDN for a box-back image (known URL pattern, silently ignored if 404)
    const baseNum = setNum.replace(/-1$/, '');
    const bricksetCandidates = [
        { src: `https://images.brickset.com/sets/images/${setNum}.jpg`, label: 'Box' },
        { src: `https://images.brickset.com/sets/AdditionalImages/${baseNum}-1/`, label: 'Box Back' },
    ];
    // Test each Brickset URL and only add ones that actually load
    for (const candidate of bricksetCandidates) {
        try {
            const probe = await fetch(candidate.src, { method: 'HEAD' });
            if (probe.ok) lbAddImages([candidate]);
        } catch {}
    }
}

async function fetchMinifigs(setNum) {
    const countEl = document.getElementById('lightbox-minifig-count');
    const gridEl  = document.getElementById('lightbox-minifigs');
    try {
        const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/minifigs/?page_size=50`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const count = data.count ?? 0;

        if (countEl) countEl.textContent = count || '0';

        if (count > 0 && gridEl) {
            const placeholder = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'><rect width='60' height='60' fill='%23111'/><text x='30' y='32' text-anchor='middle' font-family='monospace' font-size='18' fill='%23333'>⊘</text></svg>`;
            gridEl.innerHTML = data.results.map(mf => `
                <div class="lightbox-minifig">
                    <img src="${mf.set_img_url || placeholder}" alt="${mf.set_name}" title="${mf.set_name}" loading="lazy" style="${mf.set_img_url ? '' : 'background:#111;'}">
                    <div class="lightbox-minifig-name">${escapeHTML(mf.set_name)}</div>
                    ${mf.quantity > 1 ? `<div class="lightbox-minifig-qty">×${mf.quantity}</div>` : ''}
                </div>
            `).join('');
            // Attach fallbacks for images that fail mid-load
            gridEl.querySelectorAll('img').forEach(attachImgFallback);
        } else if (gridEl) {
            gridEl.innerHTML = '';
        }
    } catch {
        if (countEl) countEl.textContent = '—';
    }
}

function closeLightbox() {
    const overlay = document.getElementById('lightbox-overlay');
    if (overlay) overlay.classList.remove('active');
}

// Lightbox for collection/wantlist items (uses item data object, not currentSet)
async function openItemLightbox(item) {
    // Close the detail modal if open so lightbox sits on top cleanly
    document.getElementById('set-modal')?.classList.remove('active');

    const overlay = _lbGetOverlay();

    _lbImages = item.img_url ? [{ src: item.img_url, label: 'Main' }] : [];
    _lbIndex  = 0;

    // Parts not stored locally — will be filled by fetchItemLightboxData
    overlay.innerHTML = _lbBuildShell(item.name, item.set_num, '…', item.year);
    overlay.classList.add('active');

    lbShowImage(0);
    lbRenderThumbs();

    // Fetch set details, extra images, and minifigs all in parallel
    fetchItemLightboxData(item.set_num);
    fetchExtraImages(item.set_num);
}

async function fetchItemLightboxData(setNum) {
    // Fetch set details (for parts count) and minifigs simultaneously
    const [setRes, minifigRes] = await Promise.allSettled([
        fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, { headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` } }),
        fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/minifigs/?page_size=50`, { headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` } })
    ]);

    const partsEl = document.getElementById('lightbox-parts-count');
    const countEl = document.getElementById('lightbox-minifig-count');
    const gridEl  = document.getElementById('lightbox-minifigs');

    if (setRes.status === 'fulfilled' && setRes.value.ok) {
        const setData = await setRes.value.json();
        if (partsEl) partsEl.textContent = setData.num_parts ?? '—';
    } else {
        if (partsEl) partsEl.textContent = '—';
    }

    if (minifigRes.status === 'fulfilled' && minifigRes.value.ok) {
        const mfData = await minifigRes.value.json();
        const count = mfData.count ?? 0;
        if (countEl) countEl.textContent = count || '0';
        if (count > 0 && gridEl) {
            const placeholder = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'><rect width='60' height='60' fill='%23111'/><text x='30' y='32' text-anchor='middle' font-family='monospace' font-size='18' fill='%23333'>⊘</text></svg>`;
            gridEl.innerHTML = mfData.results.map(mf => `
                <div class="lightbox-minifig">
                    <img src="${mf.set_img_url || placeholder}" alt="${mf.set_name}" title="${mf.set_name}" loading="lazy" style="${mf.set_img_url ? '' : 'background:#111;'}">
                    <div class="lightbox-minifig-name">${escapeHTML(mf.set_name)}</div>
                    ${mf.quantity > 1 ? `<div class="lightbox-minifig-qty">×${mf.quantity}</div>` : ''}
                </div>
            `).join('');
            gridEl.querySelectorAll('img').forEach(attachImgFallback);
        }
    } else {
        if (countEl) countEl.textContent = '—';
    }
}

let currentView = 'list';

function isWantlistPage() {
    return document.body.dataset.page === 'wantlist';
}

async function loadViewPreference() {
    const col = isWantlistPage() ? 'view_mode_wantlist' : 'view_mode';
    const { data } = await db
        .from('user_preferences')
        .select(col)
        .eq('id', 'default')
        .single();
    currentView = (data && data[col]) ? data[col] : 'list';
}

async function setView(mode) {
    currentView = mode;
    const col = isWantlistPage() ? 'view_mode_wantlist' : 'view_mode';
    const { error } = await db.from('user_preferences')
        .update({ [col]: mode, updated_at: new Date() })
        .eq('id', 'default');
    if (error) console.warn('Could not save view preference:', error.message);

    const btnList = document.getElementById('btn-list');
    const btnGrid = document.getElementById('btn-grid');
    if (mode === 'grid') {
        if (btnGrid) btnGrid.classList.add('active');
        if (btnList) btnList.classList.remove('active');
    } else {
        if (btnList) btnList.classList.add('active');
        if (btnGrid) btnGrid.classList.remove('active');
    }

    if (isWantlistPage()) {
        applyWantlistControls();
    } else {
        applyControls();
    }
}
function clearFilters() {
    const themeEl     = document.getElementById('filter-theme');
    const yearEl      = document.getElementById('filter-year');
    const nameEl      = document.getElementById('filter-name');
    const conditionEl = document.getElementById('filter-condition');
    if (themeEl)     themeEl.value     = '';
    if (yearEl)      yearEl.value      = '';
    if (nameEl)      nameEl.value      = '';
    if (conditionEl) conditionEl.value = '';
    try { localStorage.removeItem(filterStateKey()); } catch {}
    if (document.body.dataset.page === 'wantlist') {
        applyWantlistControls();
    } else {
        applyControls();
    }
}

function showModal(item) {
    const onWantlist = isWantlistPage();
    const conditionSection = onWantlist ? '' : `
        <div style="margin-top:10px;">
            <span class="label">Condition: </span>
            ${conditionSelectHTML(item.condition || '')}
            <button onclick="updateCondition(${item.id})" style="margin-top:8px;width:100%;background:#00ff00;color:#000;border:none;padding:7px;font-family:'Courier New',monospace;font-weight:bold;cursor:pointer;">UPDATE CONDITION</button>
        </div>`;

    const beUrl = item.set_num ? brickEconomyUrl(item.set_num) : null;
    const beLink = beUrl ? `
        <a href="${beUrl}" target="_blank" rel="noopener"
            style="display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:8px;padding:7px;background:transparent;color:#ffaa00;border:1px solid #4a3200;border-radius:var(--radius-sm);font-family:var(--mono);font-size:0.75em;font-weight:bold;letter-spacing:1px;text-decoration:none;transition:background 0.2s;box-sizing:border-box;"
            onmouseover="this.style.background='rgba(255,170,0,0.08)'" onmouseout="this.style.background='transparent'"
            title="Check current market value on BrickEconomy">
            📈 MARKET VALUE ON BRICKECONOMY ↗
        </a>` : '';

    const priceSection = onWantlist ? '' : `
        <div style="margin-top:12px;border-top:1px solid var(--border2);padding-top:12px;">
            <div style="font-family:var(--mono);font-size:0.68em;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Price Paid</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-family:var(--mono);color:var(--green);font-size:1em;">$</span>
                <input id="modal-price-input" type="number" min="0" step="0.01"
                    value="${item.price_paid != null ? item.price_paid : ''}"
                    placeholder="0.00"
                    style="background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:6px 10px;font-family:var(--mono);font-size:0.9em;width:120px;outline:none;"
                    onfocus="this.style.borderColor='var(--green-dim)'" onblur="this.style.borderColor='var(--border2)'">
                <span id="modal-retail-price" style="font-family:var(--mono);font-size:0.7em;color:var(--text-muted);"></span>
            </div>
            <button onclick="updatePricePaid(${item.id})" style="width:100%;background:transparent;color:var(--green);border:1px solid var(--green-dim);padding:7px;font-family:var(--mono);font-size:0.75em;font-weight:bold;cursor:pointer;border-radius:var(--radius-sm);letter-spacing:1px;transition:background 0.2s;" onmouseover="this.style.background='rgba(0,255,136,0.08)'" onmouseout="this.style.background='transparent'">UPDATE PRICE</button>
        </div>
        <div style="margin-top:10px;border-top:1px solid var(--border2);padding-top:12px;">
            <div style="font-family:var(--mono);font-size:0.68em;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Market Value <span style="color:#4a3200;font-size:0.85em;">(from BrickEconomy)</span></div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-family:var(--mono);color:#ffaa00;font-size:1em;">$</span>
                <input id="modal-market-input" type="number" min="0" step="0.01"
                    value="${item.market_value != null ? item.market_value : ''}"
                    placeholder="0.00"
                    style="background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:6px 10px;font-family:var(--mono);font-size:0.9em;width:120px;outline:none;"
                    onfocus="this.style.borderColor='#4a3200'" onblur="this.style.borderColor='var(--border2)'">
                ${item.market_value != null && item.price_paid != null ? (() => {
                    const diff = Number(item.market_value) - Number(item.price_paid);
                    const pct = ((diff / Number(item.price_paid)) * 100).toFixed(1);
                    const col = diff >= 0 ? 'var(--green)' : 'var(--red)';
                    return `<span style="font-family:var(--mono);font-size:0.7em;color:${col};">${diff >= 0 ? '+' : ''}$${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)</span>`;
                })() : ''}
            </div>
            <button onclick="updateMarketValue(${item.id})" style="width:100%;background:transparent;color:#ffaa00;border:1px solid #4a3200;padding:7px;font-family:var(--mono);font-size:0.75em;font-weight:bold;cursor:pointer;border-radius:var(--radius-sm);letter-spacing:1px;transition:background 0.2s;" onmouseover="this.style.background='rgba(255,170,0,0.08)'" onmouseout="this.style.background='transparent'">UPDATE MARKET VALUE</button>
            ${beLink}
        </div>`;

    const setNumDisplay = item.set_num
        ? `<a href="https://rebrickable.com/sets/${item.set_num}/" target="_blank" rel="noopener" style="color:#00ffff;text-decoration:none;" title="View on Rebrickable">${item.set_num} ↗</a>`
        : 'N/A';

    document.getElementById('modal-content').innerHTML = `
        <button class="modal-close" onclick="document.getElementById('set-modal').classList.remove('active')">✕</button>
        <h2>${escapeHTML(item.name)}</h2>
        <div class="modal-img-wrap" onclick="openItemLightbox(${JSON.stringify(item).replace(/"/g, '&quot;')})" style="cursor:pointer;" title="Click to enlarge">
            <img id="modal-set-img" src="${item.img_url}" alt="${item.name}">
            <div style="font-size:0.65em;color:#333;margin-top:4px;letter-spacing:0.5px;">🔍 click to enlarge</div>
        </div>
        <div class="modal-meta">
            <div><span class="label">Set #: </span><span class="value">${setNumDisplay}</span></div>
            <div><span class="label">Year: </span><span class="value">${item.year}</span></div>
            <div><span class="label">Theme: </span><span class="value">${item.theme}</span></div>
            ${!onWantlist && item.condition ? `<div><span class="label">Condition: </span>${conditionBadge(item.condition)}</div>` : ''}
            ${conditionSection}
            ${priceSection}
        </div>
    `;
    const img = document.getElementById('modal-set-img');
    if (img) attachImgFallback(img);
    document.getElementById('set-modal').classList.add('active');

    // Fetch retail price in background and show next to input
    if (!onWantlist && item.set_num) {
        fetchRetailPrice(item.set_num).then(price => {
            const el = document.getElementById('modal-retail-price');
            if (el) {
                el.textContent = price != null ? `Retail: $${price.toFixed(2)}` : 'Retail: N/A';
                el.title = 'Original retail price (USD) from Brickset';
            }
        });
    }
}

function closeModal(e) {
    // Only close if clicking the dark backdrop, not the modal box itself
    if (e.target === document.getElementById('set-modal')) {
        document.getElementById('set-modal').classList.remove('active');
    }
}

