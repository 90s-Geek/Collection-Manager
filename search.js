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

// Cache of all Rebrickable themes, loaded once per session
let allThemesCache = null;

async function getAllThemes() {
    if (allThemesCache) return allThemesCache;
    // Fetch all themes across pages (Rebrickable has ~900 themes total)
    let url = `https://rebrickable.com/api/v3/lego/themes/?page_size=500`;
    let all = [];
    while (url) {
        const res = await fetch(url, { headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` } });
        if (!res.ok) break;
        const data = await res.json();
        all = all.concat(data.results || []);
        url = data.next || null;
    }
    allThemesCache = all;
    return all;
}

async function searchByName(query, container) {
    try {
        const q = query.toLowerCase().trim();
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Fetch all themes and set name search in parallel
        const [allThemes, setRes] = await Promise.all([
            getAllThemes(),
            fetch(`https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(query)}&page_size=20&ordering=-year`, {
                headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` }
            })
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
            container.innerHTML = `<p style="color:#ff6666;">No sets found for "<strong>${escapeHTML(query)}</strong>".</p>`;
            return;
        }

        searchQuery      = query;
        searchNextUrl    = data.next || null;
        searchAllResults = data.results;

        const themeIds = [...new Set(data.results.map(s => s.theme_id))];
        await Promise.all(themeIds.map(id => fetchTheme(id)));

        renderNameSearchResults(searchAllResults, themeCache, query, data.count);
    } catch (err) {
        container.innerHTML = `<p style="color:red;">${err.message}</p>`;
    }
}

