// ============================================================
// search.js — index.html only
// LEGO Search page: set/name/theme search, Set of the Day,
// "recently added" panel, and save-to-collection/want-list actions
// triggered from search results.
// Depends on core.js (must be loaded first).
// ============================================================
let searchNextUrl  = null;   // Rebrickable 'next' URL for Load More
let searchQuery    = '';     // Current name query (for appending more results)
let searchAllResults = [];   // Accumulated results across pages

// --- Bulk selection state ---
let collectionSetNums = new Set();
let wantlistSetNums   = new Set();

async function loadPresenceCache() {
    // theme + market_value come along so the stats strip needs no extra query
    const [colRes, wlRes] = await Promise.all([
        db.from('lego_collection').select('set_num, theme, market_value'),
        db.from('lego_wantlist').select('set_num')
    ]);
    collectionSetNums = new Set((colRes.data || []).map(r => r.set_num));
    wantlistSetNums   = new Set((wlRes.data  || []).map(r => r.set_num));

    homeStats.col     = colRes.data || [];
    homeStats.wlCount = (wlRes.data || []).length;
    homeStats.failed  = !!(colRes.error || wlRes.error);
    renderStatsStrip();
}

// ============================================================
// STATS STRIP (top of the home page)
// Sets · Themes · Market value · Wish list — each tile links to the
// page with the details. Built from the same query as the presence cache.
// ============================================================
const homeStats = { col: [], wlCount: 0, failed: false };

function initStatsStrip() {
    const h1 = document.querySelector('h1');
    if (!h1 || document.getElementById('stats-strip')) return;
    const strip = document.createElement('div');
    strip.id = 'stats-strip';
    strip.className = 'stats-strip';
    strip.setAttribute('aria-label', 'Collection summary');
    strip.innerHTML = Array.from({ length: 4 }, () => `
        <div class="stats-tile stats-tile--loading">
            <div class="skeleton stats-tile-skel-val"></div>
            <div class="skeleton skeleton-text short"></div>
        </div>`).join('');
    h1.after(strip);
}

function fmtStatMoney(v) {
    if (v >= 10000) return `$${(v / 1000).toFixed(0)}k`;
    if (v >= 1000)  return `$${(v / 1000).toFixed(1)}k`;
    return `$${Math.round(v).toLocaleString()}`;
}

function renderStatsStrip() {
    const strip = document.getElementById('stats-strip');
    if (!strip) return;

    const col     = homeStats.col;
    const themes  = new Set(col.map(i => i.theme).filter(Boolean)).size;
    const valued  = col.filter(i => i.market_value != null);
    const value   = valued.reduce((sum, i) => sum + Number(i.market_value), 0);
    const dash    = homeStats.failed ? '—' : null;

    const tiles = [
        { href: 'collection.html', key: 'sets',   val: dash ?? col.length.toLocaleString(),           label: col.length === 1 ? 'Set' : 'Sets', sub: 'in collection' },
        { href: 'stats.html',      key: 'themes', val: dash ?? themes.toLocaleString(),               label: themes === 1 ? 'Theme' : 'Themes', sub: 'collected' },
        { href: 'stats.html',      key: 'value',  val: dash ?? (valued.length ? fmtStatMoney(value) : '—'), label: 'Market value',
          sub: valued.length ? `${valued.length} of ${col.length} sets valued` : 'add values in Collection' },
        { href: 'wantlist.html',   key: 'wish',   val: dash ?? homeStats.wlCount.toLocaleString(),    label: 'Wish list', sub: homeStats.wlCount === 1 ? 'set wanted' : 'sets wanted' },
    ];

    strip.innerHTML = tiles.map(t => `
        <a class="stats-tile stats-tile--${t.key}" href="${t.href}">
            <span class="stats-tile-val">${t.val}</span>
            <span class="stats-tile-label">${t.label}</span>
            <span class="stats-tile-sub">${escapeHTML(t.sub)}</span>
        </a>`).join('');
}

// Keep the strip current after a save, without re-querying
function noteSavedForStats(kind, set) {
    if (kind === 'collection') homeStats.col.push({ set_num: set.set_num, theme: set.theme || null, market_value: null });
    else homeStats.wlCount++;
    renderStatsStrip();
}

function presenceBadge(setNum) {
    // Returns HTML badge(s) indicating if a set is already saved
    const badges = [];
    if (collectionSetNums.has(setNum)) {
        badges.push(`<span class="presence-badge presence-badge--collection">✓ IN COLLECTION</span>`);
    }
    if (wantlistSetNums.has(setNum)) {
        badges.push(`<span class="presence-badge presence-badge--wantlist">♥ IN WISH LIST</span>`);
    }
    return badges.join('');
}

// --- Toast Notifications ---
// Replaces native alert() with non-blocking, auto-fading messages
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
        const inputEl = document.getElementById('set-input');
        if (inputEl) { inputEl.focus(); inputEl.select(); }
    }
}

