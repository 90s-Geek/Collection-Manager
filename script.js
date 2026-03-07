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

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentSet = null;

// --- Search pagination state ---
let searchNextUrl  = null;   // Rebrickable 'next' URL for Load More
let searchQuery    = '';     // Current name query (for appending more results)
let searchAllResults = [];   // Accumulated results across pages

// --- Bulk selection state ---
let bulkMode = false;
let bulkSelected = new Set(); // Set of item IDs currently selected

// --- Wantlist drag-to-reorder state ---
let dragSrcId = null; // ID of item being dragged

// --- Collection/Wantlist presence cache (for search page indicators) ---
// Loaded once on index.html to show "already in collection" badges on search results
let collectionSetNums = new Set();
let wantlistSetNums   = new Set();

async function loadPresenceCache() {
    const [colRes, wlRes] = await Promise.all([
        db.from('lego_collection').select('set_num'),
        db.from('lego_wantlist').select('set_num')
    ]);
    collectionSetNums = new Set((colRes.data || []).map(r => r.set_num));
    wantlistSetNums   = new Set((wlRes.data  || []).map(r => r.set_num));
}

function presenceBadge(setNum) {
    // Returns HTML badge(s) indicating if a set is already saved
    const badges = [];
    if (collectionSetNums.has(setNum)) {
        badges.push(`<span class="presence-badge presence-badge--collection">✓ IN COLLECTION</span>`);
    }
    if (wantlistSetNums.has(setNum)) {
        badges.push(`<span class="presence-badge presence-badge--wantlist">♥ IN WANT LIST</span>`);
    }
    return badges.join('');
}

// --- Toast Notifications ---
// Replaces native alert() with non-blocking, auto-fading messages
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

// Avoids redundant Rebrickable API calls for themes already fetched this session
const themeCache = {};

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

async function searchLego() {
    const input = document.getElementById('set-input').value.trim();
    if (!input) return showToast("Enter a set number or name!", 'warning');

    // Disable button to prevent duplicate requests
    const searchBtn = document.querySelector('.search-box button[type="submit"]');
    if (searchBtn) { searchBtn.disabled = true; searchBtn.textContent = 'SEARCHING...'; }

    const container = document.getElementById('result-container');
    container.style.display = 'block';
    container.innerHTML = '<p>Accessing Rebrickable...</p>';

    const isSetNum = /^\d+(-\d+)?$/.test(input);
    try {
        if (isSetNum) {
            await searchBySetNum(input, container);
        } else {
            await searchByName(input, container);
        }
    } finally {
        if (searchBtn) { searchBtn.disabled = false; searchBtn.textContent = 'SEARCH'; }
    }
}

async function searchBySetNum(input, container) {
    const setNum = input.includes('-') ? input : `${input}-1`;
    try {
        const setRes = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (!setRes.ok) throw new Error("Set not found.");
        const setData = await setRes.json();

        const themeName = await fetchTheme(setData.theme_id);
        currentSet = { ...setData, theme_name: themeName };
        renderSearchResult(currentSet);
    } catch (err) {
        container.innerHTML = `<p style="color:red;">${err.message}</p>`;
    }
}

