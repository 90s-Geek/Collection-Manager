// ============================================================
// photos.js — collection.html only (load after core.js + collection.js)
// Your own photo gallery per set, stored in Supabase:
//   • files  → Storage bucket 'set-photos' (private, signed links)
//   • rows   → public.lego_photos (collection_id, path, sort_order)
// Adds: MY PHOTOS section in the edit modal (upload / delete /
// drag-and-drop), your photos in the image lightbox, a 📷 count
// badge on cards, and Storage cleanup when sets are removed.
// Hooks in by wrapping a few existing functions, so core.js and
// collection.js stay untouched. Setup SQL: supabase-photos.sql.
// ============================================================

const PHOTO_BUCKET      = 'set-photos';
const PHOTO_MAX_EDGE    = 1600;   // px — longest side after resize
const PHOTO_QUALITY     = 0.82;   // JPEG quality
const PHOTO_MAX_PER_SET = 12;
const PHOTO_URL_TTL     = 3600;   // seconds a signed link stays valid

let photoCounts = {};             // collection_id → number of photos
const photoCache = {};            // collection_id → { photos:[{id,path,url}], expires }
let _photoModalItemId = null;     // which set the open modal belongs to
let _photoLightboxToken = 0;      // guards against a stale lightbox load
let _photoLastRendered = [];      // data passed to the last renderCollection()

// ---------- Data ----------

async function loadPhotoCounts() {
    const { data, error } = await db.from('lego_photos').select('collection_id');
    if (error) { console.warn('Photo counts unavailable:', error.message); return; }
    photoCounts = {};
    (data || []).forEach(r => { photoCounts[r.collection_id] = (photoCounts[r.collection_id] || 0) + 1; });
}

// Returns [{id, path, url}] for a set, using signed links cached until shortly before expiry
async function getSetPhotos(itemId, force = false) {
    const hit = photoCache[itemId];
    if (!force && hit && hit.expires > Date.now()) return hit.photos;

    const { data, error } = await db.from('lego_photos')
        .select('id, path')
        .eq('collection_id', itemId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const photos = (data || []).map(r => ({ id: r.id, path: r.path, url: null }));
    if (photos.length) {
        const { data: signed, error: signErr } = await db.storage.from(PHOTO_BUCKET)
            .createSignedUrls(photos.map(p => p.path), PHOTO_URL_TTL);
        if (signErr) throw new Error(signErr.message);
        const byPath = new Map((signed || []).map(s => [s.path, s.signedUrl]));
        photos.forEach(p => { p.url = byPath.get(p.path) || null; });
    }

    photoCache[itemId] = { photos, expires: Date.now() + (PHOTO_URL_TTL - 300) * 1000 };
    photoCounts[itemId] = photos.length;
    return photos;
}

// [{collection_id, path}] for a list of set ids (batched to keep URLs short)
async function photoRowsFor(ids) {
    const rows = [];
    for (let i = 0; i < ids.length; i += 50) {
        const { data, error } = await db.from('lego_photos')
            .select('collection_id, path')
            .in('collection_id', ids.slice(i, i + 50));
        if (error) throw new Error(error.message);
        rows.push(...(data || []));
    }
    return rows;
}

async function removePhotoFiles(paths) {
    for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 100));
        if (error) console.warn('Could not remove photo files:', error.message);
    }
}

function forgetPhotos(itemId) {
    delete photoCache[itemId];
    delete photoCounts[itemId];
}

// ---------- Resize + upload ----------

// Loads any browser-readable image (EXIF rotation applied) and returns a JPEG Blob
// no larger than PHOTO_MAX_EDGE on its longest side.
function resizeForUpload(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';               // transparent PNGs → white, not black
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('could not compress')), 'image/jpeg', PHOTO_QUALITY);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("this browser can't read that image format"));
        };
        img.src = url;
    });
}

