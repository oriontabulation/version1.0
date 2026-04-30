// ============================================
// CATEGORIES.JS — Tournament category system
// Supports named categories (Open, ESL, Junior, etc.)
// that apply to teams, speakers, standings, and break.
// ============================================

import { state, save } from './state.js';
import { showNotification, escapeHTML } from './utils.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
function _isAdmin() {
    return state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin';
}

// ── Preset catalogue (for "Quick Add") ────────────────────────────────────────
export const PRESET_CATEGORIES = [
    { id: 'open',   name: 'Open',   icon: '🌐', color: '#1a73e8' },
    { id: 'esl',    name: 'ESL',    icon: '🌍', color: '#059669' },
    { id: 'efl',    name: 'EFL',    icon: '🗣️', color: '#7c3aed' },
    { id: 'junior', name: 'Junior', icon: '🎓', color: '#d97706' },
    { id: 'senior', name: 'Senior', icon: '🏅', color: '#dc2626' },
    { id: 'epl',    name: 'EPL',    icon: '⚡', color: '#0891b2' },
    { id: 'novice', name: 'Novice', icon: '🌱', color: '#16a34a' },
    { id: 'pro',    name: 'Pro',    icon: '🔥', color: '#9333ea' },
];

// ── Read / write categories on the active tournament ──────────────────────────
export function getCategories() {
    const t = state.tournaments?.[state.activeTournamentId];
    if (!t) return [];
    if (!Array.isArray(t.categories)) t.categories = [];
    return t.categories;
}

export function getCategoryById(catId) {
    return getCategories().find(c => c.id === catId) || null;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function addCategory(name, icon = '🏷️', color = '#64748b') {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return null; }
    if (!name?.trim()) { showNotification('Category name is required', 'error'); return null; }

    const cats = getCategories();
    const id   = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    if (cats.find(c => c.id === id)) {
        showNotification(`Category "${name}" already exists`, 'error');
        return null;
    }

    cats.push({ id, name: name.trim(), icon, color });
    save();
    showNotification(`Category "${name.trim()}" created`, 'success');
    _notifyChange();
    return id;
}

export function deleteCategory(catId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const t = state.tournaments?.[state.activeTournamentId];
    if (!t) return;

    const cat = getCategoryById(catId);
    t.categories = (t.categories || []).filter(c => c.id !== catId);

    // Scrub category from all teams and individual speakers
    (state.teams || []).forEach(team => {
        if (Array.isArray(team.categories)) {
            team.categories = team.categories.filter(c => c !== catId);
        }
        (team.speakers || []).forEach(spk => {
            if (Array.isArray(spk.categories)) {
                spk.categories = spk.categories.filter(c => c !== catId);
            }
        });
    });

    save();
    showNotification(`Category "${cat?.name || catId}" deleted`, 'info');
    _notifyChange();
}

// ── Category assignment ───────────────────────────────────────────────────────
export function assignTeamCategories(teamId, categoryIds) {
    const team = (state.teams || []).find(t => t.id == teamId);
    if (!team) return;
    team.categories = Array.isArray(categoryIds) ? [...categoryIds] : [];
    save();
}

// ── Match helpers (used everywhere) ──────────────────────────────────────────
export function teamMatchesCategory(team, catId) {
    if (!catId) return true;
    return (Array.isArray(team?.categories) ? team.categories : []).includes(catId);
}

/**
 * Returns true when a speaker belongs to catId.
 * Speaker-level categories override team-level ones.
 * Falls back to team-level if the speaker has no individual categories.
 */
export function speakerMatchesCategory(team, speakerName, catId) {
    if (!catId) return true;
    const spk = (team?.speakers || []).find(
        s => s.name?.toLowerCase().trim() === speakerName?.toLowerCase().trim()
    );
    if (spk && Array.isArray(spk.categories) && spk.categories.length > 0) {
        return spk.categories.includes(catId);
    }
    return teamMatchesCategory(team, catId);
}

// ── Notify other modules when categories change ───────────────────────────────
// NOTE: We intentionally do NOT call displayTeams() here.
// Category assignment is now done via inline radio buttons on each display card
// (setTeamCategory in teams.js), so there is no open edit card to re-render.
// Calling displayTeams() here would destroy any card the admin has open for editing.
function _notifyChange() {
    window.updateNavDropdowns?.();
    // Only refresh if no team card is currently in edit mode
    if (!document.querySelector('[data-team-edit="true"]')) {
        window.displayTeams?.();
    }
}

