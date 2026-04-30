// ============================================
// PARTICIPANTS.JS – Read-only display
// Teams + Judges tab, purely informational
// All management controls live in Admin Panel
// ============================================

import { state } from './state.js';
import { escapeHTML } from './utils.js';
import { getJudgeCurrentAssignment } from './state.js';

let _activeTab = 'teams';

function _globalSearchValue() {
    return document.getElementById('global-search')?.value.trim().toLowerCase() || '';
}

// ============================================
// ENTRY POINT
// ============================================

export function renderParticipants() {
    const container = document.getElementById('participants');
    if (!container) return;

    const teamCount  = (state.teams  || []).length;
    const judgeCount = (state.judges || []).length;

    container.innerHTML = `
    <div class="par-shell">
        <div class="par-header">
            <h1>Participants</h1>
            <p>Teams and judges registered for this tournament.</p>
        </div>
        <div class="par-tabs">
            <button class="par-tab ${_activeTab === 'teams' ? 'active' : ''}"
                    onclick="window._participantsTab('teams')">
                👥 Teams <span class="par-count">${teamCount}</span>
            </button>
            <button class="par-tab ${_activeTab === 'judges' ? 'active' : ''}"
                    onclick="window._participantsTab('judges')">
                ⚖️ Judges <span class="par-count">${judgeCount}</span>
            </button>
        </div>
        <div id="par-content">
            ${_buildContent(_activeTab)}
        </div>
    </div>`;
}

function _switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.par-tab').forEach(el => {
        el.classList.toggle('active', el.textContent.trim().toLowerCase().startsWith(tab === 'teams' ? '👥' : '⚖️'));
    });
    const content = document.getElementById('par-content');
    if (content) content.innerHTML = _buildContent(tab);
    window.applyGlobalSearch?.();
}

function _buildContent(tab) {
    return tab === 'teams' ? _buildTeams() : _buildJudges();
}

// ============================================
// TEAMS VIEW
// ============================================

function _buildTeams() {
    const teams = [...(state.teams || [])].sort((a, b) => {
        if (b.wins !== a.wins) return (b.wins || 0) - (a.wins || 0);
        return (b.total || 0) - (a.total || 0);
    });

    if (teams.length === 0) return `
        <div class="par-empty">
            <div class="par-empty-icon">👥</div>
            <h3>No Teams Yet</h3>
            <p>Teams will appear here once registered by the admin.</p>
        </div>`;

    const isAdmin  = state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin';
    const myTeamId = state.auth?.currentUser?.teamId;

    return `
    <div class="par-search-row">
        <div class="par-legend">
            <span class="par-dot green"></span><span>Breaking</span>
            <span class="par-dot amber"></span><span>Active</span>
            <span class="par-dot red"></span><span>Eliminated</span>
        </div>
    </div>
    <div id="par-team-grid" class="par-team-grid">
        ${teams.map((t, i) => _teamCard(t, i, myTeamId)).join('')}
    </div>
    ${isAdmin ? `<p class="par-admin-note">⚙️ To edit teams, go to <button class="par-link" onclick="window.switchTab('admin-dashboard');window.adminSwitchSection('teams')">Admin → Manage Teams</button></p>` : ''}`;
}

function _teamCard(t, rank, myTeamId) {
    const isMe = t.id === myTeamId;
    const statusClass = t.broke ? 'breaking' : t.eliminated ? 'eliminated' : 'active';
    const statusLabel = t.broke ? '🏆 Breaking' : t.eliminated ? '❌ Eliminated' : '✅ Active';
    const speakerList = (t.speakers || []).map(s => escapeHTML(s.name)).join(' · ');

    return `
    <div class="par-team-card ${statusClass} ${isMe ? 'mine' : ''}" data-name="${escapeHTML(t.name.toLowerCase())}">
        <div class="par-team-top">
            <div class="par-team-rank">#${rank + 1}</div>
            <div class="par-team-name">
                <strong>${escapeHTML(t.name)}</strong>
                <code class="par-code">${escapeHTML(t.code || '')}</code>
                ${isMe ? '<span class="par-mine-badge">You</span>' : ''}
            </div>
            <span class="par-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="par-team-stats">
            <div class="par-stat"><span class="par-stat-val">${t.wins || 0}</span><span class="par-stat-lbl">Wins</span></div>
            <div class="par-stat"><span class="par-stat-val">${(t.total || 0).toFixed(1)}</span><span class="par-stat-lbl">Points</span></div>
            <div class="par-stat"><span class="par-stat-val">${_avgSpeaker(t)}</span><span class="par-stat-lbl">Avg Spk</span></div>
        </div>
        <div class="par-team-speakers">🎤 ${speakerList || '—'}</div>
    </div>`;
}

