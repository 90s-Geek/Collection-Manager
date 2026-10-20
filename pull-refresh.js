// ============================================================
// pull-refresh.js — pull-to-refresh for the home-screen app
// When the site is opened from a phone's home screen it runs without
// the browser's toolbar, so the browser's own pull-down-to-reload is
// gone. This adds it back: at the top of the page, pull down past the
// line and let go to reload. Does nothing in a normal browser tab.
// ============================================================
(() => {
    const isApp = window.matchMedia('(display-mode: standalone)').matches
               || window.navigator.standalone === true;   // older iOS
    if (!isApp || !('ontouchstart' in window)) return;

    const THRESHOLD = 70;   // px the indicator must travel to trigger a reload
    const MAX_PULL  = 110;  // px it can travel at most
    const RESIST    = 0.5;  // finger moves 2px for every 1px of indicator

    const ind = document.createElement('div');
    ind.className = 'ptr-indicator';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML = '<span class="ptr-icon">↻</span><span class="ptr-text">PULL TO REFRESH</span>';
    document.body.appendChild(ind);
    const text = ind.querySelector('.ptr-text');

    let startY = null;
    let pull = 0;
    let refreshing = false;

    // Don't hijack the gesture while a window is open or a field is in use
    function blocked(target) {
        if (document.querySelector('.modal-overlay.active, #lightbox-overlay.active')) return true;
        return !!(target && target.closest && target.closest('input, textarea, select'));
    }

    function render() {
        ind.style.transform = `translate(-50%, ${pull}px)`;
        ind.style.opacity = String(Math.min(1, pull / (THRESHOLD * 0.6)));
        const ready = pull >= THRESHOLD;
        ind.classList.toggle('is-ready', ready);
        text.textContent = ready ? 'RELEASE TO REFRESH' : 'PULL TO REFRESH';
        ind.querySelector('.ptr-icon').style.transform = `rotate(${Math.round(pull / THRESHOLD * 270)}deg)`;
    }

    function reset() {
        startY = null;
        pull = 0;
        ind.classList.add('is-settling');
        render();
        setTimeout(() => ind.classList.remove('is-settling'), 250);
    }

    window.addEventListener('touchstart', e => {
        if (refreshing || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) {
            startY = null;
            return;
        }
        startY = e.touches[0].clientY;
        pull = 0;
        ind.classList.remove('is-settling');
    }, { passive: true });

    window.addEventListener('touchmove', e => {
        if (startY === null || refreshing) return;
        const dy = e.touches[0].clientY - startY;
        if (dy <= 0 || window.scrollY > 0) {
            if (pull) { pull = 0; render(); }
            return;
        }
        pull = Math.min(MAX_PULL, dy * RESIST);
        render();
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (startY === null || refreshing) return;
        if (pull >= THRESHOLD) {
            refreshing = true;
            ind.classList.add('is-refreshing');
            ind.querySelector('.ptr-icon').style.transform = '';
            text.textContent = 'REFRESHING…';
            setTimeout(() => window.location.reload(), 150);
        } else {
            reset();
        }
    }, { passive: true });

    window.addEventListener('touchcancel', () => { if (!refreshing) reset(); }, { passive: true });
})();