async function searchByName(query, container) {
    try {
        const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(query)}&page_size=20&ordering=-year`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (!res.ok) throw new Error("Search failed.");
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            container.innerHTML = `<p style="color:#ff6666;">No sets found for "<strong>${escapeHTML(query)}</strong>".</p>`;
            return;
        }

        // Store pagination state
        searchQuery      = query;
        searchNextUrl    = data.next || null;
        searchAllResults = data.results;

        // Only fetch themes not already in cache
        const themeIds = [...new Set(data.results.map(s => s.theme_id))];
        await Promise.all(themeIds.map(id => fetchTheme(id)));

        renderNameSearchResults(searchAllResults, themeCache, query, data.count);
    } catch (err) {
        container.innerHTML = `<p style="color:red;">${err.message}</p>`;
    }
}

async function loadMoreSearchResults() {
    if (!searchNextUrl) return;
    const btn = document.getElementById('load-more-btn');
    if (btn) { btn.textContent = '⟳ LOADING...'; btn.disabled = true; }
    try {
        const res = await fetch(searchNextUrl, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (!res.ok) throw new Error("Load more failed.");
        const data = await res.json();
        searchNextUrl = data.next || null;
        searchAllResults = [...searchAllResults, ...data.results];

        // Fetch any new theme IDs
        const themeIds = [...new Set(data.results.map(s => s.theme_id))];
        await Promise.all(themeIds.map(id => fetchTheme(id)));

        // Re-render all accumulated results but preserve existing scroll
        const container = document.getElementById('result-container');
        const scrollEl  = container.querySelector('.search-results-list');
        const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
        renderNameSearchResults(searchAllResults, themeCache, searchQuery, null /* keep original count */);
        const newScrollEl = container.querySelector('.search-results-list');
        if (newScrollEl) newScrollEl.scrollTop = scrollTop;
    } catch (err) {
        if (btn) { btn.textContent = 'LOAD MORE'; btn.disabled = false; }
        showToast('Could not load more results.', 'error');
    }
}

// Keep the displayed total count across load-more calls
let _searchTotalCount = 0;

function renderNameSearchResults(results, themeMap, query, totalCount) {
    if (totalCount !== null) _searchTotalCount = totalCount;
    const container = document.getElementById('result-container');
    const rows = results.map(set => {
        const baseNum = set.set_num.replace(/-\d+$/, '');
        return `
        <li class="search-result-item" onclick="selectSearchResult('${set.set_num}', ${set.theme_id})">
            <img src="${set.set_img_url || ''}" alt="${set.name}" width="50" style="border:1px solid #333; flex-shrink:0; background:#fff;">
            <div class="search-result-info">
                <strong>${escapeHTML(set.name)}</strong>
                <span class="search-result-meta">${set.set_num} &nbsp;|&nbsp; ${set.year} &nbsp;|&nbsp; ${themeMap[set.theme_id] || 'Unknown'}</span>
                ${presenceBadge(set.set_num)}
                <a href="https://www.lego.com/en-us/service/building-instructions/find-building-instructions?query=${baseNum}" target="_blank" rel="noopener"
                   onclick="event.stopPropagation()"
                   style="color:#ffaa00;text-decoration:none;font-size:0.72em;letter-spacing:1px;display:inline-block;margin-top:3px;"
                   title="Find building instructions on LEGO.com">📋 instructions ↗</a>
            </div>
        </li>
    `}).join('');

    const loadMoreBtn = searchNextUrl
        ? `<button id="load-more-btn" onclick="loadMoreSearchResults()" class="load-more-btn">⬇ LOAD MORE RESULTS</button>`
        : '';

    container.innerHTML = `
        <div style="text-align:left; margin-bottom:10px; font-size:0.8em; color:#888;">
            > ${_searchTotalCount} result${_searchTotalCount !== 1 ? 's' : ''} for "<span style="color:#00ffff;">${escapeHTML(query)}</span>"
            &nbsp;<span style="color:#555;">(showing ${results.length})</span>
        </div>
        <ul class="search-results-list">${rows}</ul>
        ${loadMoreBtn}
    `;
}

async function selectSearchResult(setNum, themeId) {
    const container = document.getElementById('result-container');
    container.innerHTML = '<p>Loading set details...</p>';
    try {
        const setRes = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (!setRes.ok) throw new Error("Set not found.");
        const setData = await setRes.json();

        // fetchTheme uses cache — no extra API call if already fetched during search
        const themeName = await fetchTheme(themeId);
        currentSet = { ...setData, theme_name: themeName };
        renderSearchResult(currentSet);
    } catch (err) {
        container.innerHTML = `<p style="color:red;">${err.message}</p>`;
    }
}

function renderSearchResult(set) {
    const inCollection = collectionSetNums.has(set.set_num);
    const inWantlist   = wantlistSetNums.has(set.set_num);

    const statusBanner = (inCollection || inWantlist) ? `
        <div class="search-status-banner">
            ${inCollection ? `<span class="presence-badge presence-badge--collection">✓ ALREADY IN COLLECTION</span>` : ''}
            ${inWantlist   ? `<span class="presence-badge presence-badge--wantlist">♥ ALREADY IN WANT LIST</span>`   : ''}
        </div>` : '';

    document.getElementById('result-container').innerHTML = `
        <h2>${set.name}</h2>
        <div class="set-meta">
            <strong>Year:</strong> ${set.year} | <strong>Theme:</strong> ${set.theme_name} | 
            <strong>Set #:</strong> <a href="https://rebrickable.com/sets/${set.set_num}/" target="_blank" rel="noopener" style="color:#00ffff;text-decoration:none;" title="View on Rebrickable">${set.set_num} ↗</a>
        </div>
        ${statusBanner}
        <div class="search-img-wrap" onclick="openImageLightbox()" title="Click to view details">
            <img id="search-result-img" src="${set.set_img_url}" alt="${set.name}" style="max-width:250px; border:1px solid #0f0; margin-bottom:4px; cursor:pointer;">
            <div class="search-img-hint">🔍 click to enlarge</div>
        </div>
        <p>Parts: ${set.num_parts}</p>
        <div style="margin:8px 0 12px;">
            <a href="https://www.lego.com/en-us/service/building-instructions/find-building-instructions?query=${set.set_num.replace(/-\d+$/, '')}" target="_blank" rel="noopener"
               style="color:#ffaa00;text-decoration:none;font-size:0.82em;letter-spacing:1px;border:1px solid #443300;padding:4px 10px;display:inline-block;"
               title="Find building instructions on LEGO.com">📋 BUILDING INSTRUCTIONS ↗</a>
        </div>
        ${conditionSelectHTML()}
        <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:10px;">
            <button class="save-btn" onclick="saveCurrentSet()">+ ADD TO COLLECTION</button>
            <button class="wantlist-btn" onclick="saveToWantList()">♥ ADD TO WANT LIST</button>
        </div>
    `;
    const img = document.getElementById('search-result-img');
    if (img) attachImgFallback(img);
}

// --- Image Lightbox Gallery ---
// Shared gallery state for the currently open lightbox
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
                    <img src="${mf.set_img_url || placeholder}" alt="${mf.set_name}" title="${mf.set_name}" style="${mf.set_img_url ? '' : 'background:#111;'}">
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
                    <img src="${mf.set_img_url || placeholder}" alt="${mf.set_name}" title="${mf.set_name}" style="${mf.set_img_url ? '' : 'background:#111;'}">
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

async function saveCurrentSet() {
    if (!currentSet) return;

    // Duplicate check — see if this set_num already exists in the collection
    const { data: existing, error: checkError } = await db
        .from('lego_collection')
        .select('id')
        .eq('set_num', currentSet.set_num)
        .limit(1);

    if (checkError) {
        showToast("Database Error: " + checkError.message, 'error');
        return;
    }

    if (existing && existing.length > 0) {
        showToast(`"${currentSet.name}" is already in your collection!`, 'warning');
        return;
    }

    const condition = document.getElementById('condition-select')?.value || '';

    const { error } = await db.from('lego_collection').insert([{ 
        set_num: currentSet.set_num, 
        name: currentSet.name, 
        img_url: currentSet.set_img_url,
        year: currentSet.year,
        theme: currentSet.theme_name,
        condition: condition || null
    }]);

    if (error) {
        showToast("Database Error: " + error.message, 'error');
    } else {
        collectionSetNums.add(currentSet.set_num); // Update presence cache instantly
        showToast("Added to collection!", 'success');
        renderSearchResult(currentSet); // Refresh to show badge
        loadLastAdded(); // Refresh dashboard after save
    }
}

async function loadLastAdded() {
    const container = document.getElementById('last-added-container');
    if (!container) return;
    const { data, error } = await db.from('lego_collection')
        .select('*').order('created_at', { ascending: false }).limit(3);

    if (error || !data || data.length === 0) {
        container.innerHTML = "<div style='color:#333;font-size:0.65em;padding:4px 2px;'>No sets yet.</div>";
        return;
    }

    container.innerHTML = data.map(item => `
        <div class="recently-added-item" onclick="selectSotdSet('${item.set_num}', 0)" title="${escapeHTML(item.name)}">
            <img src="${item.img_url || ''}" alt="${escapeHTML(item.name)}"
                 onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'36\' height=\'28\'><rect width=\'36\' height=\'28\' fill=\'%23111\'/></svg>'">
            <div class="recently-added-item-text">
                <div class="recently-added-item-name">${escapeHTML(item.name)}</div>
                <div class="recently-added-item-meta">${item.theme || '-'} · ${item.year || '-'}</div>
            </div>
        </div>
    `).join('');
}



// --- View Mode ---
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
let collectionCache = [];

async function loadCollection() {
    // Fetch view preference and collection data in parallel — no reason to wait on one for the other
    const [, { data, error }] = await Promise.all([
        loadViewPreference(),
        db.from('lego_collection').select('*').order('created_at', { ascending: false })
    ]);

    // Apply saved view preference to toggle buttons
    const btnList = document.getElementById('btn-list');
    const btnGrid = document.getElementById('btn-grid');
    if (currentView === 'grid') {
        if (btnGrid) btnGrid.classList.add('active');
        if (btnList) btnList.classList.remove('active');
    } else {
        if (btnList) btnList.classList.add('active');
        if (btnGrid) btnGrid.classList.remove('active');
    }

    if (error) {
        document.getElementById('collection-list').innerHTML = '<li>Error loading collection.</li>';
        return;
    }

    collectionCache = data || [];
    populateFilterDropdowns(collectionCache);
    restoreFilterState();
    applyControls();
}

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

function applyControls() {
    // Show filtering state while list is being rebuilt
    const list = document.getElementById('collection-list');
    if (list) list.classList.add('filtering');

    // Read sort
    const sortSelect = document.getElementById('sort-select');
    const [sortCol, sortDir] = sortSelect ? sortSelect.value.split('|') : ['created_at', 'desc'];

    // Read filters
    const filterTheme     = (document.getElementById('filter-theme')?.value || '').toLowerCase();
    const filterYear      = document.getElementById('filter-year')?.value || '';
    const filterName      = (document.getElementById('filter-name')?.value || '').toLowerCase().trim();
    const filterCondition = document.getElementById('filter-condition')?.value || '';
    // Filter
    let results = collectionCache.filter(item => {
        if (filterTheme     && (item.theme || '').toLowerCase() !== filterTheme) return false;
        if (filterYear      && String(item.year) !== filterYear) return false;
        if (filterName      && !(item.name || '').toLowerCase().includes(filterName)) return false;
        if (filterCondition && (item.condition || '') !== filterCondition) return false;
        return true;
    });

    // Sort
    results.sort((a, b) => {
        let valA = a[sortCol] ?? '';
        let valB = b[sortCol] ?? '';
        // Numeric sort for year
        if (sortCol === 'year') { valA = Number(valA); valB = Number(valB); }
        // Date sort
        if (sortCol === 'created_at') { valA = new Date(valA); valB = new Date(valB); }
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    renderCollection(results);
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

function renderCollection(data) {
    const list = document.getElementById('collection-list');
    list.classList.remove('filtering');

    // Persist filter state after each render
    saveFilterState();

    // Update count
    const countEl = document.getElementById('collection-count');
    if (countEl) {
        const total = collectionCache.length;
        const showing = data.length;
        if (total === 0) {
            countEl.innerHTML = '';
        } else if (showing === total) {
            countEl.innerHTML = `> <span>${total}</span>&nbsp;set${total !== 1 ? 's' : ''} in database`;
        } else {
            countEl.innerHTML = `> Showing&nbsp;<span>${showing}</span>&nbsp;of&nbsp;<span>${total}</span>&nbsp;sets`;
        }
    }

    list.innerHTML = '';
    list.classList.remove('grid-view');

    if (currentView === 'grid') list.classList.add('grid-view');
    if (!data.length) {
        list.innerHTML = '<li style="color:#666; padding:10px;">No sets match your filters.</li>';
        return;
    }

    data.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = "collection-item collection-item-fadein";
        li.style.animationDelay = `${Math.min(idx * 30, 400)}ms`;
        if (bulkMode && bulkSelected.has(item.id)) li.classList.add('bulk-selected');

        const infoDiv = document.createElement('div');
        infoDiv.className = "collection-item-info";

        // Bulk checkbox (only visible in bulk mode)
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'bulk-checkbox';
        checkbox.checked = bulkSelected.has(item.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) { bulkSelected.add(item.id); li.classList.add('bulk-selected'); }
            else { bulkSelected.delete(item.id); li.classList.remove('bulk-selected'); }
            updateBulkToolbar();
        });
        if (!bulkMode) checkbox.style.display = 'none';

        const img = document.createElement('img');
        img.src = item.img_url;
        img.alt = item.name;
        img.width = currentView === 'grid' ? 100 : 50;
        img.style.cssText = `margin-right:${currentView === 'grid' ? '0' : '10px'};border:1px solid #0f0;cursor:pointer;`;
        attachImgFallback(img);
        img.addEventListener('click', e => { e.stopPropagation(); openItemLightbox(item); });

        const textDiv = document.createElement('div');
        textDiv.innerHTML = `
            <strong>${item.name}</strong> (${item.year})${conditionBadge(item.condition)}<br>
            <small style="color:#00ffff;">Theme: ${item.theme}</small>`;

        infoDiv.appendChild(checkbox);
        infoDiv.appendChild(img);
        infoDiv.appendChild(textDiv);
        infoDiv.addEventListener('click', (e) => {
            if (e.target === checkbox) return;
            if (bulkMode) {
                // In bulk mode, clicking the row toggles selection
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
                return;
            }
            showModal(item);
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = "remove-btn";
        removeBtn.textContent = "REMOVE";
        removeBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSet(item.id); });

        li.appendChild(infoDiv);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

function showModal(item) {
    const onWantlist = isWantlistPage();
    const conditionSection = onWantlist ? '' : `
        <div style="margin-top:10px;">
            <span class="label">Condition: </span>
            ${conditionSelectHTML(item.condition || '')}
            <button onclick="updateCondition(${item.id})" style="margin-top:8px;width:100%;background:#00ff00;color:#000;border:none;padding:7px;font-family:'Courier New',monospace;font-weight:bold;cursor:pointer;">UPDATE CONDITION</button>
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
        </div>
    `;
    const img = document.getElementById('modal-set-img');
    if (img) attachImgFallback(img);
    document.getElementById('set-modal').classList.add('active');
}

async function updateCondition(id) {
    const raw = document.getElementById('condition-select')?.value || '';
    const validConditions = CONDITIONS.map(c => c.value);
    const condition = validConditions.includes(raw) ? raw : null;
    const { error } = await db.from('lego_collection').update({ condition }).eq('id', id);
    if (error) {
        showToast("Error updating condition: " + error.message, 'error');
        return;
    }
    // Update cache in-place
    const item = collectionCache.find(i => i.id === id);
    if (item) item.condition = condition;
    showToast("Condition updated!", 'success');
    applyControls();
    document.getElementById('set-modal').classList.remove('active');
}

function closeModal(e) {
    // Only close if clicking the dark backdrop, not the modal box itself
    if (e.target === document.getElementById('set-modal')) {
        document.getElementById('set-modal').classList.remove('active');
    }
}

async function deleteSet(id) {
    if (document.body.dataset.page === 'wantlist') return; // Safety guard — never delete from collection on wantlist page
    if (!confirm("Remove this set from your collection?")) return;
    const { error } = await db.from('lego_collection').delete().eq('id', id);
    if (error) {
        showToast("Error removing set: " + error.message, 'error');
    } else {
        showToast("Set removed from collection.", 'info');
        // Update cache in-place — no need to re-fetch all data from Supabase
        collectionCache = collectionCache.filter(i => i.id !== id);
        populateFilterDropdowns(collectionCache);
        applyControls();
    }
}

// --- BULK ACTIONS ---

function toggleBulkMode() {
    bulkMode = !bulkMode;
    if (!bulkMode) {
        bulkSelected.clear();
        hideBulkToolbar();
    }
    // Update the bulk toggle button appearance
    const btn = document.getElementById('bulk-toggle-btn');
    if (btn) {
        btn.textContent = bulkMode ? '✕ EXIT SELECT' : '☑ SELECT';
        btn.classList.toggle('bulk-mode-active', bulkMode);
    }
    // Re-render to show/hide checkboxes
    applyControls();
    if (bulkMode) showBulkToolbar();
}

function showBulkToolbar() {
    let toolbar = document.getElementById('bulk-toolbar');
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.id = 'bulk-toolbar';
        toolbar.className = 'bulk-toolbar';
        toolbar.innerHTML = `
            <span id="bulk-count-label" class="bulk-count-label">0 selected</span>
            <button onclick="bulkSelectAll()" class="bulk-action-btn">SELECT ALL</button>
            <button onclick="bulkExportSelected()" class="bulk-action-btn bulk-action-export">⬇ EXPORT</button>
            <button onclick="bulkConditionPrompt()" class="bulk-action-btn bulk-action-condition">✎ CONDITION</button>
            <button onclick="bulkRemoveSelected()" class="bulk-action-btn bulk-action-remove">✕ REMOVE</button>
        `;
        // Insert after collection-meta-row
        const metaRow = document.querySelector('.collection-meta-row');
        if (metaRow && metaRow.nextSibling) {
            metaRow.parentNode.insertBefore(toolbar, metaRow.nextSibling);
        } else {
            document.body.appendChild(toolbar);
        }
    }
    toolbar.classList.add('active');
    updateBulkToolbar();
}