function photoStatus(msg, type = '') {
    const el = document.getElementById('photo-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'photo-status' + (type ? ` photo-status--${type}` : '');
}

async function uploadSetPhotos(item, fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return showToast('Pick image files to upload.', 'warning');

    const addBtn = document.getElementById('photo-add-btn');
    if (addBtn) addBtn.disabled = true;

    let existing = 0;
    try { existing = (await getSetPhotos(item.id)).length; } catch {}
    const room = PHOTO_MAX_PER_SET - existing;
    if (room <= 0) {
        if (addBtn) addBtn.disabled = false;
        return showToast(`This set already has ${PHOTO_MAX_PER_SET} photos.`, 'warning');
    }
    const queue = files.slice(0, room);
    if (files.length > room) showToast(`Only ${room} more photo${room !== 1 ? 's' : ''} fit — uploading the first ${room}.`, 'warning');

    let ok = 0;
    const failures = [];
    for (let i = 0; i < queue.length; i++) {
        const file = queue[i];
        photoStatus(`⟳ Uploading ${i + 1} / ${queue.length}…`);
        try {
            const blob = await resizeForUpload(file);
            const path = `${item.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

            const { error: upErr } = await db.storage.from(PHOTO_BUCKET)
                .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
            if (upErr) throw new Error(upErr.message);

            const { error: rowErr } = await db.from('lego_photos')
                .insert([{ collection_id: item.id, path, sort_order: existing + ok }]);
            if (rowErr) {
                await db.storage.from(PHOTO_BUCKET).remove([path]); // don't leave an orphan file
                throw new Error(rowErr.message);
            }
            ok++;
        } catch (err) {
            failures.push(`${file.name}: ${err.message}`);
        }
    }

    delete photoCache[item.id];
    if (addBtn) addBtn.disabled = false;

    if (failures.length) {
        console.warn('Photo upload failures:', failures);
        photoStatus(`✗ ${failures.length} failed — ${failures[0]}`, 'error');
    } else {
        photoStatus('');
    }
    if (ok) showToast(`Added ${ok} photo${ok !== 1 ? 's' : ''}.`, 'success');

    await renderPhotoGallery(item);
    decoratePhotoBadges();
}

async function deleteSetPhoto(item, photo) {
    if (!confirm('Delete this photo?')) return;
    const { error } = await db.from('lego_photos').delete().eq('id', photo.id);
    if (error) return showToast('Error deleting photo: ' + error.message, 'error');
    await removePhotoFiles([photo.path]);
    delete photoCache[item.id];
    showToast('Photo deleted.', 'info');
    await renderPhotoGallery(item);
    decoratePhotoBadges();
}

// ---------- Modal gallery ----------

function photoSectionHTML() {
    return `
        <div class="photo-section" id="photo-section">
            <div class="photo-section-head">
                <span class="photo-section-title">My Photos</span>
                <span class="photo-section-count" id="photo-count"></span>
            </div>
            <div class="photo-grid" id="photo-grid"><div class="photo-grid-msg">⟳ Loading photos…</div></div>
            <input type="file" id="photo-file-input" accept="image/*" multiple hidden>
            <button type="button" class="photo-add-btn" id="photo-add-btn">＋ ADD PHOTOS</button>
            <div class="photo-drop-hint">or drop images here</div>
            <div class="photo-status" id="photo-status" aria-live="polite"></div>
        </div>`;
}

async function renderPhotoGallery(item) {
    const grid = document.getElementById('photo-grid');
    if (!grid || _photoModalItemId !== item.id) return;

    let photos;
    try {
        photos = await getSetPhotos(item.id);
    } catch (err) {
        if (_photoModalItemId !== item.id) return;
        grid.innerHTML = `<div class="photo-grid-msg photo-grid-msg--error">Couldn't load photos (${escapeHTML(err.message)})</div>`;
        return;
    }
    if (_photoModalItemId !== item.id) return; // modal moved on to another set

    const countEl = document.getElementById('photo-count');
    if (countEl) countEl.textContent = photos.length ? `${photos.length} / ${PHOTO_MAX_PER_SET}` : '';
    const addBtn = document.getElementById('photo-add-btn');
    if (addBtn) addBtn.hidden = photos.length >= PHOTO_MAX_PER_SET;

    if (!photos.length) {
        grid.innerHTML = '<div class="photo-grid-msg">No photos yet — add a few shots of your build.</div>';
        return;
    }

    grid.innerHTML = '';
    photos.forEach((photo, idx) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile';

        const img = document.createElement('img');
        img.src = photo.url || '';
        img.alt = `My photo ${idx + 1}`;
        img.loading = 'lazy';
        img.title = 'Click to enlarge';
        attachImgFallback(img);
        img.addEventListener('click', () => openItemLightbox(item, idx));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'photo-del';
        del.title = 'Delete photo';
        del.setAttribute('aria-label', `Delete photo ${idx + 1}`);
        del.textContent = '✕';
        del.addEventListener('click', e => { e.stopPropagation(); deleteSetPhoto(item, photo); });

        tile.appendChild(img);
        tile.appendChild(del);
        grid.appendChild(tile);
    });
}

function attachPhotoSection(item) {
    const meta = document.querySelector('#modal-content .modal-meta');
    if (!meta || !item || item.id == null) return;
    _photoModalItemId = item.id;
    meta.insertAdjacentHTML('beforeend', photoSectionHTML());

    const input   = document.getElementById('photo-file-input');
    const addBtn  = document.getElementById('photo-add-btn');
    const section = document.getElementById('photo-section');

    addBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        if (input.files && input.files.length) uploadSetPhotos(item, input.files);
        input.value = '';
    });

    // Drag-and-drop from the desktop
    section.addEventListener('dragover', e => { e.preventDefault(); section.classList.add('is-dragover'); });
    section.addEventListener('dragleave', e => { if (!section.contains(e.relatedTarget)) section.classList.remove('is-dragover'); });
    section.addEventListener('drop', e => {
        e.preventDefault();
        section.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files.length) uploadSetPhotos(item, e.dataTransfer.files);
    });

    renderPhotoGallery(item);
}

