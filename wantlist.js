// ============================================================
// wantlist.js — wantlist.html only
// Wish list load/filter/render, drag-to-reorder, move-to-collection,
// and wish list CSV export.
// Depends on core.js (must be loaded first).
// ============================================================
let dragSrcId = null; // ID of item being dragged

// --- Collection/Wantlist presence cache (for search page indicators) ---
// Loaded once on index.html to show "already in collection" badges on search results
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
        document.getElementById('collection-list').innerHTML = '<li>Error loading wish list.</li>';
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
            countEl.innerHTML = `> <span>${total}</span>&nbsp;set${total !== 1 ? 's' : ''} on wish list`;
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
        img.loading = 'lazy';
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
        showToast(`"${item.name}" is already in your collection — removing from wish list.`, 'warning');
    } else {
        const { error } = await db.from('lego_collection').insert([{
            set_num: item.set_num, name: item.name, img_url: item.img_url, year: item.year, theme: item.theme,
            condition: cleanCondition
        }]);
        if (error) { showToast("Error saving to collection: " + error.message, 'error'); return; }
    }

    const { error: deleteError } = await db.from('lego_wantlist').delete().eq('id', wantlistId);
    if (deleteError) {
        showToast("Moved to collection, but failed to remove from wish list: " + deleteError.message, 'warning');
    } else {
        showToast(`"${item.name}" moved to collection!`, 'success');
    }
    wantlistCache = wantlistCache.filter(i => i.id !== wantlistId);
    populateFilterDropdowns(wantlistCache);
    applyWantlistControls();
}

async function deleteFromWantlist(id) {
    if (!confirm("Remove this set from your wish list?")) return;
    const { error } = await db.from('lego_wantlist').delete().eq('id', id);
    if (error) {
        showToast("Error removing set: " + error.message, 'error');
    } else {
        showToast("Set removed from wish list.", 'info');
        // Update cache in-place — no need to re-fetch all data from Supabase
        wantlistCache = wantlistCache.filter(i => i.id !== id);
        populateFilterDropdowns(wantlistCache);
        applyWantlistControls();
    }
}

// --- CSV IMPORT ---

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