async function searchBySetNum(input, container) {
    const setNum = input.includes('-') ? input : `${input}-1`;
    try {
        const setRes = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`);
        if (!setRes.ok) throw new Error("Set not found.");
        const setData = await setRes.json();

        const themeName = await fetchTheme(setData.theme_id);
        currentSet = { ...setData, theme_name: themeName };
        renderSearchResult(currentSet);
    } catch (err) {
        container.innerHTML = `<p class="search-msg search-msg--error">${escapeHTML(err.message)}</p>`;
    }
}

// Cache of all Rebrickable themes, loaded once per session
let allThemesCache = null;

// Themes rarely change, so keep a copy in localStorage for a week.
// Saves ~900 records of Rebrickable calls on the first name search each session.
const THEMES_STORAGE_KEY = '90sgeek_themes_v1';
const THEMES_TTL_MS      = 7 * 24 * 60 * 60 * 1000;

function readStoredThemes() {
    try {
        const raw = localStorage.getItem(THEMES_STORAGE_KEY);
        if (!raw) return null;
        const { savedAt, themes } = JSON.parse(raw);
        if (!Array.isArray(themes) || !themes.length) return null;
        if (Date.now() - savedAt > THEMES_TTL_MS) return null;
        return themes;
    } catch { return null; }
}

function storeThemes(themes) {
    try {
        // Keep only the fields we use to keep storage small
        const slim = themes.map(t => ({ id: t.id, name: t.name, parent_id: t.parent_id ?? null }));
        localStorage.setItem(THEMES_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), themes: slim }));
    } catch { /* storage full or blocked — just skip caching */ }
}

async function getAllThemes() {
    if (allThemesCache) return allThemesCache;

    const stored = readStoredThemes();
    if (stored) {
        allThemesCache = stored;
        return stored;
    }

    // Fetch all themes across pages (Rebrickable has ~900 themes total)
    let url = `https://rebrickable.com/api/v3/lego/themes/?page_size=500`;
    let all = [];
    let complete = true;
    while (url) {
        const res = await rebrickableFetch(url);
        if (!res.ok) { complete = false; break; }
        const data = await res.json();
        all = all.concat(data.results || []);
        url = data.next || null;
    }
    allThemesCache = all;
    if (complete && all.length) storeThemes(all); // never cache a partial list
    return all;
}

async function searchByName(query, container) {
    try {
        const q = query.toLowerCase().trim();
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Fetch all themes and set name search in parallel
        const [allThemes, setRes] = await Promise.all([
            getAllThemes(),
            rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(query)}&page_size=20&ordering=-year`)
        ]);

        const themeMatch = allThemes.find(t => t.name.toLowerCase() === q)
                        || allThemes.find(t => normalize(t.name) === normalize(q));

        if (themeMatch) {
            await searchByThemeId(themeMatch.id, themeMatch.name, container);
            return;
        }

        // Fall back to set name results
        if (!setRes.ok) throw new Error("Search failed.");
        const data = await setRes.json();

        if (!data.results || data.results.length === 0) {
            container.innerHTML = `<p class="search-msg search-msg--empty">No sets found for "<strong>${escapeHTML(query)}</strong>".</p>`;
            return;
        }

        searchQuery      = query;
        searchNextUrl    = data.next || null;
        searchAllResults = data.results;

        const themeIds = [...new Set(data.results.map(s => s.theme_id))];
        await Promise.all(themeIds.map(id => fetchTheme(id)));

        renderNameSearchResults(searchAllResults, themeCache, query, data.count);
    } catch (err) {
        container.innerHTML = `<p class="search-msg search-msg--error">${escapeHTML(err.message)}</p>`;
    }
}

async function searchByThemeId(themeId, themeName, container) {
    searchQuery      = themeName;
    searchNextUrl    = null;
    searchAllResults = [];

    const url = `https://rebrickable.com/api/v3/lego/sets/?theme_id=${themeId}&page_size=20&ordering=-year`;
    const res = await rebrickableFetch(url);
    if (!res.ok) throw new Error("Theme search failed.");
    const data = await res.json();

    searchNextUrl    = data.next || null;
    searchAllResults = data.results || [];

    const themeIds = [...new Set(searchAllResults.map(s => s.theme_id))];
    await Promise.all(themeIds.map(id => fetchTheme(id)));

    if (!searchAllResults.length) {
        container.innerHTML = `<p class="search-msg search-msg--empty">No sets found for theme "<strong>${escapeHTML(themeName)}</strong>".</p>`;
        return;
    }

    renderNameSearchResults(searchAllResults, themeCache, `Theme: ${themeName}`, data.count);
}

// Re-draw the current result list without losing the user's scroll spot
// (used after Load More and after a quick-add changes a row's badges).
function rerenderSearchList() {
    const container = document.getElementById('result-container');
    const scrollEl  = container.querySelector('.search-results-list');
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    renderNameSearchResults(searchAllResults, themeCache, searchQuery, null /* keep original count */);
    const newScrollEl = container.querySelector('.search-results-list');
    if (newScrollEl) newScrollEl.scrollTop = scrollTop;
}

async function loadMoreSearchResults() {
    if (!searchNextUrl) return;
    const btn = document.getElementById('load-more-btn');
    if (btn) { btn.textContent = '⟳ LOADING...'; btn.disabled = true; }
    try {
        const res = await rebrickableFetch(searchNextUrl);
        if (!res.ok) throw new Error("Load more failed.");
        const data = await res.json();
        searchNextUrl = data.next || null;
        searchAllResults = [...searchAllResults, ...data.results];

        // Fetch any new theme IDs
        const themeIds = [...new Set(data.results.map(s => s.theme_id))];
        await Promise.all(themeIds.map(id => fetchTheme(id)));

        rerenderSearchList();
    } catch (err) {
        if (btn) { btn.textContent = 'LOAD MORE'; btn.disabled = false; }
        showToast('Could not load more results.', 'error');
    }
}

// Keep the displayed total count across load-more calls
let _searchTotalCount = 0;

// Quick-add buttons for one result row. A set that's already saved shows
// a filled, disabled button instead of an add button.
function quickAddButtonsHTML(setNum) {
    const inCol = collectionSetNums.has(setNum);
    const inWl  = wantlistSetNums.has(setNum);
    const colBtn = inCol
        ? `<button type="button" class="quick-add-btn quick-add-btn--collection is-done" disabled title="Already in your collection" aria-label="Already in your collection">✓</button>`
        : `<button type="button" class="quick-add-btn quick-add-btn--collection" onclick="quickAdd('collection', '${setNum}', event)" title="Add to collection" aria-label="Add to collection">+</button>`;
    const wlBtn = inWl
        ? `<button type="button" class="quick-add-btn quick-add-btn--wishlist is-done" disabled title="Already on your wish list" aria-label="Already on your wish list">♥</button>`
        : `<button type="button" class="quick-add-btn quick-add-btn--wishlist" onclick="quickAdd('wishlist', '${setNum}', event)" title="Add to wish list" aria-label="Add to wish list">♡</button>`;
    return `<div class="quick-add">${colBtn}${wlBtn}</div>`;
}

function renderNameSearchResults(results, themeMap, query, totalCount) {
    if (totalCount !== null) _searchTotalCount = totalCount;
    const container = document.getElementById('result-container');
    const rows = results.map(set => `
        <li class="search-result-item" onclick="selectSearchResult('${set.set_num}', ${set.theme_id})">
            <img src="${set.set_img_url || ''}" alt="${escapeHTML(set.name)}" width="50" loading="lazy" class="search-result-thumb">
            <div class="search-result-info">
                <strong>${escapeHTML(set.name)}</strong>
                <span class="search-result-meta">${set.set_num} &nbsp;|&nbsp; ${set.year} &nbsp;|&nbsp; ${themeMap[set.theme_id] || 'Unknown'}</span>
                ${presenceBadge(set.set_num)}
            </div>
            ${quickAddButtonsHTML(set.set_num)}
        </li>
    `).join('');

    const loadMoreBtn = searchNextUrl
        ? `<button id="load-more-btn" onclick="loadMoreSearchResults()" class="load-more-btn">⬇ LOAD MORE RESULTS</button>`
        : '';

    container.innerHTML = `
        <div class="search-results-header">
            &gt; ${_searchTotalCount} result${_searchTotalCount !== 1 ? 's' : ''} for "<span class="query-text">${escapeHTML(query)}</span>"
            &nbsp;<span class="showing-count">(showing ${results.length})</span>
        </div>
        <ul class="search-results-list">${rows}</ul>
        ${loadMoreBtn}
    `;
}

// --- QUICK ADD (from the results list) ---
// Saves a set straight from its result row using the data the search
// already returned — no extra Rebrickable call. Condition and price paid
// are left blank; set them later from the Collection page if you want.
async function quickAdd(kind, setNum, ev) {
    if (ev) ev.stopPropagation(); // don't also open the set's detail view
    const btn = ev && ev.currentTarget;

    const set = searchAllResults.find(s => s.set_num === setNum);
    if (!set) return;

    const isCol = kind === 'collection';
    const table = isCol ? 'lego_collection' : 'lego_wantlist';
    const saved = isCol ? collectionSetNums : wantlistSetNums;
    const where = isCol ? 'your collection' : 'your wish list';

    if (saved.has(setNum)) { showToast(`"${set.name}" is already in ${where}!`, 'warning'); return; }

    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }

    try {
        // Double-check the database in case it was added in another tab
        const { data: existing, error: checkError } = await db
            .from(table).select('id').eq('set_num', setNum).limit(1);
        if (checkError) throw checkError;
        if (existing && existing.length) {
            saved.add(setNum);
            showToast(`"${set.name}" is already in ${where}!`, 'warning');
            rerenderSearchList();
            return;
        }

        const themeName = themeCache[set.theme_id] || await fetchTheme(set.theme_id);
        const { error } = await db.from(table).insert([{
            set_num: set.set_num,
            name:    set.name,
            img_url: set.set_img_url,
            year:    set.year,
            theme:   themeName && themeName !== 'Unknown' ? themeName : null
        }]);
        if (error) throw error;

        saved.add(setNum);
        noteSavedForStats(isCol ? 'collection' : 'wishlist', { set_num: setNum, theme: themeName });
        showToast(isCol ? `Added "${set.name}" to collection!` : `Added "${set.name}" to wish list!`, 'success');
        rerenderSearchList();
        if (isCol) loadLastAdded();
    } catch (err) {
        showToast('Database Error: ' + (err.message || 'could not save'), 'error');
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
}

async function selectSearchResult(setNum, themeId) {
    const container = document.getElementById('result-container');
    container.innerHTML = '<p>Loading set details...</p>';
    try {
        const setRes = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`);
        if (!setRes.ok) throw new Error("Set not found.");
        const setData = await setRes.json();

        // fetchTheme uses cache — no extra API call if already fetched during search
        const themeName = await fetchTheme(themeId || setData.theme_id); // callers like Recently Added pass 0
        currentSet = { ...setData, theme_name: themeName };
        renderSearchResult(currentSet);
    } catch (err) {
        container.innerHTML = `<p class="search-msg search-msg--error">${escapeHTML(err.message)}</p>`;
    }
}

// ============================================================
// PRICE ROW
// Shows LEGO.com list price (via /api/brickset) plus deep-link
// buttons to LEGO.com, Amazon, and Target for the current set.
// ============================================================

// Rebrickable uses "10305-1"; retailers search on the bare number "10305"
function retailSetNumber(setNum) {
    return String(setNum).replace(/-\d+$/, '');
}

function retailerLinks(setNum) {
    const num = encodeURIComponent(retailSetNumber(setNum));
    return [
        { key: 'lego',   label: 'LEGO.com', url: `https://www.lego.com/en-us/search?q=${num}` },
        { key: 'amazon', label: 'AMAZON',   url: `https://www.amazon.com/s?k=LEGO+${num}` },
        { key: 'target', label: 'TARGET',   url: `https://www.target.com/s?searchTerm=LEGO+${num}` }
    ];
}

function priceRowHTML(setNum) {
    const buttons = retailerLinks(setNum).map(r => `
        <a class="price-btn price-btn--${r.key}" href="${r.url}" target="_blank" rel="noopener"
           title="Check current price on ${r.label}">${r.label} ↗</a>
    `).join('');

    return `
        <div class="price-row" data-set="${setNum}">
            <div class="price-row-list">
                <span class="price-row-label">LEGO.com LIST</span>
                <span class="price-row-value" id="list-price-value"><span class="skeleton skeleton-text price-row-skeleton"></span></span>
                <span id="list-retire-status"></span>
            </div>
            <div class="price-row-btns">${buttons}</div>
        </div>
    `;
}

async function loadListPrice(setNum) {
    // Shared with the details window via core.js (cached per page load)
    const info  = await fetchBricksetInfo(setNum);
    const price = info === undefined ? undefined : info.retailPrice;

    // Guard against a stale response if the user already moved to another set
    const row = document.querySelector('.price-row');
    if (!row || row.dataset.set !== setNum) return;
    const el = document.getElementById('list-price-value');
    if (!el) return;

    if (typeof price === 'number') {
        el.textContent = `$${price.toFixed(2)}`;
        el.classList.remove('price-row-value--none');
    } else if (price === null) {
        el.textContent = 'N/A';
        el.title = 'No LEGO.com list price on file (often means the set is retired)';
        el.classList.add('price-row-value--none');
    } else {
        el.textContent = 'ERR';
        el.title = 'Could not reach Brickset';
        el.classList.add('price-row-value--none');
    }
    const retireEl = document.getElementById('list-retire-status');
    if (retireEl && info) retireEl.innerHTML = retirementBadge(info.exitDate);
}

function renderSearchResult(set) {
    const inCollection = collectionSetNums.has(set.set_num);
    const inWantlist   = wantlistSetNums.has(set.set_num);

    const statusBanner = (inCollection || inWantlist) ? `
        <div class="search-status-banner">
            ${inCollection ? `<span class="presence-badge presence-badge--collection">✓ ALREADY IN COLLECTION</span>` : ''}
            ${inWantlist   ? `<span class="presence-badge presence-badge--wantlist">♥ ALREADY IN WISH LIST</span>`   : ''}
        </div>` : '';

    document.getElementById('result-container').innerHTML = `
        <h2>${escapeHTML(set.name)}</h2>
        <div class="set-meta">
            <strong>Year:</strong> ${set.year} | <strong>Theme:</strong> ${escapeHTML(set.theme_name)} |
            <strong>Set #:</strong> <a href="https://rebrickable.com/sets/${set.set_num}/" target="_blank" rel="noopener" class="rebrickable-link" title="View on Rebrickable">${set.set_num} ↗</a>
            &nbsp;·&nbsp; <a href="${brickEconomyUrl(set.set_num)}" target="_blank" rel="noopener" class="brickeconomy-link" title="Check market value on BrickEconomy">📈 BrickEconomy ↗</a>
        </div>
        ${statusBanner}
        ${priceRowHTML(set.set_num)}
        <div class="search-img-wrap" onclick="openImageLightbox()" title="Click to view details">
            <img id="search-result-img" src="${set.set_img_url}" alt="${escapeHTML(set.name)}" class="set-result-img">
            <div class="search-img-hint">🔍 click to enlarge</div>
        </div>
        <p>Parts: ${set.num_parts}</p>
        ${conditionSelectHTML()}
        <div class="price-paid-field">
            <label for="price-paid-input" class="price-paid-label">PRICE PAID (USD) — optional</label>
            <div class="price-paid-row">
                <span class="price-paid-currency">$</span>
                <input id="price-paid-input" class="price-paid-input" type="number" min="0" step="0.01" placeholder="0.00">
            </div>
        </div>
        <div class="set-result-actions">
            <button class="save-btn" onclick="saveCurrentSet()">+ ADD TO COLLECTION</button>
            <button class="wantlist-btn" onclick="saveToWantList()">♥ ADD TO WISH LIST</button>
        </div>
    `;
    const img = document.getElementById('search-result-img');
    if (img) attachImgFallback(img);
    loadListPrice(set.set_num);
}

// --- Image Lightbox Gallery ---
// Shared gallery state for the currently open lightbox
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
    const pricePaidRaw = document.getElementById('price-paid-input')?.value || '';
    const pricePaid = pricePaidRaw !== '' ? parseFloat(pricePaidRaw) : null;

    const { error } = await db.from('lego_collection').insert([{
        set_num: currentSet.set_num,
        name: currentSet.name,
        img_url: currentSet.set_img_url,
        year: currentSet.year,
        theme: currentSet.theme_name,
        condition: condition || null,
        price_paid: (!isNaN(pricePaid) && pricePaid !== null) ? pricePaid : null
    }]);

    if (error) {
        showToast("Database Error: " + error.message, 'error');
    } else {
        collectionSetNums.add(currentSet.set_num); // Update presence cache instantly
        noteSavedForStats('collection', { set_num: currentSet.set_num, theme: currentSet.theme_name });
        showToast("Added to collection!", 'success');
        renderSearchResult(currentSet); // Refresh to show badge
        loadLastAdded(); // Refresh dashboard after save
    }
}

async function loadLastAdded() {
    const container = document.getElementById('last-added-container');
    if (!container) return;
    const { data, error } = await db.from('lego_collection')
        .select('*').order('created_at', { ascending: false }).limit(RECENTLY_ADDED_COUNT);

    if (error || !data || data.length === 0) {
        container.innerHTML = "<div class='recently-added-empty'>No sets yet.</div>";
        return;
    }

    container.innerHTML = data.map(item => `
        <div class="recently-added-item" onclick="selectSotdSet('${item.set_num}', 0)" title="${escapeHTML(item.name)}">
            <img src="${item.img_url || ''}" alt="${escapeHTML(item.name)}">
            <div class="recently-added-item-text">
                <div class="recently-added-item-name">${escapeHTML(item.name)}</div>
                <div class="recently-added-item-meta">${item.theme || '-'} · ${item.year || '-'}</div>
            </div>
        </div>
    `).join('');
    // Broken thumbnails get the shared placeholder (the old inline onerror
    // had nested quotes that made it a syntax error, so it never ran)
    container.querySelectorAll('img').forEach(attachImgFallback);
}



// --- View Mode ---
async function saveToWantList() {
    if (!currentSet) return;

    const { data: existing, error: checkError } = await db
        .from('lego_wantlist')
        .select('id')
        .eq('set_num', currentSet.set_num)
        .limit(1);

    if (checkError) { showToast("Database Error: " + checkError.message, 'error'); return; }
    if (existing && existing.length > 0) { showToast(`"${currentSet.name}" is already on your wish list!`, 'warning'); return; }

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
        noteSavedForStats('wishlist', currentSet);
        showToast("Added to wish list!", 'success');
        renderSearchResult(currentSet); // Refresh to show badge
    }
}

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

// --- SPIN AGAIN (Set of the Day + Part of the Day) ---
// spin 0 = today's real pick. Each spin bumps the number and re-runs the
// same date-seeded math with a different offset, so today's pick stays the
// same on every reload and spins are just extras for this visit.
const dailySpin = {
    sotd: { spin: 0, busy: false, section: 'sotd-section', load: s => loadSetOfTheDay(s) },
    potd: { spin: 0, busy: false, section: 'potd-section', load: s => loadPartOfTheDay(s) },
};

// --- Picking from the WHOLE catalog ---
// The old picker only ever reached the first 200 pages (≈2,000 sets) in
// set-number order, so picks skewed toward old 90s numbers. Now we ask
// Rebrickable how many qualifying sets exist, then jump to a random page
// anywhere in that range.
const SOTD_FILTER    = 'min_parts=50';
const SOTD_PAGE_SIZE = 10;
const SOTD_COUNT_KEY = '90sgeek_sotd_count_v1';
const SOTD_COUNT_TTL = 7 * 24 * 60 * 60 * 1000; // re-check the catalog size weekly
const SOTD_FALLBACK_PAGES = 200;                  // used only if the count lookup fails

// How many pages a Rebrickable catalog listing has, cached for a week.
// path: 'lego/sets/' or 'lego/parts/'; filter: extra query (may be '').
async function getCatalogPageCount(storageKey, path, filter, pageSize, fallbackPages) {
    try {
        const { savedAt, count } = JSON.parse(localStorage.getItem(storageKey) || '{}');
        if (count > 0 && Date.now() - savedAt < SOTD_COUNT_TTL) return Math.ceil(count / pageSize);
    } catch {}
    try {
        const res = await rebrickableFetch(`https://rebrickable.com/api/v3/${path}?page_size=1${filter ? '&' + filter : ''}`);
        if (!res.ok) throw new Error();
        const count = (await res.json()).count;
        if (!(count > 0)) throw new Error();
        try { localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), count })); } catch {}
        return Math.ceil(count / pageSize);
    } catch {
        return fallbackPages;
    }
}

