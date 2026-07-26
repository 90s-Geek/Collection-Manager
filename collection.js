// ============================================================
// collection.js — collection.html only
// Collection list load/filter/sort/render, item detail edits
// (condition/price/market value), bulk select actions, and
// CSV import/export.
// Depends on core.js (must be loaded first).
// ============================================================
let bulkMode = false;
let bulkSelected = new Set(); // Set of item IDs currently selected

// --- Wantlist drag-to-reorder state ---
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
        img.loading = 'lazy';
        img.style.cssText = `margin-right:${currentView === 'grid' ? '0' : '10px'};border:1px solid #0f0;cursor:pointer;`;
        attachImgFallback(img);
        img.addEventListener('click', e => { e.stopPropagation(); openItemLightbox(item); });

        const textDiv = document.createElement('div');
        const priceBadge = item.price_paid != null
            ? `<span style="font-family:var(--mono);font-size:0.62em;color:var(--green);margin-left:6px;border:1px solid var(--green-dim);padding:1px 5px;border-radius:3px;vertical-align:middle;" title="Price paid">$${Number(item.price_paid).toFixed(2)}</span>`
            : '';
        const marketBadge = item.market_value != null
            ? `<span style="font-family:var(--mono);font-size:0.62em;color:#ffaa00;margin-left:4px;border:1px solid #4a3200;padding:1px 5px;border-radius:3px;vertical-align:middle;" title="Market value">📈$${Number(item.market_value).toFixed(2)}</span>`
            : '';
        textDiv.innerHTML = `
            <strong>${item.name}</strong> (${item.year})${conditionBadge(item.condition)}${priceBadge}${marketBadge}<br>
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

async function updatePricePaid(id) {
    const raw = document.getElementById('modal-price-input')?.value;
    const price_paid = (raw !== '' && raw != null) ? parseFloat(raw) : null;
    const { error } = await db.from('lego_collection').update({ price_paid: (!isNaN(price_paid) && price_paid !== null) ? price_paid : null }).eq('id', id);
    if (error) {
        showToast("Error updating price: " + error.message, 'error');
        return;
    }
    const item = collectionCache.find(i => i.id === id);
    if (item) item.price_paid = price_paid;
    showToast("Price updated!", 'success');
    applyControls();
    document.getElementById('set-modal').classList.remove('active');
}

async function updateMarketValue(id) {
    const raw = document.getElementById('modal-market-input')?.value;
    const market_value = (raw !== '' && raw != null) ? parseFloat(raw) : null;
    const { error } = await db.from('lego_collection').update({
        market_value: (!isNaN(market_value) && market_value !== null) ? market_value : null
    }).eq('id', id);
    if (error) {
        showToast("Error updating market value: " + error.message, 'error');
        return;
    }
    const item = collectionCache.find(i => i.id === id);
    if (item) item.market_value = market_value;
    showToast("Market value updated!", 'success');
    applyControls();
    document.getElementById('set-modal').classList.remove('active');
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

async function bulkExportSelected() {
    const items = collectionCache.filter(i => bulkSelected.has(i.id));
    if (!items.length) return showToast('No sets selected.', 'warning');
    showToast("Fetching retail prices… this may take a moment.", 'info');
    await prefetchRetailPrices(items.map(i => i.set_num));
    const headers = ['set_num', 'name', 'theme', 'year', 'condition', 'price_paid', 'market_value', 'retail_price', 'img_url'];
    const rows = items.map(item => {
        const retail = retailPriceCache[item.set_num] ?? '';
        return [
            ...['set_num', 'name', 'theme', 'year', 'condition', 'price_paid', 'market_value'].map(h => `"${(item[h] != null ? item[h] : '').toString().replace(/"/g, '""')}"`),
            `"${retail}"`,
            `"${(item.img_url || '').replace(/"/g, '""')}"`
        ].join(',');
    });
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

// --- WISH LIST ---

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

// --- Import mode: 'add' (insert new only) or 'sync' (upsert all) ---
let importMode = 'add';