// ---------- Card badges ----------

function decoratePhotoBadges() {
    const lis = document.querySelectorAll('#collection-list > li.collection-item');
    lis.forEach((li, i) => {
        const item = _photoLastRendered[i];
        if (!item) return;
        li.querySelector('.photo-count-badge')?.remove();
        const n = photoCounts[item.id];
        if (!n) return;
        const textDiv = li.querySelector('.collection-item-info > div');
        if (!textDiv) return;
        const badge = document.createElement('span');
        badge.className = 'photo-count-badge';
        badge.title = `${n} photo${n !== 1 ? 's' : ''} of your set`;
        badge.textContent = `📷 ${n}`;
        textDiv.insertBefore(badge, textDiv.querySelector('br'));
    });
}

// ---------- Hooks into core.js / collection.js ----------

(() => {
    // Load photo counts alongside the collection, then badge the cards
    const _loadCollection = loadCollection;
    loadCollection = async function () {
        const counts = loadPhotoCounts();
        await _loadCollection.apply(this, arguments);
        await counts;
        decoratePhotoBadges();
    };

    // Remember what was rendered so badges line up with cards
    const _renderCollection = renderCollection;
    renderCollection = function (data) {
        _renderCollection.apply(this, arguments);
        _photoLastRendered = data || [];
        decoratePhotoBadges();
    };

    // Add the MY PHOTOS section to the edit modal
    const _showModal = showModal;
    showModal = function (item) {
        _photoModalItemId = null;
        _showModal.apply(this, arguments);
        if (!isWantlistPage()) attachPhotoSection(item);
    };

    // Put your photos into the lightbox right after the main image.
    // startPhoto (optional) = index of your photo to show first.
    const _openItemLightbox = openItemLightbox;
    openItemLightbox = async function (item, startPhoto) {
        const token = ++_photoLightboxToken;
        await _openItemLightbox.call(this, item);
        if (isWantlistPage() || !item || item.id == null) return;

        let photos = [];
        try { photos = await getSetPhotos(item.id); } catch { return; }
        const overlay = document.getElementById('lightbox-overlay');
        if (token !== _photoLightboxToken || !overlay || !overlay.classList.contains('active')) return;

        const imgs = photos.filter(p => p.url).map((p, i) => ({ src: p.url, label: `My Photo ${i + 1}` }));
        if (!imgs.length) return;

        const at = Math.min(1, _lbImages.length);   // after "Main", or first if there's no main image
        _lbImages.splice(at, 0, ...imgs);
        lbRenderThumbs();

        if (typeof startPhoto === 'number' || at === 0) {
            lbShowImage(at + (typeof startPhoto === 'number' ? startPhoto : 0));
        } else {
            const counter = document.getElementById('lb-counter');
            if (counter) counter.textContent = `${_lbIndex + 1} / ${_lbImages.length}`;
            const next = document.getElementById('lb-next');
            if (next) next.disabled = _lbIndex === _lbImages.length - 1;
        }
    };

    // Removing a set: rows go via ON DELETE CASCADE; delete the files here
    const _deleteSet = deleteSet;
    deleteSet = async function (id) {
        let rows = [];
        try { rows = await photoRowsFor([id]); } catch {}
        await _deleteSet.apply(this, arguments);
        if (!collectionCache.some(i => i.id === id)) {
            if (rows.length) await removePhotoFiles(rows.map(r => r.path));
            forgetPhotos(id);
        }
    };

    const _bulkRemoveSelected = bulkRemoveSelected;
    bulkRemoveSelected = async function () {
        const ids = [...bulkSelected];
        let rows = [];
        if (ids.length) { try { rows = await photoRowsFor(ids); } catch {} }
        await _bulkRemoveSelected.apply(this, arguments);
        const removed = new Set(ids.filter(id => !collectionCache.some(i => i.id === id)));
        const paths = rows.filter(r => removed.has(r.collection_id)).map(r => r.path);
        if (paths.length) await removePhotoFiles(paths);
        removed.forEach(forgetPhotos);
    };
})();