function getSotdPageCount() {
    return getCatalogPageCount(SOTD_COUNT_KEY, 'lego/sets/', SOTD_FILTER, SOTD_PAGE_SIZE, SOTD_FALLBACK_PAGES);
}

// Repeatable "random" numbers from a text seed: the same seed always gives
// the same sequence, so a date + spin number always lands on the same set.
// (FNV-1a hash of the seed feeding a mulberry32 generator.)
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

function localDateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadSetOfTheDay(spin = 0) {
    const container = document.getElementById('sotd-container');
    const dateLabel = document.getElementById('sotd-date');
    if (!container) return false;

    const now = new Date();
    if (dateLabel) {
        dateLabel.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    }

    // Seeded by the full date (not day-of-year, so each year differs too)
    // plus the spin number. Each attempt draws a fresh random page and
    // candidate; a page full of bulk/parts packs just moves on to another.
    const totalPages = await getSotdPageCount();
    const rand = seededRandom(`${localDateKey(now)}|sotd|${spin}`);

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        const page = 1 + Math.floor(rand() * totalPages);
        const pick = Math.floor(rand() * SOTD_PAGE_SIZE);
        try {
            const res = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/?page=${page}&page_size=${SOTD_PAGE_SIZE}&${SOTD_FILTER}&ordering=set_num`);
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            const candidates = data.results || [];
            if (!candidates.length) throw new Error('No sets returned');

            // Resolve all theme names in parallel
            await Promise.all([...new Set(candidates.map(s => s.theme_id))].map(id => fetchTheme(id)));

            // Filter out bulk/parts themes, then pick by index (wrap around if needed)
            const valid = candidates.filter(s => !isSotdExcluded(themeCache[s.theme_id]));
            if (!valid.length) throw new Error('No valid sets after filtering');

            const set = valid[pick % valid.length];
            renderSetOfTheDay({ ...set, theme_name: themeCache[set.theme_id] || 'Unknown' });
            return true;
        } catch (err) {
            lastErr = err;
        }
    }

    console.error('Set of the Day failed:', lastErr);
    // A failed spin keeps the set already on screen; only the first load shows an error
    if (spin === 0 && container) container.innerHTML = `<span class="sotd-error">Could not load set of the day.</span>`;
    return false;
}

// kind: 'sotd' | 'potd'. dir 1 = spin again, 0 = back to today's pick.
async function spinDaily(kind, dir = 1) {
    const st = dailySpin[kind];
    if (!st || st.busy) return;
    const prev = st.spin;
    st.spin = dir === 0 ? 0 : st.spin + 1; // set first so the card's badge is right
    st.busy = true;
    const section = document.getElementById(st.section);
    section?.classList.add('is-spinning');
    updateSpinControls(kind);

    const ok = await st.load(st.spin);
    if (!ok) {
        st.spin = prev; // the previous pick is still on screen
        showToast('Could not spin — try again in a moment.', 'error');
    }

    st.busy = false;
    section?.classList.remove('is-spinning');
    updateSpinControls(kind);
}

// Adds the SPIN AGAIN / TODAY'S PICK buttons to a daily card's header
function initSpinControls(kind) {
    const st = dailySpin[kind];
    const header = st && document.querySelector(`#${st.section} .sotd-header`);
    if (!header || header.querySelector('.sotd-spin')) return;
    const wrap = document.createElement('div');
    wrap.className = 'sotd-spin';
    wrap.innerHTML = `
        <button type="button" class="sotd-spin-btn sotd-spin-btn--today" onclick="spinDaily('${kind}', 0)" title="Go back to today's pick" hidden>↺ TODAY'S PICK</button>
        <button type="button" class="sotd-spin-btn sotd-spin-btn--again" onclick="spinDaily('${kind}', 1)" title="Show a different random pick">⟳ SPIN AGAIN</button>
    `;
    header.appendChild(wrap);
    updateSpinControls(kind);
}

function updateSpinControls(kind) {
    const st = dailySpin[kind];
    const header = st && document.querySelector(`#${st.section} .sotd-header`);
    if (!header) return;
    const spinBtn  = header.querySelector('.sotd-spin-btn--again');
    const todayBtn = header.querySelector('.sotd-spin-btn--today');
    if (spinBtn) {
        spinBtn.disabled = st.busy;
        spinBtn.textContent = st.busy ? '⟳ SPINNING…' : '⟳ SPIN AGAIN';
    }
    if (todayBtn) {
        todayBtn.hidden = st.spin === 0;
        todayBtn.disabled = st.busy;
    }
}

function renderSetOfTheDay(set) {
    const container = document.getElementById('sotd-container');
    if (!container) return;

    const inCollection = collectionSetNums.has(set.set_num);
    const inWantlist   = wantlistSetNums.has(set.set_num);
    const spinNo = dailySpin.sotd.spin;
    const badge = spinNo > 0 ? `⟳ SPIN #${spinNo}` : '⚄ DAILY PICK';

    container.innerHTML = `
        <div class="sotd-body">
            <div class="sotd-img-panel" onclick="selectSotdSet('${set.set_num}', ${set.theme_id})" title="Click to view set details">
                <img id="sotd-img" src="${set.set_img_url || ''}" alt="${escapeHTML(set.name)}">
                <span class="sotd-badge">${badge}</span>
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
                            <span class="sotd-meta-val sotd-meta-val--small">${escapeHTML(set.theme_name)}</span>
                            <span class="sotd-meta-lbl">Theme</span>
                        </div>
                    </div>
                    <div class="sotd-code">${set.set_num}</div>
                    ${inCollection ? '<span class="presence-badge presence-badge--collection sotd-badge-gap">✓ IN COLLECTION</span>' : ''}
                    ${inWantlist   ? '<span class="presence-badge presence-badge--wantlist">♥ IN WISH LIST</span>' : ''}
                </div>
                <div class="sotd-actions">
                    <button class="sotd-btn primary" onclick="selectSotdSet('${set.set_num}', ${set.theme_id})">VIEW SET</button>
                    <button class="sotd-btn" onclick="sotdSaveToCollection('${set.set_num}', ${set.theme_id})">+ COLLECT</button>
                    <button class="sotd-btn" onclick="sotdSaveToWantlist('${set.set_num}', ${set.theme_id})">♥ WISH</button>
                </div>
            </div>
        </div>
    `;
    const img = document.getElementById('sotd-img');
    if (img) attachImgFallback(img);
}

// --- PART OF THE DAY ---
// Same deterministic-by-date approach as Set of the Day, but pulls from
// Rebrickable's /lego/parts/ catalog endpoint instead of /lego/sets/.
// No pricing/collection data exists for individual parts, so this is
// purely a showcase — it links out to the part's Rebrickable page.

const POTD_EXCLUDE_CATEGORIES = [
    'sticker', 'instructions', 'catalog', 'box', 'gear',
    'duplo', 'primo', 'quatro', 'book'
];

function isPotdExcluded(categoryName) {
    if (!categoryName) return false;
    const lower = categoryName.toLowerCase();
    return POTD_EXCLUDE_CATEGORIES.some(ex => lower.includes(ex));
}

// Same whole-catalog approach as Set of the Day (the old picker only
// reached the first 300 pages of parts, in part-number order).
const POTD_PAGE_SIZE      = 15;
const POTD_COUNT_KEY      = '90sgeek_potd_count_v1';
const POTD_FALLBACK_PAGES = 300;
const POTD_ATTEMPTS       = 5; // parts deep in the catalog are more often imageless/stickers

async function loadPartOfTheDay(spin = 0) {
    const container = document.getElementById('potd-container');
    const dateLabel = document.getElementById('potd-date');
    if (!container) return false;

    const now = new Date();
    if (dateLabel) {
        dateLabel.textContent = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    }

    // Fetch a page of 15 candidates so we can filter out parts with no
    // image and non-brick categories (stickers, gear, etc.) and still land
    // on a real part. Seeded by date + spin ('potd' keeps it independent of
    // Set of the Day); each attempt draws a fresh random page and candidate.
    const totalPages = await getCatalogPageCount(POTD_COUNT_KEY, 'lego/parts/', '', POTD_PAGE_SIZE, POTD_FALLBACK_PAGES);
    const rand = seededRandom(`${localDateKey(now)}|potd|${spin}`);

    let lastErr = null;
    for (let attempt = 0; attempt < POTD_ATTEMPTS; attempt++) {
        const page = 1 + Math.floor(rand() * totalPages);
        const pick = Math.floor(rand() * POTD_PAGE_SIZE);
        try {
            const res = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/parts/?page=${page}&page_size=${POTD_PAGE_SIZE}&ordering=part_num`);
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            const candidates = (data.results || []).filter(p => p.part_img_url);
            if (!candidates.length) throw new Error('No parts with images on this page');

            // Resolve all category names in parallel
            await Promise.all([...new Set(candidates.map(p => p.part_cat_id))].map(id => fetchPartCategory(id)));

            // Filter out sticker/gear/etc. categories, then pick by index (wrap around if needed)
            const valid = candidates.filter(p => !isPotdExcluded(partCategoryCache[p.part_cat_id]));
            if (!valid.length) throw new Error('No valid parts after filtering');

            const part = valid[pick % valid.length];
            renderPartOfTheDay({ ...part, category_name: partCategoryCache[part.part_cat_id] || 'Unknown' });
            return true;
        } catch (err) {
            lastErr = err;
        }
    }

    console.error('Part of the Day failed:', lastErr);
    // A failed spin keeps the part already on screen; only the first load shows an error
    if (spin === 0 && container) container.innerHTML = `<span class="sotd-error">Could not load part of the day.</span>`;
    return false;
}

function renderPartOfTheDay(part) {
    const container = document.getElementById('potd-container');
    if (!container) return;

    container.innerHTML = `
        <div class="sotd-body">
            <div class="sotd-img-panel" onclick="window.open('${part.part_url}', '_blank')" title="Click to view on Rebrickable">
                <img id="potd-img" src="${part.part_img_url || ''}" alt="${escapeHTML(part.name)}">
                <span class="sotd-badge">${dailySpin.potd.spin > 0 ? `⟳ SPIN #${dailySpin.potd.spin}` : '⚉ DAILY PICK'}</span>
                <span class="sotd-enlarge-hint">🔍 click to view</span>
            </div>
            <div class="sotd-info-panel">
                <div>
                    <div class="sotd-name">${escapeHTML(part.name)}</div>
                    <div class="sotd-meta-row">
                        <div class="sotd-meta-item">
                            <span class="sotd-meta-val sotd-meta-val--small">${escapeHTML(part.category_name)}</span>
                            <span class="sotd-meta-lbl">Category</span>
                        </div>
                    </div>
                    <div class="sotd-code">${part.part_num}</div>
                </div>
                <div class="sotd-actions">
                    <a class="sotd-btn primary sotd-btn--link" href="${part.part_url}" target="_blank" rel="noopener">VIEW ON REBRICKABLE</a>
                </div>
            </div>
        </div>
    `;
    const img = document.getElementById('potd-img');
    if (img) attachImgFallback(img);
}

async function selectSotdSet(setNum, themeId) {
    const container = document.getElementById('result-container');
    container.style.display = 'block';
    container.innerHTML = '<p>Loading set details...</p>';
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
        const setRes = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`);
        if (!setRes.ok) throw new Error('Set not found.');
        const setData = await setRes.json();
        const themeName = await fetchTheme(themeId || setData.theme_id); // callers like Recently Added pass 0
        currentSet = { ...setData, theme_name: themeName };
        renderSearchResult(currentSet);
    } catch (err) {
        container.innerHTML = `<p class="search-msg search-msg--error">${escapeHTML(err.message)}</p>`;
    }
}

async function sotdSaveToCollection(setNum, themeId) {
    try {
        const res = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`);
        const setData = await res.json();
        const themeName = await fetchTheme(themeId || setData.theme_id); // callers like Recently Added pass 0
        currentSet = { ...setData, theme_name: themeName };
        await saveCurrentSet();
        renderSetOfTheDay({ ...currentSet, theme_name: themeName });
    } catch { showToast('Could not save set.', 'error'); }
}

async function sotdSaveToWantlist(setNum, themeId) {
    try {
        const res = await rebrickableFetch(`https://rebrickable.com/api/v3/lego/sets/${setNum}/`);
        const setData = await res.json();
        const themeName = await fetchTheme(themeId || setData.theme_id); // callers like Recently Added pass 0
        currentSet = { ...setData, theme_name: themeName };
        await saveToWantList();
        renderSetOfTheDay({ ...currentSet, theme_name: themeName });
    } catch { showToast('Could not save set.', 'error'); }
}

// --- SEARCH BOX CLEAR (×) BUTTON ---
// Wraps #set-input and adds a clear button that appears only when the box
// has text. Esc also clears. Built here so index.html needs no changes.
function initSearchClear() {
    const input = document.getElementById('set-input');
    if (!input || input.dataset.clearReady) return;
    input.dataset.clearReady = '1';
    input.setAttribute('autocomplete', 'off'); // stop Chrome's autofill styling/suggestions

    const wrap = document.createElement('div');
    wrap.className = 'search-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button'; // don't submit the form
    btn.className = 'search-clear-btn';
    btn.setAttribute('aria-label', 'Clear search');
    btn.title = 'Clear (Esc)';
    btn.textContent = '×';
    wrap.appendChild(btn);

    const sync  = () => wrap.classList.toggle('has-value', input.value.length > 0);
    const clear = () => { input.value = ''; sync(); input.focus(); };

    btn.addEventListener('click', clear);
    input.addEventListener('input', sync);
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape' && input.value) { e.preventDefault(); clear(); }
    });
    sync();
}

