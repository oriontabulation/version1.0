// ============================================================
// JUDGES.JS — Judge management (refactored)
//
// KEY CHANGES:
//   - All mutations through api.js → Supabase
//   - No direct state.judges.push() / save()
//   - window.X registrations → registerActions()
//   - DOM via el() factory — no user data in innerHTML
// ============================================================

import { state, addJudgeToCache, removeJudgeFromCache, patchJudge } from './state.js';
import { api } from './api.js';
import { showNotification, escapeHTML, updatePublicCounts } from './utils.js';
import { el, emptyState } from './ui/components.js';
import { registerActions } from './router.js';
import { getJudgeAssignments, buildTeamMap } from './maps.js';
import { renderSmartList, VIRTUALIZATION_THRESHOLD } from './ui/virtual-list.js';

// ── Permission helpers ────────────────────────────────────────────────────────
function _isAdmin() { return !!(state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin'); }
function _myJudgeId() { return state.auth?.currentUser?.associatedId ?? null; }

// ── renderJudges ──────────────────────────────────────────────────────────────
function renderJudges() {
    const container = document.getElementById('judges');
    if (!container) return;

    const isAdmin = _isAdmin();
    const role = state.auth?.currentUser?.role;

    if (!isAdmin && role !== 'judge') {
        container.innerHTML = '';
        container.appendChild(_lockedView());
        return;
    }

    container.innerHTML = '';

    if (isAdmin) {
        container.appendChild(_adminScaffold());
    } else {
        container.appendChild(_judgeProfileSection());
    }

    displayJudges();
}

function _lockedView() {
    const isAuth = state.auth?.isAuthenticated;
    return el('div', { class: 'locked-page' },
        el('div', { class: 'locked-page__inner' },
            el('div', { class: 'locked-page__icon' }, '⚖️'),
            el('span', { class: 'locked-badge locked-badge--danger' }, '🔒 Restricted'),
            el('h2', { class: 'locked-page__heading' }, 'Admin Access Only'),
            el('p', { class: 'locked-page__sub' }, 'Judge management is for tournament administrators. Judges: log in with your judge account.'),
            el('div', { class: 'locked-page__actions' },
                ...(isAuth ? [] : [el('button', { class: 'btn btn-primary', 'data-action': 'showLoginModal' }, '🔑 Login')]),
                el('button', { class: 'btn btn-secondary', 'data-action': 'navigate', 'data-args': '["public"]' }, '← Home')
            )
        )
    );
}

function _adminScaffold() {
    const teams = state.teams || [];
    const frag = document.createDocumentFragment();

    // Add judge form
    const formSec = document.createElement('div');
    formSec.className = 'section';
    formSec.innerHTML = `<h2>Add New Judge</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px;">
            <input type="text"  id="judge-name"  placeholder="Judge Name"               style="padding:12px;">
            <input type="email" id="judge-email" placeholder="Email (for private URL)"   style="padding:12px;">
            <button class="btn btn-primary" style="padding:12px;" data-action="addJudge">Add Judge</button>
        </div>`;

    // Conflict checkboxes
    if (teams.length > 0) {
        const affilDiv = document.createElement('div');
        affilDiv.style.cssText = 'margin-top:10px;padding:15px;background:#f1f5f9;border-radius:8px;';
        const h3 = document.createElement('h3');
        h3.style.margin = '0 0 10px';
        h3.textContent = 'Conflict Affiliations';
        affilDiv.appendChild(h3);
        const scroll = document.createElement('div');
        scroll.style.cssText = 'max-height:150px;overflow-y:auto;';
        for (const team of teams) {
            const lbl = document.createElement('label');
            lbl.className = 'custom-checkbox-label';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'judge-affil';
            chk.value = team.id;
            const spn = document.createElement('span');
            spn.className = 'affil-text';
            spn.textContent = team.name;     // safe textContent
            lbl.appendChild(chk);
            lbl.appendChild(spn);
            scroll.appendChild(lbl);
        }
        affilDiv.appendChild(scroll);
        formSec.appendChild(affilDiv);
    }
    frag.appendChild(formSec);

    // Judge list section
    const listSec = document.createElement('div');
    listSec.className = 'section';
    const listH = document.createElement('h2');
    listH.textContent = 'Judges List';
    const listEl = document.createElement('div');
    listEl.id = 'judges-list';
    listSec.appendChild(listH);
    listSec.appendChild(listEl);
    frag.appendChild(listSec);

    return frag;
}

function _judgeProfileSection() {
    const myId = _myJudgeId();
    const myJudge = (state.judges || []).find(j => String(j.id) === String(myId));
    const frag = document.createDocumentFragment();

    if (myJudge) {
        const profileSec = document.createElement('div');
        profileSec.className = 'section';
        const h = document.createElement('h2');
        h.textContent = '👤 My Judge Profile';
        profileSec.appendChild(h);

        // Profile card
        const card = el('div', { style: 'background:white;border:2px solid #bfdbfe;border-radius:12px;padding:20px;margin-bottom:20px;' });
        card.appendChild(el('div', { style: 'font-size:22px;font-weight:700;color:#1e293b;' }, myJudge.name));
        profileSec.appendChild(card);
        frag.appendChild(profileSec);
    } else {
        const notice = el('div', { class: 'section' },
            el('div', { style: 'background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:14px 18px;font-size:14px;color:#92400e;' },
                '⚠️ Your judge profile has not been linked to this account. Contact the tournament admin.')
        );
        frag.appendChild(notice);
    }

    // All judges section
    const listSec = document.createElement('div');
    listSec.className = 'section';
    const h2 = document.createElement('h2');
    h2.textContent = 'All Judges';
    const listEl = document.createElement('div');
    listEl.id = 'judges-list';
    listSec.appendChild(h2);
    listSec.appendChild(listEl);
    frag.appendChild(listSec);

    return frag;
}

// ── displayJudges ─────────────────────────────────────────────────────────────
let _judgesVirtualList = null;

function displayJudges() {
    const list = document.getElementById('judges-list');
    if (!list) return;

    const judges = state.judges || [];
    const isAdmin = _isAdmin();

    // Clean up existing virtual list
    if (_judgesVirtualList) {
        _judgesVirtualList.destroy();
        _judgesVirtualList = null;
    }

    list.innerHTML = '';
    if (judges.length === 0) {
        list.appendChild(emptyState('⚖️', 'No Judges', 'Add your first judge above.'));
        return;
    }

    // Use virtual list for large datasets
    if (judges.length >= VIRTUALIZATION_THRESHOLD) {
        // Set a fixed height for the container to enable scrolling
        list.style.height = '500px';
        list.style.overflow = 'auto';

        _judgesVirtualList = renderSmartList({
            container: list,
            items: judges,
            itemHeight: 90, // Approximate card height
            renderItem: (judge, index) => _buildJudgeCard(judge, isAdmin),
            emptyMessage: 'Add your first judge above.'
        });
    } else {
        // Use regular rendering for small lists
        list.style.height = '';
        list.style.overflow = '';
        for (const judge of judges) {
            list.appendChild(_buildJudgeCard(judge, isAdmin));
        }
    }
}

function _buildJudgeCard(judge, isAdmin) {
    const card = el('div', {
        class: 'judge-card',
        id: `judge-${judge.id}`
    });

    const header = el('div', { class: 'judge-header' });
    const avatar = el('div', { class: 'judge-avatar' }, (judge.name || '?')[0].toUpperCase());
    const info = el('div', { class: 'judge-info' });
    info.appendChild(el('strong', {}, judge.name));
    header.appendChild(avatar);
    header.appendChild(info);

    if (isAdmin) {
        const actions = el('div', { style: 'margin-left:auto;display:flex;gap:8px;' });
        actions.appendChild(el('button', { 
            class: 'btn btn-secondary btn-sm', 
            'data-action': 'showEditJudge', 
            'data-args': JSON.stringify([judge.id]) 
        }, '✏️ Edit'));
        actions.appendChild(el('button', { 
            class: 'btn btn-danger btn-sm',
            'data-action': 'deleteJudge', 
            'data-args': JSON.stringify([judge.id]) 
        }, '🗑 Delete'));
        header.appendChild(actions);
    }

    card.appendChild(header);

    // Conflict affiliations
    const conflicts = judge.judge_conflicts || [];
    if (conflicts.length > 0) {
        const conflictDiv = el('div', { style: 'margin-top:10px;font-size:12px;color:#64748b;' }, 'Conflicts: ');
        const teamById = buildTeamMap(state.teams || []);
        for (const c of conflicts) {
            const team = teamById.get(String(c.team_id));
            if (team) {
                conflictDiv.appendChild(el('span', {
                    style: 'background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;margin-left:4px;font-size:11px;'
                }, team.name));
            }
        }
        card.appendChild(conflictDiv);
    }

    return card;
}

// ── addJudge ──────────────────────────────────────────────────────────────────
async function addJudge() {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }

const name = document.getElementById('judge-name')?.value.trim();
    const email = document.getElementById('judge-email')?.value.trim();
    const tournId = state.activeTournamentId;

    if (!name) { showNotification('Judge name required', 'error'); return; }

    const checkedAffils = [...document.querySelectorAll('.judge-affil:checked')].map(cb => cb.value);

    try {
        const judge = await api.createJudge({
            tournamentId: tournId,
            name,
            email
        });
        addJudgeToCache({ ...judge, judge_conflicts: checkedAffils.map(id => ({ team_id: id })) });
        displayJudges();
        updatePublicCounts?.();
        showNotification(`Judge "${name}" added`, 'success');

        document.getElementById('judge-name').value = '';
        if (document.getElementById('judge-email')) document.getElementById('judge-email').value = '';
        document.querySelectorAll('.judge-affil').forEach(cb => cb.checked = false);
    } catch (e) {
        showNotification(`Failed to add judge: ${e.message}`, 'error');
    }
}

// ── deleteJudge ───────────────────────────────────────────────────────────────
async function deleteJudge(judgeId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    if (!confirm('Delete this judge? This cannot be undone.')) return;

    try {
        await api.deleteJudge(judgeId);
        removeJudgeFromCache(judgeId);
        displayJudges();
        showNotification('Judge deleted', 'info');
    } catch (e) {
        showNotification(`Delete failed: ${e.message}`, 'error');
    }
}

// ── showEditJudge / saveEditJudge ─────────────────────────────────────────────
function showEditJudge(judgeId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const judge = (state.judges || []).find(j => String(j.id) === String(judgeId));
    if (!judge) return;
    const card = document.getElementById(`judge-${judgeId}`);
    if (!card) return;

    const teams = state.teams || [];
    const conflictIds = new Set((judge.judge_conflicts || []).map(c => String(c.team_id)));

    card.innerHTML = '';
    const form = el('div', { style: 'background:white;padding:20px;border-radius:12px;border:2px solid #bfdbfe;' });
    const title = el('h3', { style: 'margin-top:0;color:#1e40af;' }, '✏️ Edit Judge — ', judge.name);
    form.appendChild(title);

    const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;' });

    const nameInp = el('input', { type: 'text', id: `edit-judge-name-${judgeId}`, style: 'padding:10px;border-radius:8px;border:1px solid #e2e8f0;width:100%;box-sizing:border-box;' });
    nameInp.value = judge.name;

    const emailInp = el('input', { type: 'email', id: `edit-judge-email-${judgeId}`, style: 'padding:10px;border-radius:8px;border:1px solid #e2e8f0;width:100%;box-sizing:border-box;' });
    emailInp.value = judge.email || '';

    grid.appendChild(el('div', { style: 'grid-column:span2;' }, el('label', { style: 'font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;' }, 'Name'), nameInp));
    grid.appendChild(el('div', { style: 'grid-column:span2;' }, el('label', { style: 'font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;' }, 'Email'), emailInp));
    form.appendChild(grid);

    // Conflict checkboxes
    if (teams.length > 0) {
        const conflictDiv = el('div', { style: 'margin-bottom:14px;' },
            el('label', { style: 'font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:8px;' }, 'Conflict Affiliations')
        );
        const scroll = el('div', { style: 'max-height:100px;overflow-y:auto;padding:6px 10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;' });
        for (const team of teams) {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px;';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = `edit-judge-affil-${judgeId}`;
            chk.value = team.id;
            chk.checked = conflictIds.has(String(team.id));
            const spn = document.createElement('span');
            spn.textContent = team.name;    // safe textContent
            lbl.appendChild(chk);
            lbl.appendChild(spn);
            scroll.appendChild(lbl);
        }
        conflictDiv.appendChild(scroll);
        form.appendChild(conflictDiv);
    }

    const btns = el('div', { style: 'display:flex;gap:10px;' });
    btns.appendChild(el('button', { class: 'btn btn-primary', style: 'padding:10px 20px;', 'data-action': 'saveEditJudge', 'data-args': JSON.stringify([judgeId]) }, '💾 Save'));
    btns.appendChild(el('button', { class: 'btn btn-secondary', style: 'padding:10px 20px;', 'data-action': 'displayJudges' }, 'Cancel'));
    form.appendChild(btns);

    card.appendChild(form);
}

async function saveEditJudge(judgeId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const name = document.getElementById(`edit-judge-name-${judgeId}`)?.value.trim();
    const email = document.getElementById(`edit-judge-email-${judgeId}`)?.value.trim();

    if (!name) { showNotification('Name required', 'error'); return; }

    const affiliations = [...document.querySelectorAll(`.edit-judge-affil-${judgeId}:checked`)].map(cb => cb.value);

    try {
        await api.updateJudge(judgeId, { name, email, affiliations });
        patchJudge(judgeId, { name, email, judge_conflicts: affiliations.map(id => ({ team_id: id })) });
        displayJudges();
        showNotification('Judge updated', 'success');
    } catch (e) {
        showNotification(`Update failed: ${e.message}`, 'error');
    }
}

// ── Register actions ──────────────────────────────────────────────────────────
registerActions({
    addJudge,
    deleteJudge,
    showEditJudge,
    saveEditJudge,
    displayJudges,
    renderJudges,
});

// ── Exports ───────────────────────────────────────────────────────────────────
export {
    renderJudges,
    displayJudges,
    showEditJudge,
    saveEditJudge,
    addJudge,
    deleteJudge
};