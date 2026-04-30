// js/router.js — Event delegation + hash-based navigation
// Replaces: window.X = fn, onclick="window.X()", switchTab() window pollution
//
// Usage:
//   import { navigate, registerAction } from './router.js';
//   registerAction('submitBallot', async (debateId) => { ... });
//
//   HTML:  <button data-action="submitBallot" data-args='["debate-uuid"]'>Submit</button>
//   — no onclick, no window.X

// ── Action registry ────────────────────────────────────────────────────────
const _actions = new Map();

/**
 * Register a named action.
 * @param {string}   name
 * @param {Function} fn
 */
export function registerAction(name, fn) {
    // Silently overwrite – no console warning
    _actions.set(name, fn);
}

/**
 * Register many actions at once.
 * @param {Object} map – { actionName: fn, ... }
 */
export function registerAll(map) {
    for (const [name, fn] of Object.entries(map)) {
        registerAction(name, fn);
    }
}

// Alias for backward compatibility (used by portal.js and others)
export const registerActions = registerAll;

/**
 * Dispatch an action by name with arguments.
 * Args are coerced: numeric-looking strings become numbers.
 */
export function dispatch(name, args = []) {
    const fn = _actions.get(name);
    if (!fn) {
        console.error(`[router] Unknown action: "${name}". Registered:`, [..._actions.keys()]);
        return;
    }
    const coerced = args.map(a => (a !== '' && !isNaN(a) && typeof a === 'string') ? Number(a) : a);
    return fn(...coerced);
}

// ── Single delegated listener ──────────────────────────────────────────────
let _listenerInstalled = false;

function _handleClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    console.log('router click detected action:', action);
    if (!action) return;

    let args = [];
    if (target.dataset.args) {
        try {
            args = JSON.parse(target.dataset.args);
        } catch {
            console.error(`[router] Invalid JSON in data-args for action "${action}":`, target.dataset.args);
            return;
        }
    } else if (target.dataset.id !== undefined) {
        args = [target.dataset.id];
    }

    if (target.tagName === 'A' || target.closest('form')) e.preventDefault();
    e.stopPropagation();

    dispatch(action, args);
}

function _handleChange(e) {
    const target = e.target.closest('select[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (!action) return;
    dispatch(action, [target]);
}

export function installDelegatedListener() {
    if (_listenerInstalled) return;
    document.addEventListener('click', _handleClick, true);
    document.addEventListener('change', _handleChange, true);
    _listenerInstalled = true;
}

// ── Hash-based tab navigation ──────────────────────────────────────────────
const _tabRenderers = new Map();

export function registerTab(tabId, renderFn) {
    _tabRenderers.set(tabId, renderFn);
}

export function navigate(tabId) {
    // Persist active tab for reloads (Tournament Switch, Refresh, etc)
    localStorage.setItem('orion_active_tab', tabId);

    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });

    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active');
        target.style.display = 'block';
    }

    document.querySelectorAll('.dropdown-trigger, .dropdown-item, .mobile-nav-item').forEach(btn => {
        const oc   = btn.getAttribute('onclick') || '';
        const dact = btn.dataset.action;
        const darg = btn.dataset.args || btn.dataset.id;
        const isActive =
            oc.includes(`'${tabId}'`) || oc.includes(`"${tabId}"`) ||
            (dact === 'navigate' && darg === tabId) ||
            (dact === 'switchTab' && darg === tabId);
        btn.classList.toggle('active', isActive);
    });

    history.pushState({ tabId }, '', `#${tabId}`);

    const renderer = _tabRenderers.get(tabId);
    if (renderer) {
        Promise.resolve(renderer()).catch(err => {
            console.error(`[router] Tab render error (${tabId}):`, err);
            navigate('public');
        });
    } else {
        console.warn(`[router] No renderer for tab "${tabId}", falling back to public`);
        navigate('public');
    }

    // ── Layout mode: admin-dashboard gets its own page (no global header/nav) ──
    if (tabId === 'admin-dashboard') {
        document.body.classList.add('admin-mode');
    } else {
        document.body.classList.remove('admin-mode');
    }
}

window.addEventListener('popstate', (e) => {
    const tabId = e.state?.tabId || location.hash.slice(1) || 'public';
    (window.switchTab || navigate)(tabId);
});

// Always allow escaping to public tab with Escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        navigate('public');
    }
});

// tab.js overrides window.switchTab with the access-controlled version after module load

export function exposeOnWindow() {
    for (const [name, fn] of _actions.entries()) {
        if (!(name in window) || window[name] !== fn) {
            window[name] = (...args) => fn(...args);
        }
    }
}

// ── Router initialisation (called by main.js) ──────────────────────────────
export function initRouter() {
    installDelegatedListener();
    exposeOnWindow();
}