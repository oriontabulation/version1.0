/**
 * patches.js  —  Orion Debate Tab
 * <script src="js/patches.js" defer></script>
 */
(function OrionPatches() {
  'use strict';

  /* ────────────────────────────────────────────────────────────
     COLOR MATH HELPERS
  ──────────────────────────────────────────────────────────── */
  function hexToRgb(hex) {
    const h = hex.replace('#','');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgbToHex(r,g,b) {
    return '#' + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
  }
  function hexToHsl(hex) {
    let [r,g,b] = hexToRgb(hex).map(v => v/255);
    const max=Math.max(r,g,b), min=Math.min(r,g,b), l=(max+min)/2;
    if (max===min) return [0,0,l];
    const d=max-min, s=l>0.5?d/(2-max-min):d/(max+min);
    const h = max===r ? (g-b)/d+(g<b?6:0) : max===g ? (b-r)/d+2 : (r-g)/d+4;
    return [h*60, s, l];
  }
  function hslToHex(h,s,l) {
    h /= 360;
    const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
    const hue = t => {
      if (t<0) t+=1; if (t>1) t-=1;
      if (t<1/6) return p+(q-p)*6*t;
      if (t<1/2) return q;
      if (t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    if (s===0) { const v=Math.round(l*255); return rgbToHex(v,v,v); }
    return rgbToHex(Math.round(hue(h+1/3)*255), Math.round(hue(h)*255), Math.round(hue(h-1/3)*255));
  }
  function colorTokens(hex) {
    const [h,s,l]  = hexToHsl(hex);
    const [r,g,b]  = hexToRgb(hex);
    const hover     = hslToHex(h, Math.min(1,s*1.05), Math.max(0, l-0.1));
    const light     = hslToHex(h, Math.min(1,s*0.6),  Math.min(1, l*0.12+0.93));
    const headerBg  = hslToHex(h, Math.min(1,s*0.55), 0.07);
    const pageBg    = hslToHex(h, Math.min(1,s*0.35), 0.96);
    return {
      primary:   hex,
      hover,
      light,
      headerBg,
      pageBg,
      glow:      `rgba(${r},${g},${b},.15)`,
      glowMid:   `rgba(${r},${g},${b},.16)`,
      headerBdr: `rgba(${r},${g},${b},.6)`,
    };
  }

  /* ────────────────────────────────────────────────────────────
     COLOR STORAGE
  ──────────────────────────────────────────────────────────── */
  const COLOR_KEY = 'orion_color';
  const PRESETS   = ['#f97316','#0ea5e9','#10b981','#8b5cf6','#e11d48'];

  function loadColor() { return localStorage.getItem(COLOR_KEY) || '#f97316'; }
  function saveColor(hex) { localStorage.setItem(COLOR_KEY, hex); }

  /* ────────────────────────────────────────────────────────────
     APPLY COLOR — sets all CSS custom properties on :root
  ──────────────────────────────────────────────────────────── */
  function applyColor(hexOrId) {
    // Accept legacy theme IDs for backwards compat
    const ID_MAP = { default:'#f97316', ocean:'#0ea5e9', forest:'#10b981', violet:'#8b5cf6', crimson:'#e11d48' };
    const hex = (ID_MAP[hexOrId] || hexOrId).toLowerCase();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;

    saveColor(hex);
    const tk = colorTokens(hex);
    const root = document.documentElement;

    // Primary brand tokens (used by main.css, admin.css, patches.css)
    root.style.setProperty('--orange-primary', tk.primary);
    root.style.setProperty('--orange-hover',   tk.hover);
    root.style.setProperty('--orange-light',   tk.light);
    root.style.setProperty('--orange-glow',    tk.glow);
    // Patches-specific tokens
    root.style.setProperty('--t-brand',       tk.primary);
    root.style.setProperty('--t-brand-hover', tk.hover);
    root.style.setProperty('--t-brand-light', tk.light);
    root.style.setProperty('--t-brand-glow',  tk.glowMid);
    root.style.setProperty('--t-header-bg',   tk.headerBg);
    root.style.setProperty('--t-header-bdr',  tk.headerBdr);
    root.style.setProperty('--t-page-bg',     tk.pageBg);

    // Sync all picker widgets currently in the DOM
    document.querySelectorAll('.t-swatch').forEach(s => s.style.background = hex);
    document.querySelectorAll('.theme-color-wheel').forEach(i => { i.value = hex; });
    document.querySelectorAll('.theme-wheel-swatch').forEach(s => s.style.background = hex);
    document.querySelectorAll('.theme-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.color === hex);
    });
  }
  window.applyTheme = applyColor;  // backwards compat
  window.applyColor = applyColor;

  /* ────────────────────────────────────────────────────────────
     THEME PICKER WIDGET
  ──────────────────────────────────────────────────────────── */
  function buildPicker(btnClass) {
    const cur = loadColor();
    const w   = document.createElement('div');
    w.className = 'theme-picker-wrapper';

    const presetHTML = PRESETS.map(c =>
      `<button type="button" class="theme-preset${cur===c?' active':''}"
        data-color="${c}" title="${c}"
        style="background:${c}"></button>`
    ).join('');

    w.innerHTML = `
      <button type="button" class="${btnClass || 'theme-picker-btn'}" aria-label="Switch theme">
        <span class="t-swatch" style="background:${cur}"></span>Theme
      </button>
      <div class="theme-dropdown">
        <div class="theme-dropdown-label">Colour theme</div>
        <div class="theme-wheel-row">
          <label class="theme-wheel-label">
            <span class="theme-wheel-swatch" style="background:${cur}"></span>
            <span class="theme-wheel-text">Pick any colour</span>
            <span class="theme-wheel-icon">🎨</span>
            <input type="color" class="theme-color-wheel" value="${cur}" tabindex="-1">
          </label>
        </div>
        <div class="theme-dropdown-label" style="margin-top:10px">Quick picks</div>
        <div class="theme-presets-row">${presetHTML}</div>
      </div>`;

    // Toggle dropdown
    w.querySelector('button.theme-picker-btn, button.adm-pill').addEventListener('click', e => {
      e.stopPropagation();
      const was = w.classList.contains('open');
      closeAll();
      if (!was) { w.classList.add('open'); positionDropdown(w); }
    });

    // Color wheel — live preview on input, save on change
    const wheel = w.querySelector('.theme-color-wheel');
    wheel.addEventListener('input',  () => applyColor(wheel.value));
    wheel.addEventListener('change', () => applyColor(wheel.value));
    wheel.addEventListener('click',  e => e.stopPropagation());

    // Label click opens wheel without closing dropdown
    w.querySelector('.theme-wheel-label').addEventListener('click', e => e.stopPropagation());

    // Preset swatches
    w.querySelectorAll('.theme-preset').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); applyColor(btn.dataset.color); });
    });

    return w;
  }

  function positionDropdown(w) {
    const btn  = w.querySelector('button');
    const drop = w.querySelector('.theme-dropdown');
    if (!btn || !drop) return;
    const r = btn.getBoundingClientRect();
    drop.style.top = (r.bottom + 6) + 'px';
    let left = r.right - drop.offsetWidth;
    if (left < 8) left = 8;
    if (left + drop.offsetWidth > window.innerWidth - 8) left = window.innerWidth - drop.offsetWidth - 8;
    drop.style.left = left + 'px';
  }

  function closeAll() { document.querySelectorAll('.theme-picker-wrapper.open').forEach(w => w.classList.remove('open')); }
  document.addEventListener('click', closeAll);
  window.addEventListener('resize', () => document.querySelectorAll('.theme-picker-wrapper.open').forEach(positionDropdown));

  function injectHeaderPicker() {
    if (document.getElementById('orion-header-picker')) return;
    const controls = document.querySelector('.header-controls');
    if (!controls) return;
    const p = buildPicker('theme-picker-btn');
    p.id = 'orion-header-picker';
    controls.insertBefore(p, document.getElementById('header-login-btn') || controls.firstChild);
  }

  /* ── Brightness & font-size helpers ──────────────────────────────────────── */
  window.applyBrightness = function(val) {
    val = Math.min(1.5, Math.max(0.4, parseFloat(val) || 1));
    document.body.style.filter = val === 1 ? '' : `brightness(${val})`;
    try { localStorage.setItem('orion_brightness', val); } catch(_) { /* ignore unavailable localStorage */ }
  };

  window.applyFontSize = function(px) {
    px = Math.min(22, Math.max(11, parseInt(px) || 16));
    document.documentElement.style.fontSize = px + 'px';
    try { localStorage.setItem('orion_font_size', px); } catch(_) { /* ignore unavailable localStorage */ }
  };

  /* ── Dark mode toggle ─────────────────────────────────────────────────────── */
  function applyThemeMode(mode) {
    const isDark = mode === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    const root = document.documentElement;
    if (mode === 'dark') {
      root.style.setProperty('--t-bg',       '#0f172a');
      root.style.setProperty('--t-text',     '#f1f5f9');
      root.style.setProperty('--t-text-light','#94a3b8');
      root.style.setProperty('--t-border',   '#334155');
      root.style.setProperty('--t-bg-hover', '#1e293b');
    } else {
      root.style.setProperty('--t-bg',       '#f8fafc');
      root.style.setProperty('--t-text',     '#1e293b');
      root.style.setProperty('--t-text-light','#64748b');
      root.style.setProperty('--t-border',   '#e2e8f0');
      root.style.setProperty('--t-bg-hover', '#f1f5f9');
    }
    try {
      localStorage.setItem('orion_theme_mode', mode);
      localStorage.removeItem('orion_theme');
    } catch(_) { /* ignore unavailable localStorage */ }
  }

  function refreshThemePanels() {
    ['theme-picker-container', 'adm-top-settings-theme'].forEach(id => {
      if (document.getElementById(id)) window.renderThemePicker(id);
    });
  }

  window.setBackgroundMode = function(mode) {
    applyThemeMode(mode === 'dark' ? 'dark' : 'light');
    refreshThemePanels();
  };

  window.toggleBackgroundMode = function() {
    const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
    window.setBackgroundMode(next);
  };

  /* ── Settings panel renderer ──────────────────────────────────────────────── */
  window.renderThemePicker = function(containerId) {
    const el = containerId ? document.getElementById(containerId) : null;
    if (!el) return;

    const cur        = loadColor();
    const isDark     = document.body.classList.contains('theme-dark');
    const brightness = Math.round((parseFloat(localStorage.getItem('orion_brightness') || '1')) * 100);
    const fontSize   = parseInt(localStorage.getItem('orion_font_size') || '16');

    const presetsHTML = PRESETS.map(c =>
      `<button type="button" class="stp-preset${cur===c?' active':''}" data-color="${c}"
        style="background:${c}" title="${c}"></button>`
    ).join('');

    el.innerHTML = `<div class="stp-panel">
      <div class="stp-section">
        <div class="stp-section-label">Accent colour</div>
        <div class="stp-presets">
          ${presetsHTML}
          <label class="stp-wheel-label" title="Custom colour">🎨
            <input type="color" class="stp-wheel" value="${cur}">
          </label>
        </div>
      </div>
      <div class="stp-divider"></div>
      <div class="stp-row-toggle">
        <span class="stp-row-label">${isDark ? '☀️' : '🌙'} Dark mode</span>
        <button type="button" class="stp-toggle${isDark ? ' on' : ''}" data-action="dark">
          <span class="stp-toggle-knob"></span>
        </button>
      </div>
      <div class="stp-divider"></div>
      <div class="stp-row-slider">
        <div class="stp-slider-head">
          <span class="stp-row-label">☀️ Brightness</span>
          <span class="stp-slider-val" id="stp-br-val-${containerId}">${brightness}%</span>
        </div>
        <input type="range" class="stp-slider" data-action="brightness"
          min="40" max="150" step="5" value="${brightness}">
      </div>
      <div class="stp-row-slider">
        <div class="stp-slider-head">
          <span class="stp-row-label">Aa Font size</span>
          <span class="stp-slider-val" id="stp-fs-val-${containerId}">${fontSize}px</span>
        </div>
        <input type="range" class="stp-slider" data-action="fontsize"
          min="11" max="22" step="1" value="${fontSize}">
      </div>
    </div>`;

    // Preset swatches
    el.querySelectorAll('.stp-preset').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        applyColor(btn.dataset.color);
        refreshThemePanels();
      });
    });

    // Colour wheel
    const wheel = el.querySelector('.stp-wheel');
    wheel.addEventListener('input',  () => applyColor(wheel.value));
    wheel.addEventListener('change', () => { applyColor(wheel.value); refreshThemePanels(); });
    wheel.addEventListener('click',  e => e.stopPropagation());
    el.querySelector('.stp-wheel-label').addEventListener('click', e => {
      e.stopPropagation();
      wheel.click();
    });

    // Dark mode toggle
    el.querySelector('[data-action="dark"]').addEventListener('click', e => {
      e.stopPropagation();
      window.toggleBackgroundMode();
    });

    // Sliders
    el.querySelectorAll('.stp-slider').forEach(slider => {
      slider.addEventListener('input', e => {
        e.stopPropagation();
        const action = slider.dataset.action;
        if (action === 'brightness') {
          const val = parseInt(slider.value) / 100;
          window.applyBrightness(val);
          const valEl = document.getElementById('stp-br-val-' + containerId);
          if (valEl) valEl.textContent = slider.value + '%';
        } else if (action === 'fontsize') {
          window.applyFontSize(slider.value);
          const valEl = document.getElementById('stp-fs-val-' + containerId);
          if (valEl) valEl.textContent = slider.value + 'px';
        }
      });
      slider.addEventListener('click', e => e.stopPropagation());
    });
  };

  function restoreThemeModePrefs() {
    try {
      applyColor(loadColor());
      applyThemeMode(localStorage.getItem('orion_theme_mode') === 'dark' ? 'dark' : 'light');
      const brightness = parseFloat(localStorage.getItem('orion_brightness') || '1');
      if (brightness !== 1) window.applyBrightness(brightness);
      const fontSize = parseInt(localStorage.getItem('orion_font_size') || '16');
      if (fontSize !== 16) window.applyFontSize(fontSize);
    } catch (_) {
      // Theme prefs are cosmetic; ignore storage failures.
    }
  }

    /* ────────────────────────────────────────────────────────────
     SELECTOR MEMORY
  ──────────────────────────────────────────────────────────── */
  const PREF_KEY = 'orion_draw_prefs';
  function loadPrefs()      { try { return JSON.parse(localStorage.getItem(PREF_KEY)||'{}'); } catch(e){ return {}; } }
  function savePref(k, v)   { const p=loadPrefs(); p[k]=v; try{localStorage.setItem(PREF_KEY,JSON.stringify(p));}catch(e){ /* ignore preference storage errors */ } }
  window._saveDrawPref      = savePref;
  window._admSaveDrawPref   = savePref;

  const SEL_IDS = ['cr-pair','cr-sides','adm-pair-method','adm-side-method','round-filter'];
  function attachSelectors() {
    const prefs = loadPrefs();
    SEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (prefs[id] !== undefined) el.value = prefs[id];
      if (!el._pb) { el._pb = true; el.addEventListener('change', () => savePref(id, el.value)); }
    });
  }

  /* ────────────────────────────────────────────────────────────
     ENTER KEY FLOW: username → password → submit
  ──────────────────────────────────────────────────────────── */
  function patchEnterKey() {
    const u = document.getElementById('loginEmail');
    const p = document.getElementById('loginPassword');
    if (u && !u._eb) { u._eb = true; u.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();p&&p.focus();} }); }
  }

  /* ────────────────────────────────────────────────────────────
     BODY ROLE CLASS
  ──────────────────────────────────────────────────────────── */
  function updateRole() {
    const role = window.state?.auth?.currentUser?.role || 'guest';
    document.body.className = document.body.className.replace(/\brole-\w+\b/g,'').trim() + ' role-' + role;
  }

  /* ────────────────────────────────────────────────────────────
     INELIGIBILITY FIX
  ──────────────────────────────────────────────────────────── */
  function patchToggleIneligible() {
    if (!window.adminToggleIneligible || window.adminToggleIneligible._p) return;
    const orig = window.adminToggleIneligible;
    window.adminToggleIneligible = function(teamId, checked) {
      orig(teamId, checked);
      const cell = document.getElementById('inelig-reason-cell-' + teamId);
      if (!cell) return;
      if (checked && !cell.querySelector('input')) {
        cell.innerHTML = `<input type="text" placeholder="Reason (optional)…"
          onchange="window.adminSetIneligibleReason&&window.adminSetIneligibleReason('${teamId}',this.value)"
          style="width:100%;padding:5px 8px;border:1px solid #fca5a5;border-radius:6px;font-size:12px;background:#fff5f5;color:#991b1b">`;
      } else if (!checked) {
        cell.innerHTML = `<span style="color:#cbd5e1;font-size:12px">—</span>`;
      }
    };
    window.adminToggleIneligible._p = true;
  }