function hideBulkToolbar() {
    const toolbar = document.getElementById('bulk-toolbar');
    if (toolbar) toolbar.classList.remove('active');
}

function updateBulkToolbar() {
    const label = document.getElementById('bulk-count-label');
    if (label) label.textContent = `${bulkSelected.size} selected`;
}

function bulkSelectAll() {
    // Select all currently displayed items
    const list = document.getElementById('collection-list');
    if (!list) return;
    list.querySelectorAll('.bulk-checkbox').forEach(cb => {
        cb.checked = true;
        const li = cb.closest('.collection-item');
        if (li) li.classList.add('bulk-selected');
        // Find the item id from the data
        const idMatch = cb.dataset.id ? parseInt(cb.dataset.id) : null;
    });
    // Rebuild from rendered items — re-apply controls to sync
    const checkboxes = list.querySelectorAll('.bulk-checkbox');
    checkboxes.forEach(cb => { cb.checked = true; });
    // Sync bulkSelected from current rendered collection (filtered view)
    const currentFiltered = getCurrentFilteredCollection();
    currentFiltered.forEach(i => bulkSelected.add(i.id));
    list.querySelectorAll('.collection-item').forEach(li => li.classList.add('bulk-selected'));
    updateBulkToolbar();
}

function getCurrentFilteredCollection() {
    const filterTheme     = (document.getElementById('filter-theme')?.value || '').toLowerCase();
    const filterYear      = document.getElementById('filter-year')?.value || '';
    const filterName      = (document.getElementById('filter-name')?.value || '').toLowerCase().trim();
    const filterCondition = document.getElementById('filter-condition')?.value || '';
    return collectionCache.filter(item => {
        if (filterTheme     && (item.theme || '').toLowerCase() !== filterTheme) return false;
        if (filterYear      && String(item.year) !== filterYear) return false;
        if (filterName      && !(item.name || '').toLowerCase().includes(filterName)) return false;
        if (filterCondition && (item.condition || '') !== filterCondition) return false;
        return true;
    });
}