function setImportMode(mode) {
    importMode = mode;
    const addBtn  = document.getElementById('mode-add');
    const syncBtn = document.getElementById('mode-sync');
    const hint    = document.getElementById('import-mode-hint');
    if (!addBtn || !syncBtn) return;

    if (mode === 'add') {
        addBtn.style.background  = '#00ff0022';
        addBtn.style.color       = '#00ff88';
        syncBtn.style.background = '#111';
        syncBtn.style.color      = '#555';
        if (hint) hint.textContent = 'Add new sets only — existing records are skipped.';
    } else {
        syncBtn.style.background = '#00e5ff22';
        syncBtn.style.color      = '#00e5ff';
        addBtn.style.background  = '#111';
        addBtn.style.color       = '#555';
        if (hint) hint.textContent = 'Update existing sets AND add new ones. name, theme, year, condition, price_paid, img_url will be overwritten.';
    }

    // Re-run preview if a file was already selected
    const fileInput = document.getElementById('csv-file-input');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        handleCSVFile({ target: fileInput });
    }
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

    // Fetch existing set_nums from collection
    const { data: existing } = await db.from('lego_collection').select('set_num');
    const existingNums = new Set((existing || []).map(r => r.set_num));

    // Normalise set_num (add -1 suffix if missing)
    const normalise = s => /^\d+$/.test(s.trim()) ? `${s.trim()}-1` : s.trim();
    const normRows = rows.map(r => ({ ...r, set_num: normalise(r.set_num) }));

    const toUpdate = importMode === 'sync' ? normRows.filter(r => existingNums.has(r.set_num))  : [];
    const toInsert = normRows.filter(r => !existingNums.has(r.set_num));
    const skipped  = importMode === 'add' ? normRows.length - toInsert.length : 0;

    const totalOps = toUpdate.length + toInsert.length;

    if (totalOps === 0) {
        if (importMode === 'add') {
            preview.innerHTML = `<p style="color:#ffaa00;">All ${rows.length} sets are already in your collection. Nothing to import.</p>`;
        } else {
            preview.innerHTML = `<p style="color:#ffaa00;">No matching sets found in your collection, and no new sets to add.</p>`;
        }
        return;
    }

    const previewLines = [
        ...toUpdate.map(r => `<div style="color:#00e5ff;margin-bottom:2px;">⟳ ${r.set_num}${r.name ? ' — ' + r.name : ''}</div>`),
        ...toInsert.map(r => `<div style="color:#00ff00;margin-bottom:2px;">+ ${r.set_num}${r.name ? ' — ' + r.name : ''}</div>`)
    ];

    preview.innerHTML = `
        <div style="border:1px solid #333;padding:12px;margin-top:10px;text-align:left;font-size:0.8em;max-height:200px;overflow-y:auto;">
            <div style="color:#888;margin-bottom:8px;">
                ${toUpdate.length ? `<span style="color:#00e5ff;">⟳ ${toUpdate.length} to update</span>&nbsp;&nbsp;` : ''}
                ${toInsert.length ? `<span style="color:#00ff00;">＋ ${toInsert.length} to add</span>&nbsp;&nbsp;` : ''}
                ${skipped ? `<span style="color:#ffaa00;">${skipped} duplicate${skipped !== 1 ? 's' : ''} skipped</span>` : ''}
            </div>
            ${previewLines.join('')}
        </div>
        <button id="confirm-import-btn" onclick="confirmImport()" style="width:100%;margin-top:10px;background:#00ff00;color:#000;padding:10px;font-family:'Courier New',monospace;font-weight:bold;border:none;cursor:pointer;">
            ↑ ${importMode === 'sync' ? 'SYNC' : 'IMPORT'} ${totalOps} SET${totalOps !== 1 ? 'S' : ''}
        </button>
    `;

    document.getElementById('confirm-import-btn').dataset.pending = JSON.stringify({ toInsert, toUpdate, mode: importMode });
}

