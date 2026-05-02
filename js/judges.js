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
    formSec.className = 'section judge-admin-panel';
    formSec.innerHTML = `<div class="judge-panel-head">
            <div>
                <h2>Add Judge</h2>
                <p>Names, emails, and conflicts stay together in one compact roster.</p>
            </div>
            <span>${(state.judges || []).length} judge${(state.judges || []).length === 1 ? '' : 's'}</span>
        </div>
        <div class="judge-add-grid">
            <input type="text"  id="judge-name"  placeholder="Judge name">
            <input type="email" id="judge-email" placeholder="Email optional">
            <button class="btn btn-primary" data-action="addJudge">Add Judge</button>
        </div>`;

    // Conflict checkboxes
    if (teams.length > 0) {
        const affilDiv = document.createElement('div');
        affilDiv.className = 'judge-conflict-panel';
        const h3 = document.createElement('h3');
        h3.textContent = 'Conflict Affiliations';
        affilDiv.appendChild(h3);
        const scroll = document.createElement('div');
        scroll.className = 'judge-conflict-list';
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
    listSec.className = 'section judge-list-section';
    const listH = document.createElement('h2');
    listH.textContent = 'Judges';
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
let _judgeEditModal = null;
let _judgeEditTeamSignature = '';

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
    const card = el('div', { id: `judge-${judge.id}`, class: 'judge-card' });

    const header = el('div', { class: 'judge-header' });
    header.appendChild(el('div', { class: 'judge-avatar' }, (judge.name || '?')[0].toUpperCase()));

    const info = el('div', { class: 'judge-info' });
    info.appendChild(el('strong', {}, judge.name || 'Unnamed'));
    if (judge.email) info.appendChild(el('small', { class: 'judge-email' }, judge.email));
    header.appendChild(info);
    card.appendChild(header);

    const conflicts = judge.judge_conflicts || [];
    if (conflicts.length > 0) {
        const conflictRow = el('div', { class: 'judge-conflicts' });
        conflictRow.appendChild(el('span', { class: 'judge-conflicts__label' }, 'Conflicts:'));
        const teamById = buildTeamMap(state.teams || []);
        for (const c of conflicts) {
            const team = teamById.get(String(c.team_id));
            if (team) conflictRow.appendChild(el('span', { class: 'conflict-chip' }, team.name));
        }
        card.appendChild(conflictRow);
    }

    if (isAdmin) {
        const actions = el('div', { class: 'adm-card-actions-bordered' });
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
        card.appendChild(actions);
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
    if (!tournId) { showNotification('Select or create a tournament before adding judges.', 'error'); return; }

    const checkedAffils = [...document.querySelectorAll('.judge-affil:checked')].map(cb => cb.value);

    try {
        const judge = await api.createJudge({
            tournamentId: tournId,
            name,
            email,
            affiliations: checkedAffils
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
function _ensureJudgeEditModal() {
    if (_judgeEditModal) return _judgeEditModal;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'judge-edit-modal';
    overlay.style.display = 'none';
    overlay.onclick = e => { if (e.target === overlay) _hideJudgeEditModal(); };

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '620px';
    modal.innerHTML = `
        <h2 class="u-mt-0" id="judge-edit-title">Edit Judge</h2>
        <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;">
            <label style="font-size:12px;font-weight:700;color:#64748b;">
                Name
                <input type="text" id="edit-judge-name" style="margin-top:4px;padding:10px;border-radius:8px;border:1px solid #e2e8f0;width:100%;box-sizing:border-box;">
            </label>
            <label style="font-size:12px;font-weight:700;color:#64748b;">
                Email
                <input type="email" id="edit-judge-email" style="margin-top:4px;padding:10px;border-radius:8px;border:1px solid #e2e8f0;width:100%;box-sizing:border-box;">
            </label>
        </div>
        <div style="margin-bottom:14px;">
            <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:8px;">Conflict Affiliations</label>
            <input type="search" id="edit-judge-affil-search" placeholder="Search teams..." style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;box-sizing:border-box;">
            <div id="edit-judge-affil-list" style="max-height:220px;overflow:auto;padding:6px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;"></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn btn-secondary" id="judge-edit-cancel" type="button">Cancel</button>
            <button class="btn btn-primary" id="judge-edit-save" type="button">Save</button>
        </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modal.querySelector('#judge-edit-cancel').addEventListener('click', _hideJudgeEditModal);
    modal.querySelector('#judge-edit-save').addEventListener('click', () => saveEditJudge(overlay.dataset.judgeId));
    modal.querySelector('#edit-judge-affil-search').addEventListener('input', e => _filterJudgeAffiliations(e.target.value));

    _judgeEditModal = overlay;
    return overlay;
}

function _syncJudgeAffiliationOptions() {
    const modal = _ensureJudgeEditModal();
    const list = modal.querySelector('#edit-judge-affil-list');
    const teams = state.teams || [];
    const signature = teams.map(t => `${t.id}:${t.name}:${t.code || ''}`).join('|');
    if (_judgeEditTeamSignature === signature) return;

    _judgeEditTeamSignature = signature;
    list.innerHTML = '';
    if (!teams.length) {
        list.appendChild(el('div', { style: 'padding:16px;text-align:center;color:#94a3b8;font-size:13px;' }, 'No teams available.'));
        return;
    }

    for (const team of teams) {
        const lbl = document.createElement('label');
        lbl.className = 'judge-edit-affil-row';
        lbl.dataset.search = `${team.name || ''} ${team.code || ''}`.toLowerCase();
        lbl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px;';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'edit-judge-affil';
        chk.value = team.id;
        const spn = document.createElement('span');
        spn.textContent = team.code ? `${team.name} (${team.code})` : team.name;
        lbl.appendChild(chk);
        lbl.appendChild(spn);
        list.appendChild(lbl);
    }
}

function _filterJudgeAffiliations(query) {
    const q = String(query || '').trim().toLowerCase();
    document.querySelectorAll('#edit-judge-affil-list .judge-edit-affil-row').forEach(row => {
        row.style.display = !q || row.dataset.search.includes(q) ? 'flex' : 'none';
    });
}

function _hideJudgeEditModal() {
    if (_judgeEditModal) _judgeEditModal.style.display = 'none';
}

function showEditJudge(judgeId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const judge = (state.judges || []).find(j => String(j.id) === String(judgeId));
    if (!judge) return;
    const card = document.getElementById(`judge-${judgeId}`);
    if (!card) return;

    const teams = state.teams || [];
    const conflictIds = new Set((judge.judge_conflicts || []).map(c => String(c.team_id)));

    const modal = _ensureJudgeEditModal();
    _syncJudgeAffiliationOptions();
    modal.dataset.judgeId = judgeId;
    modal.querySelector('#judge-edit-title').textContent = `Edit Judge - ${judge.name || 'Unnamed'}`;
    modal.querySelector('#edit-judge-name').value = judge.name || '';
    modal.querySelector('#edit-judge-email').value = judge.email || '';
    modal.querySelector('#edit-judge-affil-search').value = '';
    modal.querySelectorAll('.edit-judge-affil').forEach(cb => {
        cb.checked = conflictIds.has(String(cb.value));
        cb.closest('.judge-edit-affil-row').style.display = 'flex';
    });
    modal.style.display = 'flex';
    modal.querySelector('#edit-judge-name').focus();
    return;

    /* eslint-disable no-unreachable */
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
    /* eslint-enable no-unreachable */
}

async function saveEditJudge(judgeId) {
    if (!_isAdmin()) { showNotification('Admin access required', 'error'); return; }
    const modal = _ensureJudgeEditModal();
    const name = modal.querySelector('#edit-judge-name')?.value.trim();
    const email = modal.querySelector('#edit-judge-email')?.value.trim();

    if (!name) { showNotification('Name required', 'error'); return; }

    const affiliations = [...modal.querySelectorAll('.edit-judge-affil:checked')].map(cb => cb.value);

    try {
        await api.updateJudge(judgeId, { name, email, affiliations });
        patchJudge(judgeId, { name, email, judge_conflicts: affiliations.map(id => ({ team_id: id })) });
        _hideJudgeEditModal();
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
