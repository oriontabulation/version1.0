// ============================================================
// TEAMS.JS — Team management
//
// KEY CHANGES:
//   - All mutations go through api.js → Supabase

// ============================================================

import { state, addTeamToCache, removeTeamFromCache, patchTeam } from './state.js';
import { api } from './api.js';
import { buildTeamMap } from './maps.js';
import { showNotification, escapeHTML } from './utils.js';
import { getCategories, teamMatchesCategory } from './categories.js';
import { el, replaceChildren, emptyState } from './ui/components.js';
import { renderSmartList, VIRTUALIZATION_THRESHOLD } from './ui/virtual-list.js';

// ── Permission helpers ────────────────────────────────────────────────────────
function _isAdmin() { return !!(state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin'); }
function _myTeamId() { return state.auth?.currentUser?.associatedId ?? null; }

let _teamsListCategory = null;

// ── renderTeams ───────────────────────────────────────────────────────────────
export function renderTeams() {
    const container = document.getElementById('teams');
    if (!container) return;

    const isAdmin = _isAdmin();
    const role = state.auth?.currentUser?.role;

    if (!isAdmin && role !== 'team') {
        _renderLocked(container);
        return;
    }

    // Build scaffold with static HTML (no user data interpolated)
    container.innerHTML = '';
    if (isAdmin) _renderAdminScaffold(container);
    else _renderTeamScaffold(container);

    displayTeams();
}

function _renderLocked(container) {
    const isAuth = state.auth?.isAuthenticated;
    container.innerHTML = '';
    const wrap = el('div', { class: 'locked-page' },
        el('div', { class: 'locked-page__inner' },
            el('div', { class: 'locked-page__icon' }, '👥'),
            el('span', { class: 'locked-badge locked-badge--danger' }, '🔒 Restricted'),
            el('h2', { class: 'locked-page__heading' }, 'Admin Access Only'),
            el('p', { class: 'locked-page__sub' }, 'Team management is for tournament administrators only.'),
            el('div', { class: 'locked-page__actions' },
                ...(isAuth ? [] : [el('button', { class: 'btn btn-primary', 'data-action': 'showLoginModal' }, '🔑 Login')]),
                el('button', { class: 'btn btn-secondary', 'data-action': 'navigate', 'data-args': '["public"]' }, '← Home')
            )
        )
    );
    container.appendChild(wrap);
}

function _renderAdminScaffold(container) {
    const cats = getCategories();
    const formSection = document.createElement('div');
    formSection.className = 'section';
    formSection.innerHTML = `
        <h2 style="margin:0 0 20px;">Add New Team</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
            <input type="text"  id="team-name"  placeholder="Team Name *"          style="padding:11px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;">
            <input type="text"  id="team-code"  placeholder="Code (e.g. SEN)"       style="padding:11px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;">
            <input type="email" id="team-email" placeholder="Team Email (optional)" style="padding:11px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;">
        </div>
        <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px;">Speakers (up to 5)</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
            ${[1,2,3,4,5].map(n => `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <input type="text"  id="speaker${n}-name"  placeholder="Speaker ${n} Name"  style="padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
                <input type="email" id="speaker${n}-email" placeholder="Speaker ${n} Email" style="padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
            </div>`).join('')}
        </div>
        <button class="btn btn-primary" style="padding:11px 24px;font-size:14px;" data-action="addTeam">Add Team</button>`;

    // Category filter if applicable
    const listSection = document.createElement('div');
    listSection.className = 'section';
    const listHeader = document.createElement('div');
    listHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px;';
    const h = document.createElement('h2');
    h.style.margin = '0';
    h.textContent = 'Teams List';
    listHeader.appendChild(h);

    if (cats.length > 0) {
        const filterRow = document.createElement('div');
        filterRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
        const allBtn = el('button', {
            style: 'border:1.5px solid #1a73e8;border-radius:16px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;background:#1a73e8;color:white;',
            'data-action': 'filterTeamsByCategory',
            'data-args': '[]'
        }, 'All');
        filterRow.appendChild(allBtn);
        for (const cat of cats) {
            const btn = el('button', {
                style: `background:${cat.color}15;color:${cat.color};border:1.5px solid ${cat.color}50;border-radius:16px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;`,
                'data-action': 'filterTeamsByCategory',
                'data-args': JSON.stringify([cat.id])
            }, `${cat.icon || ''} `, cat.name);
            filterRow.appendChild(btn);
        }
        listHeader.appendChild(filterRow);
    }
    listSection.appendChild(listHeader);
    const listEl = document.createElement('div');
    listEl.id = 'teams-list';
    listSection.appendChild(listEl);

    container.appendChild(formSection);
    container.appendChild(listSection);
}

function _renderTeamScaffold(container) {
    const section = el('div', { class: 'section' });
    const notice = el('div', {
        style: 'background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#1e40af'
    }, 'ℹ️ You can view your team profile here. Contact the admin to make changes.');
    const h = document.createElement('h2');
    h.textContent = 'Your Team';
    const listEl = document.createElement('div');
    listEl.id = 'teams-list';
    section.appendChild(notice);
    section.appendChild(h);
    section.appendChild(listEl);
    container.appendChild(section);
}

// ── displayTeams ─────────────────────────────────────────────────────────────
let _teamsVirtualList = null;

export function displayTeams() {
    const list = document.getElementById('teams-list');
    if (!list) return;

    const isAdmin = _isAdmin();
    const myTeamId = _myTeamId();
    const cats = getCategories();

    let teams = isAdmin ? [...(state.teams || [])] : (state.teams || []).filter(t => String(t.id) === String(myTeamId));

    if (isAdmin && _teamsListCategory) {
        teams = teams.filter(t => teamMatchesCategory(t, _teamsListCategory));
    }

    // Clean up existing virtual list
    if (_teamsVirtualList) {
        _teamsVirtualList.destroy();
        _teamsVirtualList = null;
    }

    if (teams.length === 0) {
        list.innerHTML = '';
        list.appendChild(emptyState('👥', 'No Teams', isAdmin ? 'Add your first team above.' : 'Your team profile was not found. Contact the admin.'));
        return;
    }

    // Use virtual list for large datasets
    if (teams.length >= VIRTUALIZATION_THRESHOLD) {
        // Set a fixed height for the container to enable scrolling
        list.style.height = '600px';
        list.style.overflow = 'auto';

        _teamsVirtualList = renderSmartList({
            container: list,
            items: teams,
            itemHeight: 140, // Approximate card height
            renderItem: (team, index) => _buildTeamCard(team, isAdmin, cats),
            emptyMessage: isAdmin ? 'Add your first team above.' : 'Your team profile was not found. Contact the admin.'
        });
    } else {
        // Use regular rendering for small lists
        list.style.height = '';
        list.style.overflow = '';
        list.innerHTML = '';
        for (const team of teams) {
            list.appendChild(_buildTeamCard(team, isAdmin, cats));
        }
    }
}

const _CARD = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:20px;width:100%;box-sizing:border-box;';

function _buildTeamCard(team, isAdmin, cats = []) {
    const card = el('div', { id: `team-${team.id}`, style: _CARD + (team.broke ? 'border-left:4px solid #10b981;' : team.eliminated ? 'border-left:4px solid #dc2626;opacity:0.8;' : '') });

    // ── Header row ──
    const header = el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' });
    header.appendChild(el('strong', { style: 'font-size:16px;color:#0f172a;' }, team.name));
    if (team.code) header.appendChild(el('span', { style: 'background:#f1f5f9;color:#475569;font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;' }, team.code));
    if (team.broke) header.appendChild(el('span', { style: 'background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;' }, `🏆 Seed ${team.seed || '?'}`));
    if (team.eliminated) header.appendChild(el('span', { style: 'background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;' }, 'Eliminated'));

    // Category badges
    if (cats.length > 0 && team.categories?.length > 0) {
        for (const catId of team.categories) {
            const cat = cats.find(c => c.id === catId);
            if (cat) header.appendChild(el('span', { style: `background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}44;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;` }, `${cat.icon || ''}${cat.name}`));
        }
    }

    // W/L + admin actions grouped at right
    const right = el('div', { style: 'margin-left:auto;display:flex;align-items:center;gap:8px;flex-shrink:0;' });
    if (team.wins != null || team.losses != null) {
        const w = team.wins ?? 0, l = team.losses ?? 0;
        right.appendChild(el('span', { style: 'font-size:13px;color:#64748b;white-space:nowrap;' }, `${w}W – ${l}L`));
    }
    if (isAdmin) {
        right.appendChild(el('button', {
            style: 'padding:6px 14px;font-size:13px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#374151;cursor:pointer;font-weight:500;',
            'data-action': 'showEditTeam', 'data-args': JSON.stringify([team.id])
        }, '✏️ Edit'));
        right.appendChild(el('button', {
            style: 'padding:6px 14px;font-size:13px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;cursor:pointer;font-weight:500;',
            'data-action': 'deleteTeam', 'data-args': JSON.stringify([team.id])
        }, '🗑 Delete'));
    }
    header.appendChild(right);
    card.appendChild(header);

    // ── Speakers ──
    const speakers = (team.speakers || []).filter(s => s.name);
    if (speakers.length > 0) {
        const row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;' });
        for (const s of speakers) {
            row.appendChild(el('span', { style: 'background:#f8fafc;border:1px solid #e2e8f0;color:#334155;font-size:12px;padding:3px 10px;border-radius:12px;' }, s.name + (s.email ? ` · ${s.email}` : '')));
        }
        card.appendChild(row);
    }

    return card;
}

// ── addTeam ───────────────────────────────────────────────────────────────────
export async function addTeam() {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }

    const name = document.getElementById('team-name')?.value.trim();
    const code = document.getElementById('team-code')?.value.trim().toUpperCase();
    const email = document.getElementById('team-email')?.value.trim();
    
    const speakers = [];
    for (let n = 1; n <= 5; n++) {
        const name = document.getElementById(`speaker${n}-name`)?.value.trim();
        const email = document.getElementById(`speaker${n}-email`)?.value.trim();
        if (name) speakers.push({ name, email: email || null, position: n });
    }
    
    const catId = document.getElementById('add-team-category')?.value || null;
    const tournId = state.activeTournamentId;

    if (!name) { showNotification('Team name is required', 'error'); return; }
    if (!tournId) { showNotification('No active tournament. State: ' + JSON.stringify(state), 'error'); return; }

    try {
        const team = await api.createTeam({
            tournamentId: tournId,
            name, code, email, speakers,
            categories: catId ? [catId] : []
        });

        addTeamToCache({ ...team, speakers });
        displayTeams();
        showNotification(`Team "${name}" added`, 'success');

        // Clear form
        ['team-name','team-code','team-email',
         'speaker1-name','speaker1-email','speaker2-name','speaker2-email',
         'speaker3-name','speaker3-email','speaker4-name','speaker4-email',
         'speaker5-name','speaker5-email'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        window.updateNavDropdowns?.();
    } catch (e) {
        showNotification(`Failed to add team: ${e.message}`, 'error');
    }
}

// ── deleteTeam ────────────────────────────────────────────────────────────────
export async function deleteTeam(teamId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    if (!confirm('Delete this team? This cannot be undone.')) return;

    try {
        await api.deleteTeam(teamId);
        removeTeamFromCache(teamId);
        displayTeams();
        showNotification('Team deleted', 'info');
        window.updateNavDropdowns?.();
    } catch (e) {
        showNotification(`Delete failed: ${e.message}`, 'error');
    }
}

// ── showEditTeam / saveEditTeam ───────────────────────────────────────────────
export function showEditTeam(teamId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const team = (state.teams || []).find(t => String(t.id) === String(teamId));
    if (!team) return;
    const card = document.getElementById(`team-${teamId}`);
    if (!card) return;

    const speakers = team.speakers || [];
    const INP = 'width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box;';

    card.innerHTML = '';
    card.style.cssText = _CARD + 'border:2px solid #bfdbfe;';

    const title = el('h3', { style: 'margin:0 0 16px;color:#1e40af;font-size:16px;' }, `✏️ Edit — ${escapeHTML(team.name)}`);
    card.appendChild(title);

    // Team fields
    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:16px;' });
    [['edit-team-name-'+teamId,'text','Team Name *', team.name],
     ['edit-team-code-'+teamId,'text','Code',         team.code||''],
     ['edit-team-email-'+teamId,'email','Email',       team.email||'']
    ].forEach(([id,type,ph,val]) => {
        const inp = el('input', { type, id, placeholder: ph, style: INP });
        inp.value = val;
        grid.appendChild(inp);
    });
    card.appendChild(grid);

    // Speaker fields
    const spkLabel = el('div', { style: 'font-size:13px;font-weight:600;color:#475569;margin-bottom:8px;' }, 'Speakers');
    card.appendChild(spkLabel);
    const spkGrid = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:16px;' });
    for (let n = 1; n <= 5; n++) {
        const s = speakers[n-1] || {};
        const row = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;' });
        const ni = el('input', { type: 'text',  id: `edit-spk${n}-name-${teamId}`,  placeholder: `Speaker ${n} Name`,  style: INP });
        const ei = el('input', { type: 'email', id: `edit-spk${n}-email-${teamId}`, placeholder: `Speaker ${n} Email`, style: INP });
        ni.value = s.name  || '';
        ei.value = s.email || '';
        row.appendChild(ni);
        row.appendChild(ei);
        spkGrid.appendChild(row);
    }
    card.appendChild(spkGrid);

    const btns = el('div', { style: 'display:flex;gap:10px;' });
    btns.appendChild(el('button', { class: 'btn btn-primary',   style: 'padding:9px 20px;', 'data-action': 'saveEditTeam',  'data-args': JSON.stringify([teamId]) }, '💾 Save'));
    btns.appendChild(el('button', { class: 'btn btn-secondary', style: 'padding:9px 20px;', 'data-action': 'displayTeams' }, 'Cancel'));
    card.appendChild(btns);
}

export async function saveEditTeam(teamId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const team = (state.teams || []).find(t => String(t.id) === String(teamId));
    if (!team) return;

    const name  = document.getElementById(`edit-team-name-${teamId}`)?.value.trim();
    const code  = document.getElementById(`edit-team-code-${teamId}`)?.value.trim().toUpperCase();
    const email = document.getElementById(`edit-team-email-${teamId}`)?.value.trim();

    const speakers = [];
    for (let n = 1; n <= 5; n++) {
        const sName  = document.getElementById(`edit-spk${n}-name-${teamId}`)?.value.trim();
        const sEmail = document.getElementById(`edit-spk${n}-email-${teamId}`)?.value.trim();
        if (sName) speakers.push({ name: sName, email: sEmail || null, position: n });
    }

    if (!name) { showNotification('Team name required', 'error'); return; }

    try {
        await api.updateTeam(teamId, { name, code, email, speakers });
        patchTeam(teamId, { name, code, email, speakers });
        displayTeams();
        showNotification('Team updated', 'success');
    } catch (e) {
        showNotification(`Update failed: ${e.message}`, 'error');
    }
}

// ── filterTeamsByCategory ─────────────────────────────────────────────────────
export function filterTeamsByCategory(catId) {
    _teamsListCategory = catId || null;
    displayTeams();
}

// ── Register actions (replaces window.X assignments) ─────────────────────────
import { registerActions } from './router.js';
registerActions({
    addTeam,
    deleteTeam,
    showEditTeam,
    saveEditTeam,
    displayTeams,
    filterTeamsByCategory,
    renderTeams
});