function bulkExportSelected() {
    const items = collectionCache.filter(i => bulkSelected.has(i.id));
    if (!items.length) return showToast('No sets selected.', 'warning');
    const headers = ['set_num', 'name', 'theme', 'year', 'condition', 'img_url'];
    const rows = items.map(item => headers.map(h => `"${(item[h] || '').toString().replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lego_selected_${items.length}_sets.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${items.length} set${items.length !== 1 ? 's' : ''}.`, 'success');
}

async function bulkRemoveSelected() {
    if (!bulkSelected.size) return showToast('No sets selected.', 'warning');
    if (!confirm(`Remove ${bulkSelected.size} set${bulkSelected.size !== 1 ? 's' : ''} from your collection?`)) return;
    const ids = [...bulkSelected];
    // Delete in batches of 10 to avoid URL length issues
    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        await db.from('lego_collection').delete().in('id', batch);
    }
    collectionCache = collectionCache.filter(i => !bulkSelected.has(i.id));
    showToast(`Removed ${ids.length} set${ids.length !== 1 ? 's' : ''}.`, 'info');
    bulkSelected.clear();
    populateFilterDropdowns(collectionCache);
    applyControls();
    updateBulkToolbar();
}

function bulkConditionPrompt() {
    if (!bulkSelected.size) return showToast('No sets selected.', 'warning');
    // Show a small inline condition picker in the toolbar
    let picker = document.getElementById('bulk-condition-picker');
    if (picker) { picker.remove(); return; }
    picker = document.createElement('div');
    picker.id = 'bulk-condition-picker';
    picker.className = 'bulk-condition-picker';
    // Use a unique ID so it never clashes with the modal's condition-select
    picker.innerHTML = `
        <span style="color:#888;font-size:0.8em;">Set condition for ${bulkSelected.size} sets:</span>
        <select id="bulk-condition-select" style="background:#000;color:#00ff00;border:1px solid #00ff00;padding:6px 10px;font-family:'Courier New',monospace;font-size:0.85em;margin-top:10px;width:100%;">
            <option value="">— Set Condition —</option>
            ${CONDITIONS.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
        </select>
        <button onclick="bulkApplyCondition()" style="background:#00ff00;color:#000;border:none;padding:6px 12px;font-family:'Courier New',monospace;font-weight:bold;cursor:pointer;margin-top:6px;width:100%;">APPLY</button>
    `;
    const toolbar = document.getElementById('bulk-toolbar');
    toolbar.appendChild(picker);
}

async function bulkApplyCondition() {
    const select = document.getElementById('bulk-condition-select');
    if (!select) return showToast('Condition picker not found.', 'error');
    const condition = select.value;
    const validConditions = CONDITIONS.map(c => c.value);
    const cleanCondition = validConditions.includes(condition) ? condition : null;
    if (!cleanCondition) return showToast('Please select a condition first.', 'warning');
    const ids = [...bulkSelected];
    for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        await db.from('lego_collection').update({ condition: cleanCondition }).in('id', batch);
    }
    ids.forEach(id => {
        const item = collectionCache.find(i => i.id === id);
        if (item) item.condition = cleanCondition;
    });
    document.getElementById('bulk-condition-picker')?.remove();
    showToast(`Updated condition for ${ids.length} set${ids.length !== 1 ? 's' : ''}.`, 'success');
    applyControls();
}

// --- WANT LIST ---

