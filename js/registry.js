// ============================================
// REGISTRY.JS — Central Action Dispatcher
// ============================================

const _registry = new Map();

/** Register a named action. */
export function register(name, fn) {
    if (_registry.has(name)) {
        console.warn(`[registry] Overwriting action: ${name}`);
    }
    _registry.set(name, fn);
}

/** Register many actions at once from an object/map. */
export function registerAll(map) {
    for (const [name, fn] of Object.entries(map)) {
        register(name, fn);
    }
}

/**
 * Dispatch an action by name with arguments.
 * Arguments are coerced from strings to numbers where possible.
 */
export function dispatch(name, args = []) {
    const fn = _registry.get(name);
    if (!fn) {
        console.error(`[registry] Unknown action: "${name}". Registered:`, [..._registry.keys()]);
        return;
    }
    // Coerce numeric-looking strings to numbers
    const coerced = args.map(a => (a !== '' && !isNaN(a) ? Number(a) : a));
    return fn(...coerced);
}

export function handleDataAction(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return false;

    const action = el.dataset.action;
    let args = [];

    if (el.dataset.args) {
        try {
            args = JSON.parse(el.dataset.args);
        } catch {
            console.error(`[registry] Bad JSON in data-args on ${action}:`, el.dataset.args);
            return false;
        }
    } else if (el.dataset.id !== undefined) {
        args = [el.dataset.id];
    }

    event.stopPropagation();
    dispatch(action, args);
    return true;
}

// ─── Install a delegated listener on a container ──────────────────────────────
//
// Call this once per stable container (e.g. the <main> element or each tab div).
// It handles all data-action clicks inside that container without needing
// listeners on individual elements.
//
// Usage: delegateActions(document.getElementById('teams'));
//        delegateActions(document.getElementById('draw'));

export function delegateActions(container, eventType = 'click') {
    if (!container) return;
    container.addEventListener(eventType, handleDataAction);
}

// ─── Expose as window._orion for old onclick="window.X()" strings ────────────
//
// During migration, any onclick that hasn't been converted yet will still work
// because we re-expose every registered function under its original window name.
// Once all templates are converted to data-action, this can be removed.

export function exposeOnWindow() {
    for (const [name, fn] of _registry.entries()) {
        window[name] = fn;
    }
    // Also expose the dispatcher itself for hybrid onclick usage
    window._orion = (event) => handleDataAction(event);
}