function _avgSpeaker(team) {
    const all = team.speakers || [];
    if (all.length === 0) return '—';
    const avgs = all.map(s => {
        const total = (s.substantiveTotal || 0) + (s.replyTotal || 0);
        const count = (s.substantiveCount || 0) + (s.replyCount || 0);
        return count > 0 ? total / count : 0;
    }).filter(v => v > 0);
    if (avgs.length === 0) return '—';
    return (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1);
}

function _parFilterTeams() {
    const q = _globalSearchValue();
    document.querySelectorAll('.par-team-card').forEach(card => {
        card.style.display = (card.getAttribute('data-name') || '').includes(q) ? '' : 'none';
    });
}

// ============================================
// JUDGES VIEW
// ============================================

function _buildJudges() {
    const judges = state.judges || [];
    if (judges.length === 0) return `
        <div class="par-empty">
            <div class="par-empty-icon">⚖️</div>
            <h3>No Judges Yet</h3>
            <p>Judges will appear here once registered by the admin.</p>
        </div>`;

    const chairs   = judges.filter(j => j.role === 'chair');
    const wings    = judges.filter(j => j.role === 'wing');
    const trainees = judges.filter(j => j.role === 'trainee');
    const isAdmin  = state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin';

    return `
    <div class="par-search-row">
        <div class="par-judge-summary">
            <span class="par-jsumm chair">⚖️ ${chairs.length} Chairs</span>
            <span class="par-jsumm wing">🔹 ${wings.length} Wings</span>
            ${trainees.length > 0 ? `<span class="par-jsumm trainee">🔸 ${trainees.length} Trainees</span>` : ''}
        </div>
    </div>
    <div id="par-judge-list" class="par-judge-list">
        ${chairs.length   > 0 ? _judgeGroup('⚖️ Chairs',   chairs,   'chair')   : ''}
        ${wings.length    > 0 ? _judgeGroup('🔹 Wings',    wings,    'wing')    : ''}
        ${trainees.length > 0 ? _judgeGroup('🔸 Trainees', trainees, 'trainee') : ''}
    </div>
    ${isAdmin ? `<p class="par-admin-note">⚙️ To edit judges, go to <button class="par-link" onclick="window.switchTab('admin-dashboard');window.adminSwitchSection('judges')">Admin → Manage Judges</button></p>` : ''}`;
}

function _judgeGroup(title, judges, role) {
    return `
    <div class="par-judge-group">
        <div class="par-judge-group-title">${title}</div>
        <div class="par-judge-cards">
            ${judges.map(j => _judgeCard(j, role)).join('')}
        </div>
    </div>`;
}

function _judgeCard(j, role) {
    let assignmentCount = 0;
    try {
        if (typeof getJudgeCurrentAssignment === 'function') {
            assignmentCount = (getJudgeCurrentAssignment(j.id) || []).length;
        }
    } catch (e) {
        // Assignment lookup is best-effort in the public participant view.
    }

    const conflicts = (j.affiliations || []).map(id => {
        const t = (state.teams || []).find(t => t.id == id);
        return t ? escapeHTML(t.code || t.name) : null;
    }).filter(Boolean);

    const roleColor = { chair: '#10b981', wing: '#3b82f6', trainee: '#f59e0b' };
    const rc = roleColor[role] || '#64748b';

    return `
    <div class="par-judge-card" data-name="${escapeHTML(j.name.toLowerCase())}">
        <div class="par-judge-top">
            <div class="par-judge-avatar" style="background:${rc}20;color:${rc}">
                ${escapeHTML((j.name || '?')[0].toUpperCase())}
            </div>
            <div class="par-judge-info">
                <strong>${escapeHTML(j.name)}</strong>
                <span class="par-role-badge" style="background:${rc}20;color:${rc}">${role.toUpperCase()}</span>
            </div>
            ${assignmentCount > 0 ? `<span class="par-assigned">${assignmentCount} room${assignmentCount !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${conflicts.length > 0 ? `<div class="par-conflicts">⚠️ Conflicts: ${conflicts.join(', ')}</div>` : ''}
    </div>`;
}

function _parFilterJudges() {
    const q = _globalSearchValue();
    document.querySelectorAll('.par-judge-card').forEach(card => {
        card.style.display = (card.getAttribute('data-name') || '').includes(q) ? '' : 'none';
    });
    document.querySelectorAll('.par-judge-group').forEach(group => {
        const visible = [...group.querySelectorAll('.par-judge-card')].some(c => c.style.display !== 'none');
        group.style.display = visible ? '' : 'none';
    });
}

// ============================================
// WINDOW BINDINGS
// ============================================

export function initParticipants() {
    window._participantsTab  = _switchTab;
    window._parFilterTeams   = _parFilterTeams;
    window._parFilterJudges  = _parFilterJudges;
}