async function saveToWantList() {
    if (!currentSet) return;

    const { data: existing, error: checkError } = await db
        .from('lego_wantlist')
        .select('id')
        .eq('set_num', currentSet.set_num)
        .limit(1);

    if (checkError) { showToast("Database Error: " + checkError.message, 'error'); return; }
    if (existing && existing.length > 0) { showToast(`"${currentSet.name}" is already on your want list!`, 'warning'); return; }

    const { error } = await db.from('lego_wantlist').insert([{
        set_num: currentSet.set_num,
        name: currentSet.name,
        img_url: currentSet.set_img_url,
        year: currentSet.year,
        theme: currentSet.theme_name
    }]);

    if (error) { showToast("Database Error: " + error.message, 'error'); }
    else {
        wantlistSetNums.add(currentSet.set_num); // Update presence cache instantly
        showToast("Added to want list!", 'success');
        renderSearchResult(currentSet); // Refresh to show badge
    }
}

let wantlistCache = [];

async function loadWantlist() {
    // Fetch view preference and wantlist data in parallel
    // Try ordering by sort_order first; fall back to created_at if column doesn't exist yet
    const [, result] = await Promise.all([
        loadViewPreference(),
        db.from('lego_wantlist').select('*').order('sort_order', { ascending: true, nullsFirst: false })
    ]);

    let { data, error } = result;

    // If there's an error, just try a plain fetch with no ordering
    if (error) {
        const fallback = await db.from('lego_wantlist').select('*').order('sort_order', { ascending: true, nullsFirst: false });
        data  = fallback.data;
        error = fallback.error;
    }

    const btnList = document.getElementById('btn-list');
    const btnGrid = document.getElementById('btn-grid');
    if (currentView === 'grid') {
        if (btnGrid) btnGrid.classList.add('active');
        if (btnList) btnList.classList.remove('active');
    } else {
        if (btnList) btnList.classList.add('active');
        if (btnGrid) btnGrid.classList.remove('active');
    }

    if (error) {
        document.getElementById('collection-list').innerHTML = '<li>Error loading want list.</li>';
        return;
    }

    wantlistCache = data || [];
    populateFilterDropdowns(wantlistCache);
    restoreFilterState();
    initWantlistDrag(); // Set up drag delegation once
    applyWantlistControls();
}