// --- RESULTS PLACEMENT ---
// Move the results panel directly under the search box. It stays hidden
// (display:none) until a search runs, so Set of the Day / Part of the Day
// sit right below the search box when there are no results.
function placeResultsBelowSearch() {
    const box     = document.querySelector('.search-box');
    const results = document.getElementById('result-container');
    if (box && results && box.nextElementSibling !== results) box.after(results);
}

// --- RECENTLY ADDED SKELETON ---
// index.html ships 3 placeholder cards but loadLastAdded() shows 5, so the
// panel jumped when data arrived. Top the placeholders up to match.
const RECENTLY_ADDED_COUNT = 5;

function padRecentlyAddedSkeleton() {
    const container = document.getElementById('last-added-container');
    if (!container) return;
    const skeletons = container.querySelectorAll('.recently-added-skeleton-item');
    // Only pad while the placeholders are still showing (data not loaded yet)
    if (!skeletons.length || container.children.length !== skeletons.length) return;
    for (let i = skeletons.length; i < RECENTLY_ADDED_COUNT; i++) {
        container.appendChild(skeletons[0].cloneNode(true));
    }
}

function initSearchPage() {
    initStatsStrip();
    initSearchClear();
    placeResultsBelowSearch();
    padRecentlyAddedSkeleton();
    initSpinControls('sotd');
    initSpinControls('potd');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSearchPage);
} else {
    initSearchPage();
}
