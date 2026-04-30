// js/ui/components.js — XSS-safe DOM factory
// NEVER use innerHTML with user-controlled data.
// All user content goes through textContent (el() children as strings).

/**
 * Create a DOM element safely.
 * String children become textNode (XSS-safe).
 * Node children are appended directly.
 *
 * @param {string}          tag
 * @param {Object}          attrs   – { class, id, "data-action", "data-args", style, ... }
 * @param {...(string|Node)} children
 * @returns {HTMLElement}
 *
 * Example:
 *   el('div', { class: 'card' },
 *     el('span', { class: 'name' }, judge.name),   // textContent — safe
 *     el('button', { 'data-action': 'removeJudge',
 *                    'data-args': JSON.stringify([judgeId]) }, '×')
 *   )
 */
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);

    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === 'class')    { node.className = v;                 continue; }
        if (k === 'style')    { node.style.cssText = v;             continue; }
        if (k.startsWith('data-')) {
            node.dataset[_camel(k.slice(5))] = String(v);           continue;
        }
        // Boolean attributes (disabled, checked, etc.)
        if (typeof v === 'boolean') {
            if (v) node.setAttribute(k, '');
            else   node.removeAttribute(k);
            continue;
        }
        node.setAttribute(k, String(v));
    }

    for (const child of children) {
        if (child === null || child === undefined) continue;
        node.append(typeof child === 'string' ? child : child);
    }

    return node;
}

// camelCase data attribute names (data-team-id → teamId)
function _camel(s) {
    return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Set multiple children at once on an existing node.
 * Clears existing children first.
 */
export function setChildren(node, ...children) {
    node.textContent = ''; // safe clear
    for (const child of children) {
        if (child !== null && child !== undefined) {
            node.append(typeof child === 'string' ? child : child);
        }
    }
}

// Alias for portal.js and backward compatibility
export const replaceChildren = setChildren;

// ── Shared component builders ──────────────────────────────────────────────

export function badge(text, variant = 'info') {
    return el('span', { class: `badge badge-${variant}` }, text);
}

export function spinner(size = 20) {
    const s = el('span', { class: 'spin', style: `display:inline-block;font-size:${size}px;` }, '⏳');
    return s;
}

export function emptyState(icon, title, desc) {
    return el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state__icon' }, icon),
        el('h3',  { class: 'empty-state__title' }, title),
        el('p',   { class: 'empty-state__desc' },  desc),
    );
}

/**
 * Render a notification banner inline (not the toast system).
 * Use for form-level errors.
 */
export function alertBanner(text, variant = 'error') {
    const colors = {
        error:   { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b' },
        warning: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
        info:    { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af' },
        success: { bg: '#dcfce7', border: '#86efac', text: '#166534' },
    };
    const c = colors[variant] || colors.info;
    return el('div', {
        style: `background:${c.bg};border:1px solid ${c.border};color:${c.text};` +
               `border-radius:8px;padding:10px 14px;font-size:14px;margin-bottom:12px;`
    }, text);
}

/**
 * Build a simple two-column key-value row for info cards.
 */
export function kv(label, value) {
    return el('div', { style: 'display:flex;gap:8px;align-items:baseline;margin-bottom:6px;' },
        el('span', { style: 'font-size:12px;font-weight:700;color:#64748b;min-width:100px;' }, label),
        el('span', { style: 'font-size:14px;color:#1e293b;' }, value),
    );
}

/**
 * Judge chip — used in draw rooms.
 * XSS-safe: judge.name goes through textContent.
 */
export function judgeChip(judge, onRemove = null) {
    const chip = el('span', { class: 'dnd-judge-chip',
        'data-judge-id': judge.id, draggable: 'true' },
        el('span', { class: `chip-role ${judge.role === 'chair' ? 'chair' : ''}` },
            (judge.role || 'panellist').toUpperCase()),
        el('span', {}, judge.name),  // textContent — safe
    );

    if (onRemove) {
        const removeBtn = el('button', {
            class: 'chip-remove', type: 'button',
            'data-action': 'removeJudgeFromPanel',
            'data-args':   JSON.stringify([judge.debateId, judge.id]),
            title: `Remove ${judge.name}`,
        }, '×');
        chip.appendChild(removeBtn);
    }

    return chip;
}

/**
 * Team display chip.
 */
export function teamChip(team, side = '') {
    return el('div', { class: 'dnd-team-chip', 'data-team-id': team.id, draggable: 'true' },
        el('div', { class: `team-side-label ${side}` }, side.toUpperCase()),
        el('div', { class: 'team-chip-name' }, team.name),
        team.code ? el('span', { class: 'team-code' }, team.code) : null,
    );
}

/**
 * Stat card — for the home page hero grid.
 */
export function statCard(icon, label, value) {
    return el('div', { class: 'stat-card' },
        el('div', { class: 'stat-icon' },  icon),
        el('h3',  {},                       label),
        el('div', { class: 'stat-value' }, String(value)),
    );
}

/**
 * Generic action button.
 */
export function actionBtn(label, action, args = [], variant = 'secondary', size = '') {
    return el('button', {
        class: `btn-${variant}${size ? ` btn-${size}` : ''}`,
        'data-action': action,
        'data-args':   JSON.stringify(args),
    }, label);
}

/**
 * Safely update the text of an element found by ID.
 */
export function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(text);
}

/**
 * Show or hide an element by id.
 */
export function setVisible(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
}