function applyWantlistControls() {
    // Show filtering state while list is being rebuilt
    const list = document.getElementById('collection-list');
    if (list) list.classList.add('filtering');

    const sortSelect = document.getElementById('sort-select');
    const sortValue = sortSelect ? sortSelect.value : 'sort_order|asc';
    const [sortCol, sortDir] = sortValue.split('|');

    const filterTheme = (document.getElementById('filter-theme')?.value || '').toLowerCase();
    const filterYear  = document.getElementById('filter-year')?.value || '';
    const filterName  = (document.getElementById('filter-name')?.value || '').toLowerCase().trim();

    let results = wantlistCache.filter(item => {
        if (filterTheme && (item.theme || '').toLowerCase() !== filterTheme) return false;
        if (filterYear  && String(item.year) !== filterYear) return false;
        if (filterName  && !(item.name || '').toLowerCase().includes(filterName)) return false;
        return true;
    });

    // When using default date-added sort AND items have a sort_order set, respect drag order
    const hasSortOrder = wantlistCache.some(i => i.sort_order !== null && i.sort_order !== undefined && i.sort_order !== '');
    if (sortCol === 'created_at' && sortDir === 'desc' && hasSortOrder) {
        // Keep the order from wantlistCache (already sorted by sort_order from DB load)
    } else {
        results.sort((a, b) => {
            let valA = a[sortCol] ?? '';
            let valB = b[sortCol] ?? '';
            if (sortCol === 'year') { valA = Number(valA); valB = Number(valB); }
            if (sortCol === 'created_at') { valA = new Date(valA); valB = new Date(valB); }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderWantlist(results);
}

function renderWantlist(data) {
    const list = document.getElementById('collection-list');
    list.classList.remove('filtering');

    // Persist filter state after each render
    saveFilterState();

    const countEl = document.getElementById('collection-count');
    if (countEl) {
        const total = wantlistCache.length;
        const showing = data.length;
        if (total === 0) {
            countEl.innerHTML = '';
        } else if (showing === total) {
            countEl.innerHTML = `> <span>${total}</span>&nbsp;set${total !== 1 ? 's' : ''} on want list`;
        } else {
            countEl.innerHTML = `> Showing&nbsp;<span>${showing}</span>&nbsp;of&nbsp;<span>${total}</span>&nbsp;sets`;
        }
    }

    list.innerHTML = '';
    list.classList.remove('grid-view');
    if (currentView === 'grid') list.classList.add('grid-view');
    if (!data.length) {
        list.innerHTML = '<li style="color:#666; padding:10px;">No sets match your filters.</li>';
        return;
    }

    // Determine if drag mode should be active (only in list view, no active filters)
    const filterTheme = (document.getElementById('filter-theme')?.value || '');
    const filterYear  = document.getElementById('filter-year')?.value || '';
    const filterName  = (document.getElementById('filter-name')?.value || '').trim();
    const dragEnabled = currentView === 'list' && !filterTheme && !filterYear && !filterName;

    data.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = "collection-item collection-item-fadein";
        li.style.animationDelay = `${Math.min(idx * 30, 400)}ms`;
        li.dataset.id = item.id;

        if (dragEnabled) {
            li.draggable = true;
            li.classList.add('draggable-item');
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = "collection-item-info";

        // Drag handle (only visible in list view with no filters)
        if (dragEnabled) {
            const handle = document.createElement('div');
            handle.className = 'drag-handle';
            handle.innerHTML = '⠿';
            handle.title = 'Drag to reorder';
            infoDiv.appendChild(handle);
        }

        const img = document.createElement('img');
        img.src = item.img_url;
        img.alt = item.name;
        img.width = currentView === 'grid' ? 100 : 50;
        img.draggable = false; // prevent image drag fighting row drag
        img.style.cssText = `margin-right:${currentView === 'grid' ? '0' : '10px'};border:1px solid #ff00ff;cursor:pointer;`;
        attachImgFallback(img);
        img.addEventListener('click', e => { e.stopPropagation(); openItemLightbox(item); });

        const textDiv = document.createElement('div');
        textDiv.innerHTML = `
            <strong>${item.name}</strong> (${item.year})<br>
            <small style="color:#00ffff;">Theme: ${item.theme}</small>`;

        infoDiv.appendChild(img);
        infoDiv.appendChild(textDiv);
        infoDiv.addEventListener('click', () => showModal(item));

        const btnGroup = document.createElement('div');
        btnGroup.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex-shrink:0;margin-left:10px;';

        const addBtn = document.createElement('button');
        addBtn.className = "add-from-want-btn";
        addBtn.textContent = "→ COLLECT";
        addBtn.title = "Move to collection";
        addBtn.addEventListener('click', () => moveToCollection(item));

        const removeBtn = document.createElement('button');
        removeBtn.className = "remove-btn";
        removeBtn.textContent = "REMOVE";
        removeBtn.addEventListener('click', () => deleteFromWantlist(item.id));

        btnGroup.appendChild(addBtn);
        btnGroup.appendChild(removeBtn);
        li.appendChild(infoDiv);
        li.appendChild(btnGroup);
        list.appendChild(li);
    });

    // Show/hide drag hint
    const hintEl = document.getElementById('drag-hint');
    if (dragEnabled && data.length > 1) {
        if (!hintEl) {
            const hint = document.createElement('div');
            hint.id = 'drag-hint';
            hint.className = 'drag-hint';
            hint.textContent = '⠿ Drag rows to set your priority order';
            list.before(hint);
        }
    } else if (hintEl) {
        hintEl.remove();
    }
}

// --- Wantlist Drag-to-Reorder ---
// Uses event delegation on the list element — avoids child-element interference

function initWantlistDrag() {
    const list = document.getElementById('collection-list');
    if (!list) return;

    list.addEventListener('dragstart', e => {
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        dragSrcId = parseInt(li.dataset.id);
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', li.dataset.id);
    });

    list.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const li = e.target.closest('li[data-id]');
        // Clear any previous highlights then highlight the current target
        list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (li && parseInt(li.dataset.id) !== dragSrcId) li.classList.add('drag-over');
    });

    list.addEventListener('dragleave', e => {
        // Only clear if leaving the list entirely
        if (!list.contains(e.relatedTarget)) {
            list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });

    list.addEventListener('drop', async e => {
        e.preventDefault();
        list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        const targetId = parseInt(li.dataset.id);
        if (!dragSrcId || dragSrcId === targetId) return;

        const srcIdx = wantlistCache.findIndex(i => i.id === dragSrcId);
        const tgtIdx = wantlistCache.findIndex(i => i.id === targetId);
        if (srcIdx === -1 || tgtIdx === -1) return;

        const [moved] = wantlistCache.splice(srcIdx, 1);
        wantlistCache.splice(tgtIdx, 0, moved);

        // Re-render immediately so it feels instant
        applyWantlistControls();

        // Persist sort_order to Supabase silently (requires sort_order column)
        try {
            for (let i = 0; i < wantlistCache.length; i++) {
                const { error } = await db.from('lego_wantlist')
                    .update({ sort_order: i })
                    .eq('id', wantlistCache[i].id);
                if (error && error.message && error.message.includes('sort_order')) break;
            }
        } catch {}
    });

    list.addEventListener('dragend', e => {
        list.querySelectorAll('.dragging, .drag-over').forEach(el => {
            el.classList.remove('dragging', 'drag-over');
        });
        dragSrcId = null;
    });
}

function moveToCollection(item) {
    // Show a styled modal with condition picker instead of browser prompt()
    document.getElementById('modal-content').innerHTML = `
        <button class="modal-close" onclick="document.getElementById('set-modal').classList.remove('active')">✕</button>
        <h2>→ Move to Collection</h2>
        <div class="modal-img-wrap">
            <img src="${item.img_url}" alt="${item.name}" id="move-modal-img">
        </div>
        <div style="color:#aaa;font-size:0.88em;margin-bottom:12px;line-height:1.6;">
            <strong style="color:#fff;">${escapeHTML(item.name)}</strong><br>
            <span style="color:#00ffff;">${escapeHTML(item.theme || '')} &nbsp;·&nbsp; ${item.year || ''}</span>
        </div>
        ${conditionSelectHTML('')}
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button onclick="confirmMoveToCollection(${item.id})" style="flex:1;background:#00ff00;color:#000;padding:10px;font-family:'Courier New',monospace;font-weight:bold;border:none;cursor:pointer;">✓ MOVE TO COLLECTION</button>
            <button onclick="document.getElementById('set-modal').classList.remove('active')" style="flex:1;background:none;border:1px solid #333;color:#888;padding:10px;font-family:'Courier New',monospace;cursor:pointer;">CANCEL</button>
        </div>
    `;
    // Attach image fallback
    const img = document.getElementById('move-modal-img');
    if (img) attachImgFallback(img);

    // Stash the item on the modal for the confirm handler to pick up
    document.getElementById('set-modal').dataset.pendingMove = JSON.stringify(item);
    document.getElementById('set-modal').classList.add('active');
}

async function confirmMoveToCollection(wantlistId) {
    const modal = document.getElementById('set-modal');
    const item = JSON.parse(modal.dataset.pendingMove || 'null');
    if (!item) return;

    const condition = document.getElementById('condition-select')?.value || null;
    const validConditions = CONDITIONS.map(c => c.value);
    const cleanCondition = validConditions.includes(condition) ? condition : null;

    modal.classList.remove('active');
    delete modal.dataset.pendingMove;

    const { data: existing } = await db.from('lego_collection').select('id').eq('set_num', item.set_num).limit(1);
    if (existing && existing.length > 0) {
        showToast(`"${item.name}" is already in your collection — removing from want list.`, 'warning');
    } else {
        const { error } = await db.from('lego_collection').insert([{
            set_num: item.set_num, name: item.name, img_url: item.img_url, year: item.year, theme: item.theme,
            condition: cleanCondition
        }]);
        if (error) { showToast("Error saving to collection: " + error.message, 'error'); return; }
    }

    const { error: deleteError } = await db.from('lego_wantlist').delete().eq('id', wantlistId);
    if (deleteError) {
        showToast("Moved to collection, but failed to remove from want list: " + deleteError.message, 'warning');
    } else {
        showToast(`"${item.name}" moved to collection!`, 'success');
    }
    wantlistCache = wantlistCache.filter(i => i.id !== wantlistId);
    populateFilterDropdowns(wantlistCache);
    applyWantlistControls();
}

async function deleteFromWantlist(id) {
    if (!confirm("Remove this set from your want list?")) return;
    const { error } = await db.from('lego_wantlist').delete().eq('id', id);
    if (error) {
        showToast("Error removing set: " + error.message, 'error');
    } else {
        showToast("Set removed from want list.", 'info');
        // Update cache in-place — no need to re-fetch all data from Supabase
        wantlistCache = wantlistCache.filter(i => i.id !== id);
        populateFilterDropdowns(wantlistCache);
        applyWantlistControls();
    }
}

// --- CSV IMPORT ---

function closeImportModal(e) {
    const modal = document.getElementById('import-modal');
    if (modal && modal.dataset.importing) return; // Locked during active import
    if (e.target === modal) {
        modal.classList.remove('active');
    }
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;

    // Parse header — strip BOM, quotes, whitespace
    const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h =>
        h.trim().replace(/^"|"$/g, '').toLowerCase()
    );

    if (!headers.includes('set_num')) return null;

    return lines.slice(1).map(line => {
        // Handle quoted fields containing commas
        const fields = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') {
                inQuotes = !inQuotes;
            } else if (line[i] === ',' && !inQuotes) {
                fields.push(current.trim());
                current = '';
            } else {
                current += line[i];
            }
        }
        fields.push(current.trim());

        const row = {};
        headers.forEach((h, i) => { row[h] = (fields[i] || '').trim(); });
        return row;
    }).filter(row => row.set_num); // Skip blank rows
}