async function searchByThemeId(themeId, themeName, container) {
    searchQuery      = themeName;
    searchNextUrl    = null;
    searchAllResults = [];

    const url = `https://rebrickable.com/api/v3/lego/sets/?theme_id=${themeId}&page_size=20&ordering=-year`;
    const res = await fetch(url, { headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` } });
    if (!res.ok) throw new Error("Theme search failed.");
    const data = await res.json();

    searchNextUrl    = data.next || null;
    searchAllResults = data.results || [];

    const themeIds = [...new Set(searchAllResults.map(s => s.theme_id))];
    await Promise.all(themeIds.map(id => fetchTheme(id)));

    if (!searchAllResults.length) {
        container.innerHTML = `<p style="color:#ff6666;">No sets found for theme "<strong>${escapeHTML(themeName)}</strong>".</p>`;
        return;
    }

    renderNameSearchResults(searchAllResults, themeCache, `Theme: ${themeName}`, data.count);
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
    const rows = results.map(set => `
        <li class="search-result-item" onclick="selectSearchResult('${set.set_num}', ${set.theme_id})">
            <img src="${set.set_img_url || ''}" alt="${set.name}" width="50" loading="lazy" style="border:1px solid #333; flex-shrink:0; background:#fff;">
            <div class="search-result-info">
                <strong>${escapeHTML(set.name)}</strong>
                <span class="search-result-meta">${set.set_num} &nbsp;|&nbsp; ${set.year} &nbsp;|&nbsp; ${themeMap[set.theme_id] || 'Unknown'}</span>
                ${presenceBadge(set.set_num)}
            </div>
        </li>
    `).join('');

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
            ${inWantlist   ? `<span class="presence-badge presence-badge--wantlist">♥ ALREADY IN WISH LIST</span>`   : ''}
        </div>` : '';

    document.getElementById('result-container').innerHTML = `
        <h2>${set.name}</h2>
        <div class="set-meta">
            <strong>Year:</strong> ${set.year} | <strong>Theme:</strong> ${set.theme_name} | 
            <strong>Set #:</strong> <a href="https://rebrickable.com/sets/${set.set_num}/" target="_blank" rel="noopener" style="color:#00ffff;text-decoration:none;" title="View on Rebrickable">${set.set_num} ↗</a>
            &nbsp;·&nbsp; <a href="${brickEconomyUrl(set.set_num)}" target="_blank" rel="noopener" style="color:#ffaa00;text-decoration:none;font-size:0.9em;" title="Check market value on BrickEconomy">📈 BrickEconomy ↗</a>
        </div>
        ${statusBanner}
        <div class="search-img-wrap" onclick="openImageLightbox()" title="Click to view details">
            <img id="search-result-img" src="${set.set_img_url}" alt="${set.name}" style="max-width:250px; border:1px solid #0f0; margin-bottom:4px; cursor:pointer;">
            <div class="search-img-hint">🔍 click to enlarge</div>
        </div>
        <p>Parts: ${set.num_parts}</p>
        ${conditionSelectHTML()}
        <div style="margin-top:10px;">
            <label style="font-family:var(--mono);font-size:0.75em;color:var(--text-muted);letter-spacing:1px;display:block;margin-bottom:4px;">PRICE PAID (USD) — optional</label>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-family:var(--mono);color:var(--green);font-size:1em;">$</span>
                <input id="price-paid-input" type="number" min="0" step="0.01" placeholder="0.00"
                    style="background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:6px 10px;font-family:var(--mono);font-size:0.9em;width:120px;outline:none;"
                    onfocus="this.style.borderColor='var(--green-dim)'" onblur="this.style.borderColor='var(--border2)'">
            </div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:10px;">
            <button class="save-btn" onclick="saveCurrentSet()">+ ADD TO COLLECTION</button>
            <button class="wantlist-btn" onclick="saveToWantList()">♥ ADD TO WISH LIST</button>
        </div>
    `;
    const img = document.getElementById('search-result-img');
    if (img) attachImgFallback(img);
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

    // Fetch a page of candidates so we can filter out bulk/parts packs
    // and still land on a real set. Use day-of-year to pick the starting
    // page, then use day % page_size to pick which candidate within it.
    // If an entire page happens to be excluded themes (e.g. a run of
    // Educational/Dacta/bulk sets), step to the next page and retry
    // rather than giving up — this can legitimately happen since sets
    // are ordered by set_num and some ranges are theme-clustered.
    const totalPages   = 200;
    const pageSize      = 25;
    const startPage     = (dayOfYear % totalPages) + 1;
    const candidateIdx  = dayOfYear % pageSize;
    const maxAttempts   = 5;

    try {
        let valid = [];
        let page = startPage;
        let lastErr = null;

        for (let attempt = 0; attempt < maxAttempts && !valid.length; attempt++) {
            const res = await fetch(
                `https://rebrickable.com/api/v3/lego/sets/?page=${page}&page_size=${pageSize}&min_parts=50&ordering=set_num`,
                { headers: { 'Authorization': `key ${REBRICKABLE_API_KEY}` } }
            );
            if (!res.ok) {
                let bodyText = '';
                try { bodyText = await res.text(); } catch {}
                throw new Error(`API error ${res.status} ${res.statusText} — ${bodyText.slice(0, 200)}`);
            }
            const data = await res.json();
            const candidates = data.results || [];
            if (!candidates.length) {
                lastErr = new Error('No sets returned (page ' + page + ')');
                page = (page % totalPages) + 1;
                continue;
            }

            // Resolve all theme names in parallel
            await Promise.all([...new Set(candidates.map(s => s.theme_id))].map(id => fetchTheme(id)));

            // Filter out bulk/parts themes
            valid = candidates.filter(s => !isSotdExcluded(themeCache[s.theme_id]));
            if (!valid.length) {
                lastErr = new Error('No valid sets after filtering (page ' + page + ')');
                page = (page % totalPages) + 1; // whole page was excluded — try the next one
                continue;
            }

            const set = valid[candidateIdx % valid.length];
            renderSetOfTheDay({ ...set, theme_name: themeCache[set.theme_id] || 'Unknown' });
            return;
        }

        throw lastErr || new Error('No valid sets found after ' + maxAttempts + ' attempts');
    } catch (err) {
        console.error('Set of the Day failed:', err);
        if (container) container.innerHTML = `<span style="color:#666;font-size:0.75em;">Could not load set of the day — ${escapeHTML(err.message || String(err))}</span>`;
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
                    ${inWantlist   ? '<span class="presence-badge presence-badge--wantlist">♥ IN WISH LIST</span>' : ''}
                </div>
                <div class="sotd-actions" style="margin-top:14px;">
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