/* ────────────────────────────────────────────────────────────
     OBSERVE DOM for admin mode to inject theme picker
  ──────────────────────────────────────────────────────────── */
  let _headerSyncRunning = false;
  new MutationObserver(() => {
    if (_headerSyncRunning) return;
    _headerSyncRunning = true;
    setTimeout(() => {
      _headerSyncRunning = false;
      if (document.querySelector('.adm-body') && document.getElementById('theme-picker-container')) {
        if (typeof window.renderThemePicker === 'function') {
          window.renderThemePicker('theme-picker-container');
        }
      }
    }, 100);
  }).observe(document.body, { childList:true, subtree:true });

  /* ────────────────────────────────────────────────────────────
     WRAP switchTab — run lightweight tasks after every switch
  ──────────────────────────────────────────────────────────── */
  function _markHasTabHero() {
    document.querySelectorAll('.section, .tab-content').forEach(el => {
      el.classList.toggle('has-tab-hero', el.querySelector('.tab-hero') !== null);
    });
  }

  function wrapSwitchTab() {
    if (!window.switchTab || window.switchTab._w) return;
    const orig = window.switchTab;
    window.switchTab = function(tabId) {
      orig.call(this, tabId);
      setTimeout(() => {
        updateRole();
        attachSelectors();
        patchToggleIneligible();
        injectHeaderPicker();
        _markHasTabHero();
      }, 80);
    };
    window.switchTab._w = true;
  }

  /* ────────────────────────────────────────────────────────────
     INIT
  ──────────────────────────────────────────────────────────── */
  function init() {
    applyColor(loadColor());
    injectHeaderPicker();
    patchEnterKey();
    updateRole();
    attachSelectors();
    patchToggleIneligible();
    wrapSwitchTab();
    _markHasTabHero();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('load', () => { init(); wrapSwitchTab(); });

  // Brief poll for late module attachment
  let n = 0;
  const t = setInterval(() => {
    wrapSwitchTab(); injectHeaderPicker();
    if (++n > 12) clearInterval(t);
  }, 500);

  function patchFilterCounts() {
    const role = window.state?.auth?.currentUser?.role || 'guest';
    if (role === 'admin') return;   // admins see everything
    document.querySelectorAll('.filter-bar__count').forEach(el => {
      el.style.display = 'none';
    });
  }

  // ── Patch body theming to include dark/light text switch ─────
  const _origApplyColor = window.applyColor;
  window.applyColor = function(hex) {
    _origApplyColor && _origApplyColor(hex);
    // Compute perceived luminance to optionally darken body bg more on dark themes
    const ID_MAP = { default:'#f97316', ocean:'#0ea5e9', forest:'#10b981', violet:'#8b5cf6', crimson:'#e11d48' };
    const h = (ID_MAP[hex] || hex).replace('#','');
    if (!/^[0-9a-f]{6}$/i.test(h)) return;
    const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    // Expose RGB components for CSS color-mix fallback
    document.documentElement.style.setProperty('--t-brand-rgb', `${r} ${g} ${b}`);
  };

  // ── Extend init and switchTab hooks ─────────────────────────
  function initEnhancements() {
    patchFilterCounts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initEnhancements);
  else initEnhancements();
  window.addEventListener('load', initEnhancements);

  // Poll for filter count visibility
  let _dm = 0;
  const _dmt = setInterval(() => {
    patchFilterCounts();
    if (++_dm > 10) clearInterval(_dmt);
  }, 600);

  /* ─────────────────────────────────────────────────────────────
     SCROLL LOCK — only when a modal overlay is actually visible
  ───────────────────────────────────────────────────────────── */
  function _lockScroll() {
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = (window.innerWidth - document.documentElement.clientWidth) + 'px';
  }
  function _unlockScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  var _modalWatcher = new MutationObserver(function() {
    var visible = document.querySelector(
      '.modal-overlay:not([style*="display: none"]):not([style*="display:none"])'
    );
    if (visible) _lockScroll(); else _unlockScroll();
  });
  (document.body ? _modalWatcher.observe(document.body, {childList:true,subtree:false})
    : document.addEventListener('DOMContentLoaded', function() {
        _modalWatcher.observe(document.body, {childList:true,subtree:false});
      }));

  /* closeAllModals also unlocks */
  function _applyPatchClose() {
    var orig = window.closeAllModals;
    if (!orig || orig._sp) return;
    window.closeAllModals = function() {
      orig.apply(this, arguments);
      setTimeout(function() {
        var v = document.querySelector('.modal-overlay:not([style*="display: none"]):not([style*="display:none"])');
        if (!v) _unlockScroll();
      }, 60);
    };
    window.closeAllModals._sp = true;
  }
  _applyPatchClose();

  /* showLoginModal CSS fix — applied via MutationObserver, NOT by wrapping window.showLoginModal.
     Wrapping caused an infinite loop:
       openLoginModal (index.html) → wrapper → openLoginModal → wrapper → ...
     The MutationObserver already fires when the modal overlay is added to DOM,
     so we just apply the CSS fix there instead. */
  var _modalStyleWatcher = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (!node || node.nodeType !== 1) continue;
        var ov = null;
        if (node.id === 'auth-modal-overlay' || node.id === 'auth-modal') {
          ov = node;
        } else {
          ov = node.querySelector('#auth-modal-overlay, #auth-modal');
        }
        if (ov) {
          ov.style.cssText += ';position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:10001!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(15,23,42,.88)!important;backdrop-filter:blur(8px)!important;';
          _lockScroll();
        }
      }
    }
  });
  (document.body
    ? _modalStyleWatcher.observe(document.body, {childList:true, subtree:true})
    : document.addEventListener('DOMContentLoaded', function() {
        _modalStyleWatcher.observe(document.body, {childList:true, subtree:true});
      }));

  /* ─────────────────────────────────────────────────────────────
     TAB PERSISTENCE — restore last active tab after refresh
  ───────────────────────────────────────────────────────────── */
  var _TAB_KEY = 'orion_active_tab';

  (function _patchSwitchTab() {
    var orig = window.switchTab;
    if (!orig || orig._pp) return;
    window.switchTab = function(id) {
      if (id) try { localStorage.setItem(_TAB_KEY, id); } catch(e) { /* ignore tab storage errors */ }
      return orig.apply(this, arguments);
    };
    window.switchTab._pp = true;
  }());

  window.addEventListener('load', function() {
    try {
      var saved = localStorage.getItem(_TAB_KEY);
      if (saved && saved !== 'admin-dashboard'
          && !location.search.includes('token')
          && !location.search.includes('room')) {
        window.switchTab && window.switchTab(saved);
      }
    } catch(e) { /* ignore tab restoration errors */ }
  });

  /* ─────────────────────────────────────────────────────────────
     DRAWER AUTH SYNC — reliably mirrors login state to hamburger
  ───────────────────────────────────────────────────────────── */
  function _syncDrawer() {
    var state   = window.state;
    var isAuth  = !!(state && state.auth && state.auth.isAuthenticated && state.auth.currentUser);
    var user    = state && state.auth && state.auth.currentUser;
    var isAdmin = user && user.role === 'admin';
    var dLogin  = document.getElementById('drawer-login-btn');
    var dLogout = document.getElementById('drawer-logout-btn');
    var dName   = document.getElementById('drawer-user-name');
    var admSec  = document.getElementById('drawer-admin-section');
    var navAdm  = document.getElementById('nav-admin-group');
    if (!dLogin) return;
    if (isAuth) {
      if (dName)   dName.textContent   = (user.name || user.email || 'User');
      dLogin.style.display  = 'none';
      dLogout.style.display = 'flex';
    } else {
      if (dName)   dName.textContent   = 'Guest';
      dLogin.style.display  = 'flex';
      dLogout.style.display = 'none';
    }
    if (admSec) admSec.style.display = isAdmin ? 'block' : 'none';
    if (navAdm) navAdm.style.display = isAdmin ? ''      : 'none';
  }
  window.syncDrawerAuth = _syncDrawer;

  /* Patch updateHeaderControls so every auth change syncs the drawer */
  (function _patchUHC() {
    var orig = window.updateHeaderControls;
    if (!orig || orig._ds) return;
    window.updateHeaderControls = function() {
      orig.apply(this, arguments);
      setTimeout(_syncDrawer, 80);
    };
    window.updateHeaderControls._ds = true;
  }());

  /* Patch logout */
  (function _patchLogout() {
    var orig = window.logout;
    if (!orig || orig._ds) return;
    window.logout = function() {
      orig.apply(this, arguments);
      setTimeout(_syncDrawer, 120);
    };
    window.logout._ds = true;
  }());

  /* Sync on hamburger open */
  (function _patchOpen() {
    var orig = window.openMobileNav;
    window.openMobileNav = function() {
      if (orig) orig.apply(this, arguments);
      _syncDrawer();
    };
  }());

  /* Boot retries for Supabase late session restore */
  setTimeout(_syncDrawer, 900);
  setTimeout(_syncDrawer, 2600);

  /* ─────────────────────────────────────────────────────────────
     MOBILE NAV COLLAPSIBLES — Outrounds / Results / More
  ───────────────────────────────────────────────────────────── */
  function _initNavCollapsibles() {
    var body = document.querySelector('.mobile-nav-body');
    if (!body || body.dataset.collDone) return;
    body.dataset.collDone = 'true';
    body.querySelectorAll('.mobile-nav-section').forEach(function(hdr) {
      var text = hdr.textContent.trim();
      if (text === 'Main' || text === 'Admin') return;
      var items = [];
      var sib = hdr.nextElementSibling;
      while (sib && !sib.classList.contains('mobile-nav-section') && sib.id !== 'drawer-admin-section') {
        if (sib.classList.contains('mobile-nav-item') || sib.classList.contains('mobile-nav-sub')) items.push(sib);
        sib = sib.nextElementSibling;
      }
      if (!items.length) return;
      hdr.style.cssText += ';cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;';
      hdr.textContent = text;
      var arrow = document.createElement('span');
      arrow.textContent = '▸';
      arrow.style.cssText = 'font-size:11px;transition:transform .2s;color:rgba(255,255,255,.45);';
      hdr.appendChild(arrow);
      items.forEach(function(el) { el.style.display = 'none'; });
      hdr.addEventListener('click', function() {
        var open = items[0].style.display !== 'none';
        items.forEach(function(el) { el.style.display = open ? 'none' : 'flex'; });
        arrow.style.transform = open ? '' : 'rotate(90deg)';
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     ENHANCED BREAK SIZES (partial breaks, round of 128, etc.)
  ───────────────────────────────────────────────────────────── */
  function _upgradeBreakDropdown() {
    var sel = document.getElementById('adm-break-size');
    if (!sel || sel.dataset.upg) return;
    sel.dataset.upg = '1';
    var sizes = [
      ['2','Final (2 teams)'],['4','Semi-Finals (4 teams)'],['8','Quarter-Finals (8 teams)'],
      ['16','Octo-Finals (16 teams)'],['32','Round of 32'],['64','Round of 64'],
      ['128','Round of 128'],['6p','Partial QF — 6 teams (2 byes)'],
      ['12p','Partial Octo — 12 teams (4 byes)'],['24p','Partial R32 — 24 teams (8 byes)']
    ];
    sel.innerHTML = sizes.map(function(s) {
      return '<option value="' + s[0] + '"' + (s[0]==='8'?' selected':'') + '>' + s[1] + '</option>';
    }).join('');
  }

  /* ─────────────────────────────────────────────────────────────
     CODE NAMES TOGGLE — also refreshes knockout view
  ───────────────────────────────────────────────────────────── */
  (function _patchToggleNames() {
    var orig = window._toggleTeamNames;
    if (!orig || orig._kr) return;
    window._toggleTeamNames = function() {
      orig.apply(this, arguments);
      setTimeout(function() { window.renderKnockout && window.renderKnockout(); }, 80);
    };
    window._toggleTeamNames._kr = true;
  }());

  /* ─────────────────────────────────────────────────────────────
     HIDE JUDGE ROLE FROM REGISTRATION FORM
  ───────────────────────────────────────────────────────────── */
  document.body.classList.add('hide-judge-role-reg');
  (function _hideRoleField() {
    var obs = new MutationObserver(function() {
      document.querySelectorAll(
        '#registerForm [data-field="role"],#registerForm select[id*="role"],#registerForm select[id*="Role"],#registerForm .role-field,#judgeRoleField,#roleField'
      ).forEach(function(el) {
        var wrap = el.closest('.form-group,.field-group') || el;
        wrap.style.display = 'none';
      });
    });
    obs.observe(document.body, {childList:true,subtree:true});
  }());

  /* ─────────────────────────────────────────────────────────────
     INIT POLL — wire everything after modules load
  ───────────────────────────────────────────────────────────── */
  var _initDone = false;
  function _runInits() {
    restoreThemeModePrefs();
    if (!_initDone && window.switchTab && window.closeAllModals) {
      _applyPatchClose();
      // _applyPatchLogin removed — caused infinite recursion loop
      _initDone = true;
    }
    _initNavCollapsibles();
    _upgradeBreakDropdown();
    _syncDrawer();
  }



  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _runInits);
  } else {
    _runInits();
  }

  var _ip = 0;
  var _it = setInterval(function() {
    _runInits();
    if (++_ip > 20) clearInterval(_it);
  }, 500);

})();
