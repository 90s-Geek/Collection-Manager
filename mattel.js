// ============================================================
// mattel.js — Mattel Brick Shop partition
// Shared by mattel.html (home + add form), mattel-collection.html
// and mattel-wantlist.html. Loaded after core.js, which supplies
// db, authReady, showToast, escapeHTML, CONDITIONS, conditionBadge,
// toggleControls / restoreControlsState and the nav (SWITCH, LOG OUT).
//
// There's no public catalog API for Mattel Brick Shop (Rebrickable and
// Brickset are LEGO-only), so every set is entered by hand.
// ============================================================

const MS_TABLES = { collection: 'mattel_collection', wantlist: 'mattel_wantlist' };

// Suggestions for the "Line" field — anything typed is also allowed,
// and lines already used in your data are added to the list.
const MS_LINE_SUGGESTIONS = [
    'Hot Wheels Speed',
    'Hot Wheels Elite',
    'Hot Wheels Premium',
    'Masters of the Universe',
];

const MS_PAGE = document.body.dataset.page; // mattel-home | mattel-collection | mattel-wantlist
const MS_LIST = MS_PAGE === 'mattel-collection' ? 'collection'
              : MS_PAGE === 'mattel-wantlist'   ? 'wantlist'
              : null;

let msItems = [];          // rows for the list page
let msView  = 'list';      // list | grid

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
function msMoney(n) {
    const v = Number(n);
    if (n == null || n === '' || !isFinite(v)) return '';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// '' → null, otherwise a finite number (or null if junk)
function msNum(v, { int = false } = {}) {
    if (v == null) return null;
    const s = String(v).trim().replace(/[$,]/g, '');
    if (!s) return null;
    const n = int ? parseInt(s, 10) : Number(s);
    return isFinite(n) ? n : null;
}

function msText(v) {
    const s = String(v ?? '').trim();
    return s || null;
}

// Only http(s) image links are rendered
function msSafeUrl(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
}

function msThumb(item, cls = 'ms-item-thumb') {
    const src = msSafeUrl(item.img_url);
    if (!src) return `<div class="${cls} ms-item-thumb--none">NO IMG</div>`;
    return `<img class="${cls}" src="${escapeHTML(src)}" alt="" loading="lazy">`;
}

function msMetaLine(item) {
    const bits = [];
    if (item.line)      bits.push(`<span class="ms-line">${escapeHTML(item.line)}</span>`);
    if (item.year)      bits.push(escapeHTML(item.year));
    if (item.set_num)   bits.push('#' + escapeHTML(item.set_num));
    if (item.num_parts) bits.push(`${Number(item.num_parts).toLocaleString()} pcs`);
    return bits.join(' · ');
}

function msGetParam(name) {
    try { return new URLSearchParams(location.search).get(name); } catch { return null; }
}

function msAttachThumbFallbacks(root) {
    root.querySelectorAll('img.ms-item-thumb, .recently-added-item img').forEach(img => {
        img.addEventListener('error', () => {
            const ph = document.createElement('div');
            ph.className = img.className + ' ms-item-thumb--none';
            ph.textContent = 'NO IMG';
            img.replaceWith(ph);
        }, { once: true });
    });
}

// Distinct lines across both tables (for the datalist + filter)
async function msLoadLines() {
    const lines = new Set(MS_LINE_SUGGESTIONS);
    for (const t of Object.values(MS_TABLES)) {
        const { data } = await db.from(t).select('line');
        (data || []).forEach(r => r.line && lines.add(r.line));
    }
    return [...lines].sort((a, b) => a.localeCompare(b));
}

function msFillLineDatalist(lines) {
    const dl = document.getElementById('ms-lines');
    if (!dl) return;
    dl.innerHTML = lines.map(l => `<option value="${escapeHTML(l)}"></option>`).join('');
}

// ------------------------------------------------------------
// Confirm dialog (uses the site's modal styles)
// ------------------------------------------------------------
function msConfirm(title, html, okLabel = 'CONFIRM') {
    return new Promise(resolve => {
        let overlay = document.getElementById('ms-confirm');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ms-confirm';
            overlay.className = 'modal-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `
            <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="ms-confirm-title">
                <h2 id="ms-confirm-title">${escapeHTML(title)}</h2>
                <div class="move-modal-info">${html}</div>
                <div class="modal-action-row">
                    <button type="button" class="btn-cancel" data-act="cancel">CANCEL</button>
                    <button type="button" class="btn-confirm" data-act="ok">${escapeHTML(okLabel)}</button>
                </div>
            </div>`;
        const done = ok => {
            overlay.classList.remove('active');
            observer.disconnect();
            resolve(ok);
        };
        // Escape (handled in core.js) removes .active → treat as cancel
        const observer = new MutationObserver(() => {
            if (!overlay.classList.contains('active')) { observer.disconnect(); resolve(false); }
        });
        overlay.onclick = e => {
            if (e.target === overlay) return done(false);
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'ok') done(true);
            else if (act === 'cancel') done(false);
        };
        overlay.classList.add('active');
        observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
        overlay.querySelector('[data-act="ok"]').focus();
    });
}

// ------------------------------------------------------------
// Shared form fields (add form on home + edit modal)
// ------------------------------------------------------------
function msFieldsHTML(item = {}, dest = 'collection', prefix = 'f') {
    const v = k => escapeHTML(item[k] ?? '');
    const condOpts = CONDITIONS.map(c =>
        `<option value="${c.value}"${item.condition === c.value ? ' selected' : ''}>${c.label}</option>`).join('');
    const img = msSafeUrl(item.img_url);
    return `
        <div class="ms-field ms-field--full">
            <label for="${prefix}-name">Set name <span class="req">*</span></label>
            <input id="${prefix}-name" name="name" type="text" required maxlength="200" value="${v('name')}" placeholder="e.g. Lamborghini Miura P400 SV" autocomplete="off">
        </div>
        <div class="ms-field">
            <label for="${prefix}-line">Line</label>
            <input id="${prefix}-line" name="line" type="text" list="ms-lines" maxlength="80" value="${v('line')}" placeholder="e.g. Hot Wheels Elite" autocomplete="off">
        </div>
        <div class="ms-field">
            <label for="${prefix}-set_num">Set / item #</label>
            <input id="${prefix}-set_num" name="set_num" type="text" maxlength="40" value="${v('set_num')}" placeholder="optional" autocomplete="off">
        </div>
        <div class="ms-field">
            <label for="${prefix}-year">Year</label>
            <input id="${prefix}-year" name="year" type="number" min="1945" max="2100" step="1" inputmode="numeric" value="${v('year')}" placeholder="${new Date().getFullYear()}">
        </div>
        <div class="ms-field">
            <label for="${prefix}-num_parts">Pieces</label>
            <input id="${prefix}-num_parts" name="num_parts" type="number" min="0" step="1" inputmode="numeric" value="${v('num_parts')}" placeholder="optional">
        </div>
        <div class="ms-field ms-field--full">
            <label for="${prefix}-img_url">Image URL</label>
            <div class="ms-img-row">
                <input id="${prefix}-img_url" name="img_url" type="url" maxlength="1000" value="${escapeHTML(img)}" placeholder="https://… (right-click an image → Copy image address)" autocomplete="off">
                <div class="ms-img-preview" data-preview-for="${prefix}-img_url">${img ? `<img src="${escapeHTML(img)}" alt="">` : 'NONE'}</div>
            </div>
        </div>
        <div class="ms-only-collection">
            <div class="ms-field">
                <label for="${prefix}-condition">Condition</label>
                <select id="${prefix}-condition" name="condition">
                    <option value="">— none —</option>
                    ${condOpts}
                </select>
            </div>
            <div class="ms-field">
                <label for="${prefix}-price_paid">Price paid</label>
                <div class="ms-money"><span>$</span><input id="${prefix}-price_paid" name="price_paid" type="number" min="0" step="0.01" inputmode="decimal" value="${v('price_paid')}" placeholder="0.00"></div>
            </div>
            <div class="ms-field">
                <label for="${prefix}-market_value">Market value</label>
                <div class="ms-money"><span>$</span><input id="${prefix}-market_value" name="market_value" type="number" min="0" step="0.01" inputmode="decimal" value="${v('market_value')}" placeholder="0.00"></div>
                ${dest === 'collection' ? msGainHTML(item) : ''}
            </div>
        </div>
        <div class="ms-only-wantlist">
            <div class="ms-field">
                <label for="${prefix}-retail_price">Retail / target price</label>
                <div class="ms-money"><span>$</span><input id="${prefix}-retail_price" name="retail_price" type="number" min="0" step="0.01" inputmode="decimal" value="${v('retail_price')}" placeholder="0.00"></div>
            </div>
        </div>
        <div class="ms-field ms-field--full">
            <label for="${prefix}-notes">Notes</label>
            <textarea id="${prefix}-notes" name="notes" maxlength="2000" placeholder="Where you bought it, missing pieces, etc.">${v('notes')}</textarea>
        </div>`;
}

function msGainHTML(item) {
    if (item.market_value == null || item.price_paid == null || Number(item.price_paid) <= 0) return '';
    const diff = Number(item.market_value) - Number(item.price_paid);
    const pct  = (diff / Number(item.price_paid)) * 100;
    const sign = diff >= 0 ? '+' : '−';
    return `<div class="ms-gain ms-gain--${diff >= 0 ? 'up' : 'down'}">${sign}${msMoney(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(1)}%)</div>`;
}

// Live image preview for any URL field inside root
function msWireImagePreview(root) {
    root.querySelectorAll('input[name="img_url"]').forEach(input => {
        const box = root.querySelector(`[data-preview-for="${input.id}"]`);
        if (!box) return;
        let t;
        input.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                const src = msSafeUrl(input.value);
                if (!src) { box.textContent = input.value.trim() ? 'BAD URL' : 'NONE'; return; }
                const img = new Image();
                img.alt = '';
                img.onload  = () => { box.innerHTML = ''; box.appendChild(img); };
                img.onerror = () => { box.textContent = 'NO LOAD'; };
                img.src = src;
            }, 300);
        });
    });
}

// Reads a form into a row for the given table
function msReadForm(form, dest) {
    const f = name => form.elements[name]?.value;
    const row = {
        name:      msText(f('name')),
        line:      msText(f('line')),
        set_num:   msText(f('set_num')),
        year:      msNum(f('year'), { int: true }),
        num_parts: msNum(f('num_parts'), { int: true }),
        img_url:   msSafeUrl(f('img_url')) || null,
        notes:     msText(f('notes')),
    };
    if (dest === 'collection') {
        row.condition    = msText(f('condition'));
        row.price_paid   = msNum(f('price_paid'));
        row.market_value = msNum(f('market_value'));
    } else {
        row.retail_price = msNum(f('retail_price'));
    }
    return row;
}

function msValidate(row, form) {
    if (!row.name) return ['name', 'Enter a set name'];
    if (row.year != null && (row.year < 1945 || row.year > 2100)) return ['year', 'Year looks off'];
    for (const k of ['num_parts', 'price_paid', 'market_value', 'retail_price']) {
        if (row[k] != null && row[k] < 0) return [k, 'Numbers can’t be negative'];
    }
    const imgField = form.elements.img_url;
    if (imgField && imgField.value.trim() && !row.img_url) return ['img_url', 'Image URL must start with http:// or https://'];
    return null;
}

// ------------------------------------------------------------
// HOME (mattel.html) — add form, stats strip, recently added
// ------------------------------------------------------------
async function msInitHome() {
    const form = document.getElementById('ms-add-form');
    let dest = msGetParam('dest') === 'wantlist' ? 'wantlist' : 'collection';

    function renderForm(keep = {}) {
        form.dataset.dest = dest;
        form.innerHTML = `
            <div class="ms-dest" role="group" aria-label="Add to">
                <button type="button" data-dest="collection" class="${dest === 'collection' ? 'active' : ''}" aria-pressed="${dest === 'collection'}">＋ COLLECTION</button>
                <button type="button" data-dest="wantlist"   class="${dest === 'wantlist' ? 'active' : ''}"   aria-pressed="${dest === 'wantlist'}">♡ WISH LIST</button>
            </div>
            ${msFieldsHTML(keep, dest, 'add')}
            <div class="ms-actions">
                <button type="button" class="ms-btn ms-btn--ghost" id="ms-add-clear">CLEAR</button>
                <button type="submit" class="ms-btn" id="ms-add-submit">${dest === 'collection' ? 'ADD TO COLLECTION' : 'ADD TO WISH LIST'}</button>
            </div>`;
        msWireImagePreview(form);
    }

    // Switching destination keeps whatever's already typed
    form.addEventListener('click', e => {
        const btn = e.target.closest('.ms-dest button');
        if (btn && btn.dataset.dest !== dest) {
            const typed = msReadForm(form, dest);
            const raw = { ...typed, img_url: form.elements.img_url?.value || '' };
            dest = btn.dataset.dest;
            renderForm(raw);
            form.elements.name.focus();
        }
        if (e.target.id === 'ms-add-clear') {
            renderForm();
            form.elements.name.focus();
        }
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const row = msReadForm(form, dest);
        const bad = msValidate(row, form);
        if (bad) {
            showToast('⚠ ' + bad[1], 'warning');
            form.elements[bad[0]]?.focus();
            return;
        }

        const table = MS_TABLES[dest];
        // Duplicate check: same set # (or same name if no set #) already on that list
        const dupe = row.set_num
            ? await db.from(table).select('id').eq('set_num', row.set_num).limit(1)
            : await db.from(table).select('id').ilike('name', row.name.replace(/[%_\\]/g, '\\$&')).limit(1);
        if (dupe.data?.length) {
            const ok = await msConfirm('Already listed',
                `<strong>${escapeHTML(row.name)}</strong> is already on your ${dest === 'collection' ? 'collection' : 'wish list'}. Add another copy?`,
                'ADD ANYWAY');
            if (!ok) return;
        }

        const btn = document.getElementById('ms-add-submit');
        btn.disabled = true;
        btn.textContent = 'SAVING…';
        const { error } = await db.from(table).insert(row);
        btn.disabled = false;
        btn.textContent = dest === 'collection' ? 'ADD TO COLLECTION' : 'ADD TO WISH LIST';

        if (error) {
            console.error(error);
            showToast('Save failed — ' + error.message, 'error');
            return;
        }
        showToast(`Added “${row.name}” to your ${dest === 'collection' ? 'collection' : 'wish list'}`, 'success');
        // Keep the line + year for quick entry of a series
        renderForm({ line: row.line, year: row.year });
        form.elements.name.focus();
        msLoadHomeData();
    });

    renderForm();
    msLoadHomeData();
}

async function msLoadHomeData() {
    const [colRes, wantRes, lines] = await Promise.all([
        db.from(MS_TABLES.collection).select('id,name,line,year,img_url,price_paid,market_value,created_at').order('created_at', { ascending: false }),
        db.from(MS_TABLES.wantlist).select('id', { count: 'exact', head: true }),
        msLoadLines(),
    ]);
    msFillLineDatalist(lines);

    // Stats strip
    const strip = document.getElementById('ms-stats');
    if (strip) {
        if (colRes.error) {
            strip.innerHTML = `<div class="ms-empty" style="grid-column:1/-1;">Couldn’t load your Brick Shop data — ${escapeHTML(colRes.error.message)}</div>`;
        } else {
            const rows = colRes.data || [];
            const lineNames = [...new Set(rows.map(r => r.line).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const lineCount = lineNames.length;
            const value = rows.reduce((s, r) => s + Number(r.market_value ?? r.price_paid ?? 0), 0);
            const valued = rows.filter(r => r.market_value != null).length;
            strip.innerHTML = `
                <a class="stats-tile stats-tile--ms-sets" href="mattel-collection.html">
                    <span class="stats-tile-val">${rows.length}</span>
                    <span class="stats-tile-label">Sets owned</span>
                    <span class="stats-tile-sub">in your collection</span>
                </a>
                <a class="stats-tile stats-tile--ms-lines" href="mattel-collection.html">
                    <span class="stats-tile-val">${lineCount}</span>
                    <span class="stats-tile-label">Lines</span>
                    <span class="stats-tile-sub" title="${escapeHTML(lineNames.join(', '))}">${escapeHTML(lineNames.join(', ') || 'none yet')}</span>
                </a>
                <a class="stats-tile stats-tile--ms-value" href="mattel-collection.html">
                    <span class="stats-tile-val">${msMoney(value) || '$0.00'}</span>
                    <span class="stats-tile-label">Value</span>
                    <span class="stats-tile-sub">${valued}/${rows.length} with market value</span>
                </a>
                <a class="stats-tile stats-tile--ms-wish" href="mattel-wantlist.html">
                    <span class="stats-tile-val">${wantRes.count ?? 0}</span>
                    <span class="stats-tile-label">Wish list</span>
                    <span class="stats-tile-sub">sets wanted</span>
                </a>`;
        }
    }

    // Recently added (right column)
    const box = document.getElementById('last-added-container');
    if (box) {
        const recent = (colRes.data || []).slice(0, 5);
        box.innerHTML = recent.length
            ? recent.map(r => `
                <a class="recently-added-item" href="mattel-collection.html?edit=${encodeURIComponent(r.id)}" style="text-decoration:none;" title="${escapeHTML(r.name)}">
                    ${msSafeUrl(r.img_url) ? `<img src="${escapeHTML(msSafeUrl(r.img_url))}" alt="" loading="lazy">` : '<div class="ms-item-thumb--none" style="height:100px;">NO IMG</div>'}
                    <div class="recently-added-item-text">
                        <div class="recently-added-item-name">${escapeHTML(r.name)}</div>
                        <div class="recently-added-item-meta">${escapeHTML([r.line, r.year].filter(Boolean).join(' · ') || '—')}</div>
                    </div>
                </a>`).join('')
            : '<div class="recently-added-empty">Nothing yet — add your first set.</div>';
        msAttachThumbFallbacks(box);
    }
}

// ------------------------------------------------------------
// LIST PAGES (collection + wish list)
// ------------------------------------------------------------
function msFilterKey() { return `ms_filters_${MS_PAGE}`; }
function msViewKey()   { return `ms_view_${MS_PAGE}`; }

function msSaveFilters() {
    const state = {};
    ['ms-sort', 'ms-filter-line', 'ms-filter-year', 'ms-filter-condition', 'ms-filter-name'].forEach(id => {
        const el = document.getElementById(id);
        if (el) state[id] = el.value;
    });
    try { localStorage.setItem(msFilterKey(), JSON.stringify(state)); } catch {}
}

function msRestoreFilters() {
    try {
        const state = JSON.parse(localStorage.getItem(msFilterKey()) || '{}');
        Object.entries(state).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el && val != null) el.value = val;
        });
    } catch {}
}

function msPopulateFilters() {
    const fill = (id, values, allLabel) => {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = el.value;
        el.innerHTML = `<option value="">${allLabel}</option>` +
            values.map(v => `<option value="${escapeHTML(v.value)}">${escapeHTML(v.label)}</option>`).join('');
        if ([...el.options].some(o => o.value === cur)) el.value = cur;
    };
    const lines = [...new Set(msItems.map(i => i.line).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const years = [...new Set(msItems.map(i => i.year).filter(Boolean))].sort((a, b) => b - a);
    fill('ms-filter-line', lines.map(l => ({ value: l, label: l })), 'All Lines');
    fill('ms-filter-year', years.map(y => ({ value: String(y), label: String(y) })), 'All Years');
    fill('ms-filter-condition', CONDITIONS.map(c => ({ value: c.value, label: c.label })), 'All Conditions');
}

async function msInitList() {
    try { msView = localStorage.getItem(msViewKey()) || 'list'; } catch {}
    msSetViewButtons();

    const controls = document.getElementById('controls-body');
    controls?.addEventListener('change', () => msApply());
    let t;
    document.getElementById('ms-filter-name')?.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(msApply, 200);
    });
    document.getElementById('ms-clear-filters')?.addEventListener('click', () => {
        ['ms-filter-line', 'ms-filter-year', 'ms-filter-condition', 'ms-filter-name'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        msApply();
    });
    document.getElementById('btn-list')?.addEventListener('click', () => msSetView('list'));
    document.getElementById('btn-grid')?.addEventListener('click', () => msSetView('grid'));
    document.getElementById('ms-export')?.addEventListener('click', msExportCSV);
    document.getElementById('controls-toggle')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleControls(); }
    });

    // Row clicks (event delegation — no data embedded in onclick strings)
    document.getElementById('collection-list').addEventListener('click', e => {
        const li = e.target.closest('[data-id]');
        if (!li) return;
        const item = msItems.find(i => String(i.id) === li.dataset.id);
        if (!item) return;
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'remove') msRemove(item);
        else if (act === 'move') msMoveToCollection(item);
        else if (e.target.closest('.collection-item-info')) msOpenEdit(item);
    });

    await msLoadList();

    // Deep link from home / Recently Added: ?edit=<id>
    const editId = msGetParam('edit');
    if (editId) {
        const item = msItems.find(i => String(i.id) === editId);
        if (item) msOpenEdit(item);
        try { history.replaceState(null, '', location.pathname); } catch {}
    }
}

async function msLoadList() {
    const list = document.getElementById('collection-list');
    const { data, error } = await db.from(MS_TABLES[MS_LIST]).select('*').order('created_at', { ascending: false });
    if (error) {
        console.error(error);
        list.innerHTML = `<li class="ms-empty">Couldn’t load — ${escapeHTML(error.message)}</li>`;
        document.getElementById('collection-count').textContent = '';
        return;
    }
    msItems = data || [];
    msPopulateFilters();
    msRestoreFilters();
    msApply();
    msFillLineDatalist(await msLoadLines());
}

function msApply() {
    const val = id => document.getElementById(id)?.value || '';
    const line = val('ms-filter-line');
    const year = val('ms-filter-year');
    const cond = val('ms-filter-condition');
    const q    = val('ms-filter-name').trim().toLowerCase();
    const [key, dir] = (val('ms-sort') || 'created_at|desc').split('|');

    let rows = msItems.filter(i =>
        (!line || i.line === line) &&
        (!year || String(i.year) === year) &&
        (!cond || i.condition === cond) &&
        (!q || [i.name, i.line, i.set_num, i.notes].some(s => String(s || '').toLowerCase().includes(q)))
    );

    const mult = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
        const av = a[key], bv = b[key];
        // Blanks always sink to the bottom
        if (av == null || av === '') return (bv == null || bv === '') ? 0 : 1;
        if (bv == null || bv === '') return -1;
        if (typeof av === 'number' || ['year', 'num_parts', 'price_paid', 'market_value', 'retail_price'].includes(key)) {
            return (Number(av) - Number(bv)) * mult;
        }
        return String(av).localeCompare(String(bv)) * mult;
    });

    msSaveFilters();
    msRender(rows);
}

function msRender(rows) {
    const list = document.getElementById('collection-list');
    list.classList.toggle('grid-view', msView === 'grid');

    const countEl = document.getElementById('collection-count');
    const total = msItems.length;
    const noun = n => `${n} set${n === 1 ? '' : 's'}`;
    let extra = '';
    if (MS_LIST === 'collection') {
        const value = rows.reduce((s, r) => s + Number(r.market_value ?? r.price_paid ?? 0), 0);
        if (value) extra = ` · <span>${msMoney(value)}</span> value`;
    } else {
        const cost = rows.reduce((s, r) => s + Number(r.retail_price ?? 0), 0);
        if (cost) extra = ` · <span class="wl-total">${msMoney(cost)}</span> to complete`;
    }
    // One wrapper so the flex container doesn't swallow the spaces between parts
    countEl.innerHTML = '<div>' + (rows.length === total
        ? `<span>${noun(total)}</span>`
        : `<span>${rows.length}</span> of ${noun(total)} shown`) + extra + '</div>';

    if (!total) {
        const where = MS_LIST === 'collection' ? '' : '?dest=wantlist';
        list.innerHTML = `<li class="ms-empty">Nothing here yet. <a href="mattel.html${where}">Add a set →</a></li>`;
        return;
    }
    if (!rows.length) {
        list.innerHTML = '<li class="ms-empty">No sets match these filters.</li>';
        return;
    }

    list.innerHTML = rows.map(item => {
        const badges = MS_LIST === 'collection'
            ? `${item.condition ? conditionBadge(item.condition) : ''}${item.market_value != null ? `<span class="ms-value-badge" title="Market value">${msMoney(item.market_value)}</span>` : ''}`
            : `${item.retail_price != null ? `<span class="ms-price-badge" title="Retail / target price">${msMoney(item.retail_price)}</span>` : ''}`;
        const btns = MS_LIST === 'wantlist'
            ? `<button type="button" class="add-from-want-btn" data-act="move" title="Bought it — move to collection">✓ GOT IT</button>
               <button type="button" class="remove-btn" data-act="remove">REMOVE</button>`
            : `<button type="button" class="remove-btn" data-act="remove">REMOVE</button>`;
        return `
            <li class="collection-item collection-item-fadein" data-id="${escapeHTML(item.id)}">
                <div class="collection-item-info" role="button" tabindex="0" title="Edit details">
                    ${msThumb(item)}
                    <div>
                        <div class="ms-item-name">${escapeHTML(item.name)}${badges}</div>
                        <div class="ms-item-meta">${msMetaLine(item) || '&nbsp;'}</div>
                    </div>
                </div>
                <div class="ms-row-btns">${btns}</div>
            </li>`;
    }).join('');
    msAttachThumbFallbacks(list);

    list.querySelectorAll('.collection-item-info').forEach(el => {
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
        });
    });
}

function msSetViewButtons() {
    document.getElementById('btn-list')?.classList.toggle('active', msView === 'list');
    document.getElementById('btn-grid')?.classList.toggle('active', msView === 'grid');
}

function msSetView(mode) {
    msView = mode;
    try { localStorage.setItem(msViewKey(), mode); } catch {}
    msSetViewButtons();
    msApply();
}

// --- Edit modal ---
function msOpenEdit(item) {
    const overlay = document.getElementById('ms-modal');
    const box = overlay.querySelector('.modal-box');
    const img = msSafeUrl(item.img_url);
    box.innerHTML = `
        <button type="button" class="modal-close" data-act="close" aria-label="Close">✕</button>
        <h2>${escapeHTML(item.name)}</h2>
        ${img ? `<div class="ms-modal-img"><img src="${escapeHTML(img)}" alt=""></div>` : ''}
        <form class="ms-form" id="ms-edit-form" data-dest="${MS_LIST}" novalidate>
            ${msFieldsHTML(item, MS_LIST, 'edit')}
            <div class="ms-actions">
                <button type="button" class="ms-btn ms-btn--danger" data-act="delete">DELETE</button>
                ${MS_LIST === 'wantlist' ? '<button type="button" class="ms-btn ms-btn--move" data-act="move">✓ GOT IT</button>' : ''}
                <button type="submit" class="ms-btn">SAVE</button>
            </div>
        </form>`;
    msWireImagePreview(box);
    const modalImg = box.querySelector('.ms-modal-img img');
    modalImg?.addEventListener('error', () => modalImg.parentElement.remove(), { once: true });

    const form = box.querySelector('#ms-edit-form');
    form.addEventListener('submit', async e => {
        e.preventDefault();
        const row = msReadForm(form, MS_LIST);
        const bad = msValidate(row, form);
        if (bad) {
            showToast('⚠ ' + bad[1], 'warning');
            form.elements[bad[0]]?.focus();
            return;
        }
        const saveBtn = form.querySelector('button[type="submit"]');
        saveBtn.disabled = true;
        const { error } = await db.from(MS_TABLES[MS_LIST]).update(row).eq('id', item.id);
        saveBtn.disabled = false;
        if (error) { showToast('Save failed — ' + error.message, 'error'); return; }
        Object.assign(item, row);
        overlay.classList.remove('active');
        showToast('Saved', 'success');
        msPopulateFilters();
        msApply();
    });

    box.onclick = e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') overlay.classList.remove('active');
        else if (act === 'delete') msRemove(item);
        else if (act === 'move') msMoveToCollection(item);
    };
    overlay.onclick = e => { if (e.target === overlay) overlay.classList.remove('active'); };
    overlay.classList.add('active');
    box.scrollTop = 0;
}

async function msRemove(item) {
    const where = MS_LIST === 'collection' ? 'your collection' : 'your wish list';
    const ok = await msConfirm('Remove set', `Remove <strong>${escapeHTML(item.name)}</strong> from ${where}? This can’t be undone.`, 'REMOVE');
    if (!ok) return;
    const { error } = await db.from(MS_TABLES[MS_LIST]).delete().eq('id', item.id);
    if (error) { showToast('Remove failed — ' + error.message, 'error'); return; }
    document.getElementById('ms-modal')?.classList.remove('active');
    msItems = msItems.filter(i => i.id !== item.id);
    showToast(`Removed “${item.name}”`, 'info');
    msPopulateFilters();
    msApply();
}

// Wish list → collection: asks for condition + price paid, inserts, then removes the wish
async function msMoveToCollection(item) {
    const condOpts = CONDITIONS.map(c => `<option value="${c.value}"${c.value === 'Sealed' ? ' selected' : ''}>${c.label}</option>`).join('');
    const ok = await msConfirm('Got it!', `
        Move <strong>${escapeHTML(item.name)}</strong> to your collection.
        <div class="ms-form" style="margin-top:12px;">
            <div class="ms-field">
                <label for="ms-move-cond">Condition</label>
                <select id="ms-move-cond"><option value="">— none —</option>${condOpts}</select>
            </div>
            <div class="ms-field">
                <label for="ms-move-paid">Price paid</label>
                <div class="ms-money"><span>$</span><input id="ms-move-paid" type="number" min="0" step="0.01" inputmode="decimal" value="${item.retail_price ?? ''}" placeholder="0.00"></div>
            </div>
        </div>`, 'MOVE TO COLLECTION');
    if (!ok) return;

    const paid = msNum(document.getElementById('ms-move-paid')?.value);
    const row = {
        name: item.name, line: item.line, set_num: item.set_num, year: item.year,
        num_parts: item.num_parts, img_url: item.img_url, notes: item.notes,
        condition: msText(document.getElementById('ms-move-cond')?.value),
        price_paid: paid != null && paid >= 0 ? paid : null,
    };
    const ins = await db.from(MS_TABLES.collection).insert(row);
    if (ins.error) { showToast('Move failed — ' + ins.error.message, 'error'); return; }
    const del = await db.from(MS_TABLES.wantlist).delete().eq('id', item.id);
    if (del.error) {
        showToast('Added to collection, but couldn’t remove from wish list — ' + del.error.message, 'warning');
        return;
    }
    document.getElementById('ms-modal')?.classList.remove('active');
    msItems = msItems.filter(i => i.id !== item.id);
    showToast(`“${item.name}” moved to your collection`, 'success');
    msPopulateFilters();
    msApply();
}

// --- CSV export ---
function msExportCSV() {
    if (!msItems.length) { showToast('Nothing to export yet', 'info'); return; }
    const cols = MS_LIST === 'collection'
        ? ['name', 'line', 'set_num', 'year', 'num_parts', 'condition', 'price_paid', 'market_value', 'img_url', 'notes', 'created_at']
        : ['name', 'line', 'set_num', 'year', 'num_parts', 'retail_price', 'img_url', 'notes', 'created_at'];
    const cell = v => {
        let s = String(v ?? '');
        if (/^[=+\-@]/.test(s)) s = "'" + s;          // keep Excel from running formulas
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...msItems.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mattel-brick-shop-${MS_LIST}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ------------------------------------------------------------
// Boot — wait for core.js to confirm the Supabase session
// ------------------------------------------------------------
authReady.then(ok => {
    if (!ok) return;
    if (MS_PAGE === 'mattel-home') msInitHome();
    else if (MS_LIST) msInitList();
});