async function handleCSVFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = document.getElementById('import-preview');
    preview.innerHTML = '<p style="color:#888;">⟳ Reading file...</p>';

    const text = await file.text();
    const rows = parseCSV(text);

    if (!rows) {
        preview.innerHTML = '<p style="color:#ff6666;">Invalid CSV — must have a <strong>set_num</strong> column.</p>';
        return;
    }

    preview.innerHTML = `<p style="color:#888;">⟳ Checking ${rows.length} set${rows.length !== 1 ? 's' : ''} against your collection...</p>`;

    // Fetch existing set_nums from collection to detect duplicates
    const { data: existing } = await db.from('lego_collection').select('set_num');
    const existingNums = new Set((existing || []).map(r => r.set_num));

    // Normalise set_num (add -1 suffix if missing)
    const normalise = s => /^\d+$/.test(s.trim()) ? `${s.trim()}-1` : s.trim();

    const toImport = rows.map(r => ({ ...r, set_num: normalise(r.set_num) }))
                         .filter(r => !existingNums.has(r.set_num));
    const skipped  = rows.length - toImport.length;

    if (toImport.length === 0) {
        preview.innerHTML = `<p style="color:#ffaa00;">All ${rows.length} sets are already in your collection. Nothing to import.</p>`;
        return;
    }

    preview.innerHTML = `
        <div style="border:1px solid #333;padding:12px;margin-top:10px;text-align:left;font-size:0.8em;max-height:200px;overflow-y:auto;">
            <div style="color:#888;margin-bottom:8px;">
                Ready to import <span style="color:#00ffff;">${toImport.length}</span> set${toImport.length !== 1 ? 's' : ''}
                ${skipped ? `<span style="color:#ffaa00;"> (${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped)</span>` : ''}
            </div>
            ${toImport.map(r => `<div style="color:#00ff00;margin-bottom:2px;">+ ${r.set_num}${r.name ? ' — ' + r.name : ''}</div>`).join('')}
        </div>
        <button id="confirm-import-btn" onclick="confirmImport()" style="width:100%;margin-top:10px;background:#00ff00;color:#000;padding:10px;font-family:'Courier New',monospace;font-weight:bold;border:none;cursor:pointer;">
            ↑ IMPORT ${toImport.length} SET${toImport.length !== 1 ? 'S' : ''}
        </button>
    `;

    // Store pending rows on button for confirmImport to access
    document.getElementById('confirm-import-btn').dataset.pending = JSON.stringify(toImport);
}