// ── renderCategoryTagger ──────────────────────────────────────────────────────
// Compact widget rendered inside the Edit Team card.
// Shows existing categories as toggleable chips (filled = assigned).
// Includes a collapsible row to create a new category on the fly.
// After creating, re-renders only the tagger section in-place.
//
// Usage in an edit card:
//   ${renderCategoryTagger(team.categories || [], team.id)}
//
// Reading on save:
//   const cats = readCategoryTagger(teamId);
export function renderCategoryTagger(selectedIds = [], teamId) {
    const cats   = getCategories();
    const preset = PRESET_CATEGORIES.filter(p => !cats.find(c => c.id === p.id));
    const pid    = `ct-${teamId}`;   // unique prefix for this card's inputs

    const chips = cats.length === 0
        ? `<span style="font-size:12px;color:#94a3b8;">None yet — use Quick add or create one below.</span>`
        : cats.map(cat => {
            const on = selectedIds.includes(cat.id);
            return `
            <label onclick="setTimeout(()=>window._catRefresh(${teamId}),0)"
                   style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;
                          padding:4px 11px;border-radius:14px;font-size:12px;font-weight:700;
                          border:1.5px solid ${on ? cat.color : cat.color + '55'};
                          background:${on ? cat.color : cat.color + '12'};
                          color:${on ? '#fff' : cat.color};transition:all .12s;">
                <input type="checkbox" class="orion-cat-cb" value="${cat.id}" data-teamid="${teamId}"
                       ${on ? 'checked' : ''}
                       style="display:none;">
                ${cat.icon} ${escapeHTML(cat.name)}
            </label>`;
        }).join('');

    const quickAdd = preset.length > 0
        ? `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-top:8px;margin-top:8px;border-top:1px dashed #e2e8f0;">
               <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">Quick add:</span>
               ${preset.map(p => `
               <button type="button"
                   onclick="window._catQuickAdd('${p.name}','${p.icon}','${p.color}',${teamId})"
                   style="padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;
                          background:${p.color}14;color:${p.color};border:1px dashed ${p.color}66;">
                   ${p.icon} ${p.name}</button>`).join('')}
           </div>`
        : '';

    return `
<div id="cat-tagger-${teamId}" style="margin-bottom:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:600;color:#374151;">🏷️ Categories</span>
        <button type="button"
            onclick="document.getElementById('cat-new-row-${teamId}').classList.toggle('_open');
                     this.textContent=document.getElementById('cat-new-row-${teamId}').classList.contains('_open')?'− cancel':'＋ new category'"
            style="font-size:11px;font-weight:600;color:#1a73e8;background:none;border:none;cursor:pointer;">
            ＋ new category</button>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:6px;min-height:24px;">
        ${chips}
    </div>
    ${quickAdd}

    <!-- create-new row, hidden until toggled -->
    <div id="cat-new-row-${teamId}" style="display:none;margin-top:8px;padding:10px;
         background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <input type="text" id="${pid}-name" placeholder="Name (e.g. EPL, Junior)"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();window._catCreate(${teamId});}"
                   style="flex:1;min-width:110px;padding:6px 10px;border-radius:6px;border:1px solid #e2e8f0;font-size:13px;">
            <select id="${pid}-icon" style="padding:6px;border-radius:6px;border:1px solid #e2e8f0;font-size:14px;cursor:pointer;">
                <option>🏷️</option><option>🌐</option><option>🌍</option><option>🎓</option>
                <option>🏅</option><option>⚡</option><option>🏆</option><option>🎤</option>
                <option>🌱</option><option>🔥</option>
            </select>
            <input type="color" id="${pid}-color" value="#1a73e8"
                   style="height:32px;width:36px;padding:2px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer;">
            <button type="button" onclick="window._catCreate(${teamId})"
                    style="padding:6px 14px;border-radius:6px;background:#1a73e8;color:#fff;
                           border:none;font-size:13px;font-weight:600;cursor:pointer;">Add</button>
        </div>
    </div>
</div>`;
}

// Read which categories are checked for a given teamId
export function readCategoryTagger(teamId) {
    return [...document.querySelectorAll(`.orion-cat-cb[data-teamid="${teamId}"]:checked`)]
        .map(el => el.value);
}

// ── Helpers called from onclick attributes inside the tagger ──────────────────

// Create a new category and re-render only the tagger section
function _catCreate(teamId) {
    const pid   = `ct-${teamId}`;
    const name  = document.getElementById(`${pid}-name`)?.value.trim();
    const icon  = document.getElementById(`${pid}-icon`)?.value  || '🏷️';
    const color = document.getElementById(`${pid}-color`)?.value || '#1a73e8';
    if (!name) { showNotification('Enter a category name', 'error'); return; }

    const id = addCategory(name, icon, color);
    if (!id) return;  // addCategory already shows error if duplicate

    // Re-render just the tagger, preserving the currently checked state
    const currentlyChecked = readCategoryTagger(teamId);
    const newSelected = [...new Set([...currentlyChecked, id])]; // auto-tick the new one
    _replaceTagger(teamId, newSelected);
}

// Quick-add a preset and auto-tick it
function _catQuickAdd(name, icon, color, teamId) {
    const id = addCategory(name, icon, color);
    if (!id) return;
    const currentlyChecked = readCategoryTagger(teamId);
    _replaceTagger(teamId, [...new Set([...currentlyChecked, id])]);
}

function _replaceTagger(teamId, selectedIds) {
    const el = document.getElementById(`cat-tagger-${teamId}`);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = renderCategoryTagger(selectedIds, teamId);
    el.replaceWith(tmp.firstElementChild);
}

// Called after a chip click (via setTimeout so browser has already toggled the checkbox)
function _catRefresh(teamId) {
    _replaceTagger(teamId, readCategoryTagger(teamId));
}

// ── Window exports ────────────────────────────────────────────────────────────
window.addCategory            = addCategory;
window.deleteCategory         = deleteCategory;
window.assignTeamCategories   = assignTeamCategories;
window.getCategories          = getCategories;
window.getCategoryById        = getCategoryById;
window.teamMatchesCategory    = teamMatchesCategory;
window.speakerMatchesCategory = speakerMatchesCategory;
window._catCreate             = _catCreate;
window._catQuickAdd           = _catQuickAdd;
window._catRefresh            = _catRefresh;