async function confirmImport() {
    const btn = document.getElementById('confirm-import-btn');
    const { toInsert = [], toUpdate = [], mode } = JSON.parse(btn.dataset.pending || '{}');
    const allOps = [...toUpdate, ...toInsert];
    if (!allOps.length) return;

    const preview = document.getElementById('import-preview');
    btn.disabled = true;

    // Lock the modal so it can't be closed mid-import
    const modal = document.getElementById('import-modal');
    const closeBtn = modal ? modal.querySelector('.modal-close') : null;
    if (modal) modal.dataset.importing = 'true';
    if (closeBtn) closeBtn.disabled = true;

    let updated = 0;
    let inserted = 0;
    let failed = 0;
    const failedSets = [];

    const updateProgress = (currentSet = '') => {
        const done = updated + inserted + failed;
        preview.innerHTML = `
            <div style="border:1px solid #333;padding:15px;margin-top:10px;text-align:left;font-size:0.85em;">
                <div style="color:#888;margin-bottom:10px;">${mode === 'sync' ? 'SYNCING' : 'IMPORTING'}...</div>
                <div style="background:#111;border:1px solid #333;height:12px;margin-bottom:10px;box-sizing:border-box;">
                    <div style="background:#00ff00;height:100%;width:${Math.round((done / allOps.length) * 100)}%;transition:width 0.2s;"></div>
                </div>
                <div style="color:#00ffff;margin-bottom:4px;">${done} / ${allOps.length} processed</div>
                ${updated  ? `<div style="color:#00e5ff;">⟳ ${updated} updated</div>`  : ''}
                ${inserted ? `<div style="color:#00ff00;">✓ ${inserted} added</div>`   : ''}
                ${failed   ? `<div style="color:#ff6666;">✗ ${failed} failed</div>`    : ''}
                ${currentSet ? `<div style="color:#555;margin-top:8px;font-size:0.8em;">⟳ ${currentSet}</div>` : ''}
            </div>
        `;
    };

    updateProgress();

    const validConditions = CONDITIONS.map(c => c.value);

    // Helper: enrich a row with Rebrickable data if fields are missing
    async function enrichRow(row) {
        let { set_num, name, theme, year, condition, price_paid, img_url } = row;
        img_url = img_url || null;
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
        if (!img_url) img_url = `https://cdn.rebrickable.com/media/sets/${set_num}.jpg`;

        const cleanCondition = validConditions.includes(condition) ? condition : null;
        const cleanPrice = (price_paid !== '' && price_paid != null && !isNaN(parseFloat(price_paid)))
            ? parseFloat(price_paid) : null;

        return { set_num, name, img_url, year: parseInt(year) || null, theme, condition: cleanCondition, price_paid: cleanPrice };
    }

    // Process updates first
    for (const row of toUpdate) {
        try {
            updateProgress(row.set_num);
            const payload = await enrichRow(row);
            const { error } = await db.from('lego_collection')
                .update({ name: payload.name, theme: payload.theme, year: payload.year,
                          condition: payload.condition, price_paid: payload.price_paid, img_url: payload.img_url })
                .eq('set_num', payload.set_num);
            if (error) throw new Error(error.message);
            updated++;
            updateProgress();
        } catch (err) {
            failed++;
            failedSets.push(`${row.set_num} (${err.message})`);
            updateProgress();
        }
    }

    // Process inserts
    for (const row of toInsert) {
        try {
            updateProgress(row.set_num);
            const payload = await enrichRow(row);
            const { error } = await db.from('lego_collection').insert([payload]);
            if (error) throw new Error(error.message);
            inserted++;
            updateProgress();
        } catch (err) {
            failed++;
            failedSets.push(`${row.set_num} (${err.message})`);
            updateProgress();
        }
    }

    // Final state
    preview.innerHTML = `
        <div style="border:1px solid #333;padding:15px;margin-top:10px;text-align:left;font-size:0.85em;">
            <div style="color:#00ff00;margin-bottom:8px;">✓ ${mode === 'sync' ? 'SYNC' : 'IMPORT'} COMPLETE</div>
            <div style="background:#111;border:1px solid #333;height:12px;margin-bottom:10px;">
                <div style="background:#00ff00;height:100%;width:100%;"></div>
            </div>
            ${updated  ? `<div style="color:#00e5ff;">⟳ ${updated} set${updated !== 1 ? 's' : ''} updated</div>`  : ''}
            ${inserted ? `<div style="color:#00ffff;">✓ ${inserted} set${inserted !== 1 ? 's' : ''} added</div>`  : ''}
            ${failed   ? `<div style="color:#ff6666;margin-top:6px;">✗ ${failed} failed:<br>${failedSets.map(s => `<span style="color:#884444;">${s}</span>`).join('<br>')}</div>` : ''}
        </div>
    `;

    await loadCollection();
    document.getElementById('csv-file-input').value = '';

    if (modal) delete modal.dataset.importing;
    if (closeBtn) closeBtn.disabled = false;
}


async function exportCollection() {
    if (!collectionCache.length) return showToast("No data to export.", 'warning');
    showToast("Fetching retail prices… this may take a moment.", 'info');
    await prefetchRetailPrices(collectionCache.map(i => i.set_num));
    const sorted = [...collectionCache].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const headers = ['set_num', 'name', 'theme', 'year', 'condition', 'price_paid', 'market_value', 'retail_price', 'img_url'];
    const rows = sorted.map(item => {
        const retail = retailPriceCache[item.set_num] ?? '';
        return [
            ...['set_num', 'name', 'theme', 'year', 'condition', 'price_paid', 'market_value'].map(h => `"${(item[h] != null ? item[h] : '').toString().replace(/"/g, '""')}"`),
            `"${retail}"`,
            `"${(item.img_url || '').replace(/"/g, '""')}"`
        ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lego_collection.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export complete!", 'success');
}