async function confirmImport() {
    const btn = document.getElementById('confirm-import-btn');
    const toImport = JSON.parse(btn.dataset.pending || '[]');
    if (!toImport.length) return;

    const preview = document.getElementById('import-preview');
    btn.disabled = true;

    // Lock the modal so it can't be closed mid-import
    const modal = document.getElementById('import-modal');
    const closeBtn = modal ? modal.querySelector('.modal-close') : null;
    if (modal) modal.dataset.importing = 'true';
    if (closeBtn) closeBtn.disabled = true;

    let imported = 0;
    let failed = 0;
    const failedSets = [];

    const updateProgress = (currentSet = '') => {
        preview.innerHTML = `
            <div style="border:1px solid #333;padding:15px;margin-top:10px;text-align:left;font-size:0.85em;">
                <div style="color:#888;margin-bottom:10px;">IMPORTING...</div>
                <div style="background:#111;border:1px solid #333;height:12px;margin-bottom:10px;box-sizing:border-box;">
                    <div style="background:#00ff00;height:100%;width:${Math.round(((imported + failed) / toImport.length) * 100)}%;transition:width 0.2s;"></div>
                </div>
                <div style="color:#00ffff;margin-bottom:4px;">${imported + failed} / ${toImport.length} processed</div>
                <div style="color:#00ff00;">✓ ${imported} added</div>
                ${failed ? `<div style="color:#ff6666;">✗ ${failed} failed</div>` : ''}
                ${currentSet ? `<div style="color:#555;margin-top:8px;font-size:0.8em;">⟳ ${currentSet}</div>` : ''}
            </div>
        `;
    };

    updateProgress();

    for (const row of toImport) {
        try {
            let { set_num, name, theme, year, condition } = row;

            updateProgress(set_num);

            // Only fetch from Rebrickable if data is actually missing
            let img_url = row.img_url || null;
            if (!name || !theme || !year || !img_url) {
                const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${set_num}/`, {
                    headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
                });
                if (!res.ok) throw new Error('Not found on Rebrickable');
                const data = await res.json();
                name    = name    || data.name;
                year    = year    || data.year;
                theme   = theme   || await fetchTheme(data.theme_id);
                img_url = img_url || data.set_img_url || null;
            }
            // Final fallback: construct URL from set number
            if (!img_url) img_url = `https://cdn.rebrickable.com/media/sets/${set_num}.jpg`;

            const validConditions = CONDITIONS.map(c => c.value);
            const cleanCondition = validConditions.includes(condition) ? condition : null;

            const { error } = await db.from('lego_collection').insert([{
                set_num, name,
                img_url,
                year: parseInt(year) || null,
                theme,
                condition: cleanCondition
            }]);

            if (error) throw new Error(error.message);
            imported++;
            updateProgress(set_num);
        } catch (err) {
            failed++;
            failedSets.push(`${row.set_num} (${err.message})`);
            updateProgress();
        }
    }

    // Final state
    preview.innerHTML = `
        <div style="border:1px solid #333;padding:15px;margin-top:10px;text-align:left;font-size:0.85em;">
            <div style="color:#00ff00;margin-bottom:8px;">✓ IMPORT COMPLETE</div>
            <div style="background:#111;border:1px solid #333;height:12px;margin-bottom:10px;">
                <div style="background:#00ff00;height:100%;width:100%;"></div>
            </div>
            <div style="color:#00ffff;">${imported} set${imported !== 1 ? 's' : ''} added to collection</div>
            ${failed ? `<div style="color:#ff6666;margin-top:6px;">✗ ${failed} failed:<br>${failedSets.map(s => `<span style="color:#884444;">${s}</span>`).join('<br>')}</div>` : ''}
        </div>
    `;

    // Reload collection cache with fresh data
    await loadCollection();
    document.getElementById('csv-file-input').value = '';

    // Unlock modal now that import is done
    if (modal) delete modal.dataset.importing;
    if (closeBtn) closeBtn.disabled = false;
}


function exportWantlist() {
    // Use in-memory cache — no need for a redundant round-trip to Supabase
    if (!wantlistCache.length) return showToast("No data to export.", 'warning');
    const sorted = [...wantlistCache].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const headers = ['set_num', 'name', 'theme', 'year', 'img_url'];
    const rows = sorted.map(item => headers.map(h => `"${(item[h] || '').toString().replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lego_wantlist.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// --- SET OF THE DAY ---
// Uses today's date as a deterministic seed to pick a consistent set all day.
// Changes at midnight. No extra infrastructure needed — just the Rebrickable API.

// Theme names/keywords that indicate bulk parts, not real sets
const SOTD_EXCLUDE_THEMES = [
    'bulk bricks', 'bulk', 'service packs', 'znap', 'scala accessories',
    'supplemental', 'educational', 'dacta', 'individual elements',
    'storage', 'quatro', 'duplo accessories', 'soft bricks'
];

function isSotdExcluded(themeName) {
    if (!themeName) return false;
    const lower = themeName.toLowerCase();
    return SOTD_EXCLUDE_THEMES.some(ex => lower.includes(ex));
}

async function loadSetOfTheDay() {
    const container = document.getElementById('sotd-container');
    const dateLabel = document.getElementById('sotd-date');
    if (!container) return;

    const now = new Date();
    if (dateLabel) {
        dateLabel.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    }

    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);

    // Fetch a page of 10 candidates so we can filter out bulk/parts packs
    // and still land on a real set. Use day-of-year to pick the page,
    // then use day % 10 to pick which candidate within the page.
    const totalPages = 200;
    const page = (dayOfYear % totalPages) + 1;
    const candidateIdx = dayOfYear % 10;

    try {
        const res = await fetch(
            `https://rebrickable.com/api/v3/lego/sets/?page=${page}&page_size=10&min_parts=50&ordering=set_num`,
            { headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` } }
        );
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const candidates = data.results || [];
        if (!candidates.length) throw new Error('No sets returned');

        // Resolve all theme names in parallel
        await Promise.all([...new Set(candidates.map(s => s.theme_id))].map(id => fetchTheme(id)));

        // Filter out bulk/parts themes, then pick by index (wrap around if needed)
        const valid = candidates.filter(s => !isSotdExcluded(themeCache[s.theme_id]));
        if (!valid.length) throw new Error('No valid sets after filtering');

        const set = valid[candidateIdx % valid.length];
        renderSetOfTheDay({ ...set, theme_name: themeCache[set.theme_id] || 'Unknown' });
    } catch (err) {
        if (container) container.innerHTML = `<span style="color:#333;font-size:0.8em;">Could not load set of the day.</span>`;
    }
}

function renderSetOfTheDay(set) {
    const container = document.getElementById('sotd-container');
    if (!container) return;

    const inCollection = collectionSetNums.has(set.set_num);
    const inWantlist   = wantlistSetNums.has(set.set_num);

    container.innerHTML = `
        <div class="sotd-body">
            <div class="sotd-img-panel" onclick="selectSotdSet('${set.set_num}', ${set.theme_id})" title="Click to view set details">
                <img id="sotd-img" src="${set.set_img_url || ''}" alt="${escapeHTML(set.name)}">
                <span class="sotd-badge">⚄ DAILY PICK</span>
                <span class="sotd-enlarge-hint">🔍 click to view</span>
            </div>
            <div class="sotd-info-panel">
                <div>
                    <div class="sotd-name">${escapeHTML(set.name)}</div>
                    <div class="sotd-meta-row">
                        <div class="sotd-meta-item">
                            <span class="sotd-meta-val">${set.year || '—'}</span>
                            <span class="sotd-meta-lbl">Year</span>
                        </div>
                        <div class="sotd-meta-divider"></div>
                        <div class="sotd-meta-item">
                            <span class="sotd-meta-val">${set.num_parts ?? '—'}</span>
                            <span class="sotd-meta-lbl">Parts</span>
                        </div>
                        <div class="sotd-meta-divider"></div>
                        <div class="sotd-meta-item">
                            <span class="sotd-meta-val" style="font-size:0.78em;">${escapeHTML(set.theme_name)}</span>
                            <span class="sotd-meta-lbl">Theme</span>
                        </div>
                    </div>
                    <div style="font-size:0.72em;color:#443300;letter-spacing:1px;margin-bottom:14px;">${set.set_num}</div>
                    ${inCollection ? '<span class="presence-badge presence-badge--collection" style="margin-right:6px;">✓ IN COLLECTION</span>' : ''}
                    ${inWantlist   ? '<span class="presence-badge presence-badge--wantlist">♥ IN WANT LIST</span>' : ''}
                </div>
                <div class="sotd-actions" style="margin-top:14px;">
                    <button class="sotd-btn primary" onclick="selectSotdSet('${set.set_num}', ${set.theme_id})">VIEW SET</button>
                    <button class="sotd-btn" onclick="sotdSaveToCollection('${set.set_num}', ${set.theme_id})">+ COLLECT</button>
                    <button class="sotd-btn" onclick="sotdSaveToWantlist('${set.set_num}', ${set.theme_id})">♥ WANT</button>
                </div>
            </div>
        </div>
    `;
    const img = document.getElementById('sotd-img');
    if (img) attachImgFallback(img);
}

async function selectSotdSet(setNum, themeId) {
    const container = document.getElementById('result-container');
    container.style.display = 'block';
    container.innerHTML = '<p>Loading set details...</p>';
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const setRes = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        if (!setRes.ok) throw new Error('Set not found.');
        const setData = await setRes.json();
        const themeName = await fetchTheme(themeId);
        currentSet = { ...setData, theme_name: themeName };
        renderSearchResult(currentSet);
    } catch (err) {
        container.innerHTML = `<p style="color:red;">${err.message}</p>`;
    }
}

async function sotdSaveToCollection(setNum, themeId) {
    try {
        const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        const setData = await res.json();
        const themeName = await fetchTheme(themeId);
        currentSet = { ...setData, theme_name: themeName };
        await saveCurrentSet();
        renderSetOfTheDay({ ...currentSet, theme_name: themeName });
    } catch { showToast('Could not save set.', 'error'); }
}

async function sotdSaveToWantlist(setNum, themeId) {
    try {
        const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`, {
            headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
        });
        const setData = await res.json();
        const themeName = await fetchTheme(themeId);
        currentSet = { ...setData, theme_name: themeName };
        await saveToWantList();
        renderSetOfTheDay({ ...currentSet, theme_name: themeName });
    } catch { showToast('Could not save set.', 'error'); }
}

function exportCollection() {
    // Use in-memory cache — no need for a redundant round-trip to Supabase
    if (!collectionCache.length) return showToast("No data to export.", 'warning');
    const sorted = [...collectionCache].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const headers = ['set_num', 'name', 'theme', 'year', 'condition', 'img_url'];
    const rows = sorted.map(item => headers.map(h => `"${(item[h] || '').toString().replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lego_collection.csv';
    a.click();
    URL.revokeObjectURL(url);
}
