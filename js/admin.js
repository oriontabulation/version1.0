// ============================================
// ADMIN.JS — Admin bypass panel
// Handles edge cases: ballot override, draw override,
//   publish controls, break/knockout, URLs, danger zone.
//   + Tournament management 
// ============================================

import { state, activeTournament, switchTournamentCache, save, saveNow } from './state.js';
import { api } from './api.js';
import { showNotification, escapeHTML, closeAllModals } from './utils.js';
import { displayAdminRounds } from './draw.js';
import { calculateBreak } from './knockout.js';
import { exportData, fullReset } from './file-manager.js';
import { getLocalUsers, registerLocalUser, deleteLocalUser, updateLocalUserRole } from './local-auth.js';

let _activeSection = 'overview';

// ── Mobile nav — direct event-listener wiring ─────────────────────────────────
(function _initMobileNav() {

    // ── Auth sync: mirrors the header's login/logout state to the drawer footer ──

    function syncDrawerAuth() {
        var hLogout = document.getElementById('header-logout-btn');
        var hName   = document.getElementById('header-user-name');
        var dLogin  = document.getElementById('drawer-login-btn');
        var dLogout = document.getElementById('drawer-logout-btn');
        var dName   = document.getElementById('drawer-user-name');
  
        if (!dLogin || !dLogout) return;

        // Logout button visible in header = user is logged in
        var loggedIn = hLogout && hLogout.style.display !== 'none';

        if (dName)   dName.textContent    = (loggedIn && hName) ? hName.textContent : 'Guest';
        dLogin.style.display  = loggedIn ? 'none' : '';
        dLogout.style.display = loggedIn ? '' : 'none';

        
    }

    function wire() {
        var hamburger = document.getElementById('mobile-hamburger');
        var drawer    = document.getElementById('mobile-nav-drawer');
        var overlay   = document.getElementById('mobile-nav-overlay');
        var closeBtn  = document.getElementById('mobile-nav-close');

        function openNav() {
            if (drawer)  drawer.classList.add('is-open');
            if (overlay) overlay.classList.add('is-open');
            document.body.classList.add('mobile-nav-open');
            syncDrawerAuth(); // always sync state when drawer opens
        }
        function closeNav() {
            if (drawer)  drawer.classList.remove('is-open');
            if (overlay) overlay.classList.remove('is-open');
            document.body.classList.remove('mobile-nav-open');
        }

        if (hamburger) hamburger.addEventListener('click', openNav);
        if (closeBtn)  closeBtn.addEventListener('click', closeNav);
        if (overlay)   overlay.addEventListener('click', closeNav);
        if (drawer) {
            drawer.querySelectorAll('[data-tab]').forEach(function(btn) {
                btn.addEventListener('click', closeNav);
            });
        }

        // Auto-close drawer when the user scrolls the page
        // (ignore scroll events that originate inside the drawer itself)
        window.addEventListener('scroll', function() {
            if (drawer && drawer.classList.contains('is-open')) {
                closeNav();
            }
        }, { passive: true });

        // Also close on any touch-move outside the drawer (swipe-away)
        document.addEventListener('touchmove', function(e) {
            if (drawer && drawer.classList.contains('is-open') && !drawer.contains(e.target)) {
                closeNav();
            }
        }, { passive: true });

        // Watch header-controls for auth changes so the drawer stays in sync
        var headerControls = document.getElementById('header-controls');
        if (headerControls && window.MutationObserver) {
            new MutationObserver(syncDrawerAuth).observe(headerControls, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['style']
            });
        }

        syncDrawerAuth(); // initial sync on load
        window.openMobileNav  = openNav;
        window.closeMobileNav = closeNav;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire(); // DOM already parsed — wire immediately
    }
}());

// ============================================================================
// ENTRY POINT
// ============================================================================
export function renderAdminDashboard() {
    // Guarantee all window.adminXxx bindings exist before any HTML is injected.
    // initAdminDashboard() is only pure window assignments — safe to call multiple times.
    initAdminDashboard();

    const container = document.getElementById('admin-dashboard');
    if (!container) return;

    const isAdmin = state.auth?.currentUser?.role === 'admin';
    if (!isAdmin) {
        container.innerHTML = `
            <div class="adm-denied">
                <div class="adm-denied-icon">🔒</div>
                <h2>Access Denied</h2><p>Log in as admin to access this panel.</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="adm-shell">
            ${_buildTopBar()}
            <div class="adm-layout">
                ${_buildSidebar()}
                <div class="adm-body" id="adm-body">${_buildSection(_activeSection)}</div>
            </div>
        </div>`;

    if (_activeSection === 'rounds') _refreshAdminRounds();
}

// Lightweight refresh — no full section rebuild
function _refreshAdminRounds() {
    _fillRoundsSidebar();
    try { displayAdminRounds(); } catch(e) { window.displayAdminRounds?.(); }
    const rounds  = state.rounds || [];
    const entered = rounds.flatMap(r => r.debates || []).filter(d => d.entered).length;
    const total   = rounds.flatMap(r => r.debates || []).length;
    const badge   = document.getElementById('adm-draw-count');
    if (badge) badge.textContent = `${entered}/${total} results`;
}

// Render the sticky left column into #adm-rounds-sidebar
function _fillRoundsSidebar() {
    const el = document.getElementById('adm-rounds-sidebar');
    if (!el) return;
    const rounds = state.rounds || [];

    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const sp = savedPrefs['adm-pair-method'] || 'random';
    const ss = savedPrefs['adm-side-method'] || 'random';

    const pairOpts = [['random','🎲 Random'],['power','⚡ Power Pairing'],['fold','📊 Fold Pairing'],['roundrobin','🔄 Round Robin'],['knockout','🏆 Outrounds Draw']]
        .map(([v,l]) => `<option value="${v}" ${sp===v?'selected':''}>${l}</option>`).join('');
    const sideOpts = [['random','🎲 Random'],['manual','✋ Manual'],['seed-high-gov','🔼 High Seed = Gov'],['seed-low-gov','🔽 Low Seed = Gov']]
        .map(([v,l]) => `<option value="${v}" ${ss===v?'selected':''}>${l}</option>`).join('');

    const ctrlCards = rounds.map((r, idx) => {
        const done = (r.debates||[]).filter(d=>d.entered).length;
        const tot  = (r.debates||[]).length;
        const pct  = tot > 0 ? Math.round(done/tot*100) : 0;
        return `<div class="adm-round-ctrl">
            <div class="adm-round-ctrl-head">
                <div class="adm-row">
                    <strong class="adm-round-ctrl-title">Round ${r.id}</strong>
                    ${r.type==='knockout'?'<span class="adm-badge red">KO</span>':''}
                    ${r.blinded?'<span class="adm-badge grey">Blind</span>':''}
                </div>
                <span class="adm-round-ctrl-pct">${pct}%</span>
            </div>
            <div class="adm-round-ctrl-progress"><div class="adm-round-ctrl-fill" style="width:${pct}%"></div></div>
            <div class="adm-round-ctrl-motion">${r.motion?escapeHTML(r.motion.substring(0,45)):'No motion set'}</div>
            <div class="adm-row gap-sm">
                ${r.type!=='knockout'?`<button class="adm-btn secondary xs" onclick="window.toggleBlindRound(${idx});window.refreshAdminRounds()">${r.blinded?'\u{1F441} Unblind':'\u{1F512} Blind'}</button>`:''}
                <button onclick="window.redrawRound(${idx});window.refreshAdminRounds()"
                        ${done>0?'disabled title="Cannot redraw — results already entered"':'title="Shuffle pairings for this round"'}
                        style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;font-size:12px;font-weight:700;border-radius:6px;border:none;cursor:${done>0?'not-allowed':'pointer'};background:${done>0?'#e2e8f0':'#f59e0b'};color:${done>0?'#94a3b8':'white'};opacity:${done>0?'0.55':'1'};box-shadow:${done>0?'none':'0 2px 5px rgba(245,158,11,0.35)'};">
                    🔀 Redraw
                </button>
                <button class="adm-btn danger xs" onclick="window.adminDeleteRound(${r.id})">🗑</button>
            </div>
        </div>`;
    }).join('');

    el.innerHTML = `
        <div class="adm-card adm-card--no-mb">
            <div class="adm-card-title">➕ Create Round</div>
            <div class="adm-form-stack">
                <div class="adm-field">
                    <label class="adm-label">Motion / Topic</label>
                    <input type="text" id="adm-motion" class="adm-input" placeholder="e.g. This House Would…"
                           onkeydown="if(event.key==='Enter') window.adminCreateRound()">
                </div>
                <div class="adm-field">
                    <label class="adm-label">Pairing Method</label>
                    <select id="adm-pair-method" class="adm-select" onchange="window._admSaveDrawPref('adm-pair-method',this.value)">${pairOpts}</select>
                </div>
                <div class="adm-field">
                    <label class="adm-label">Side Assignment</label>
                    <select id="adm-side-method" class="adm-select" onchange="window._admSaveDrawPref('adm-side-method',this.value)">${sideOpts}</select>
                </div>
                <div class="adm-field">
                    <label class="adm-label">Options</label>
                    <div class="adm-checks">
                        <label class="adm-check"><input type="checkbox" id="adm-auto-allocate" checked> Auto-allocate Judges</label>
                        <label class="adm-check"><input type="checkbox" id="adm-blind-round"> 🔒 Blind Round</label>
                    </div>
                </div>
                <button class="adm-btn accent full" onclick="window.adminCreateRound()">🎯 Create Round</button>
            </div>
        </div>
        ${rounds.length > 0 ? `<div class="adm-card adm-card--mt adm-card--no-mb">
            <div class="adm-card-title">⚙️ Round Controls</div>
            <div class="adm-col adm-col--sm">${ctrlCards}</div>
        </div>` : ''}`;
}

function _buildTopBar() {
    const user = state.auth.currentUser;
    const tour = activeTournament();
    const initial = (user.name || 'A')[0].toUpperCase();
    return `
    <div class="adm-topbar">
        <div class="header-container">
            <button class="adm-hamburger" id="adm-hamburger" onclick="window.toggleAdmSidebar()" aria-label="Toggle navigation">
                <span></span><span></span><span></span>
            </button>
            <div class="header-logo" onclick="window.navigate('public')" title="Back to main site">
                <img src="IMG/logo.png" alt="Orion logo" class="logo-image">
                <span class="header-logo-text">ORION</span>
            </div>
            <div class="adm-topbar-center">
                <span class="adm-topbar-tournament" title="${escapeHTML(tour?.name || '')}">${escapeHTML(tour?.name || 'No Tournament')}</span>
                <span class="adm-topbar-tag">Admin</span>
            </div>
            <div class="header-controls">
                <div id="theme-picker-container"></div>
                <button class="adm-pill" onclick="window.adminSwitchSection('tournaments')">Switch</button>
                <div class="header-user" onclick="window.adminSwitchSection('users')" title="Manage users">
                    <div class="adm-avatar" style="width:22px;height:22px;font-size:11px;flex-shrink:0;">${escapeHTML(initial)}</div>
                    <span id="adm-topbar-username">${escapeHTML(user.name || 'Admin')}</span>
                </div>
                <button class="adm-pill" onclick="window.logout()">Logout</button>
            </div>
        </div>
    </div>`;
}

function _buildStatStrip() {
    const s = _getStats();
    return `
    <div class="adm-stat-strip">
        ${_chip('👥', s.teams.total,     'Teams',   s.teams.breaking  + ' breaking',  'blue')}
        ${_chip('⚖️', s.judges.total,   'Judges',  s.judges.chair    + ' chairs',    'green')}
        ${_chip('🎯', s.rounds.total,    'Rounds',  s.rounds.completed + ' complete', 'amber')}
        ${_chip('🗳️', s.debates.entered, 'Ballots', s.debates.total   + ' rooms',    'purple')}
    </div>`;
}

function _chip(icon, val, label, sub, color) {
    return `<div class="adm-chip adm-chip--${color}">
        <div class="adm-chip-icon">${icon}</div>
        <div class="adm-chip-val">${val}</div>
        <div class="adm-chip-label">${label}</div>
        <div class="adm-chip-sub">${sub}</div>
    </div>`;
}

const _SECTIONS = [
    { id:'tournaments', icon:'🏟️', label:'Tournaments'      },
    { id:'overview',    icon:'📊', label:'Overview'          },
    { id:'rounds',      icon:'🎲', label:'Rounds & Draw'     },
    { id:'ballots',     icon:'🗳️', label:'Ballot Override'   },
    { id:'break',       icon:'🏆', label:'Break & Outrounds'  },
    { id:'publish',     icon:'📡', label:'Publish Controls'  },
    { id:'feedback',    icon:'💬', label:'Feedback'          },
    { id:'urls',        icon:'🔗', label:'URLs & Access'     },
    { id:'data',        icon:'💾', label:'Data & Export'     },
    { id:'users',       icon:'👥', label:'Local Users'       },
    { id:'sample',      icon:'🚀', label:'Test Data'         },
    { id:'danger',      icon:'⚠️', label:'Danger Zone'       },
];

function _buildSidebar() {
    const user    = state.auth?.currentUser;
    const initial = (user?.name || 'A')[0].toUpperCase();
    const name    = escapeHTML(user?.name || 'Admin');

    return `
    <div class="adm-sidebar-overlay" id="adm-sidebar-overlay" onclick="window.closeAdmSidebar()"></div>
    <nav class="adm-sidebar" id="adm-sidebar">

        <!-- Close button — visible only when sidebar is a mobile drawer -->
        <div class="adm-sidebar-head">
            <div style="display:flex;align-items:center;gap:8px;">
                <img src="IMG/logo.png" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover;object-position:center;">
                <span style="font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--text-muted,#64748b)">ORION</span>
            </div>
            <button class="adm-sidebar-close-btn" onclick="window.closeAdmSidebar()" aria-label="Close navigation">✕</button>
        </div>

        <!-- Nav items -->
        ${_SECTIONS.map(s => `
            <button class="adm-nav-item ${_activeSection===s.id?'active':''}"
                    data-section="${s.id}"
                    onclick="window.adminSwitchSection('${s.id}')">
                <span class="adm-nav-icon">${s.icon}</span>
                <span class="adm-nav-label">${s.label}</span>
            </button>`).join('')}

        <!-- User footer — visible only when sidebar is a mobile drawer -->
        <div class="adm-sidebar-foot">
            <div class="adm-sidebar-foot-user">
                <div class="adm-avatar adm-avatar--sm">${initial}</div>
                <div>
                    <div class="adm-sidebar-foot-name">${name}</div>
                    <div class="adm-sidebar-foot-role">Admin</div>
                </div>
            </div>
            <button class="adm-btn danger xs" style="width:100%"
                    onclick="window.logout?.();window.closeAdmSidebar();">
                Logout
            </button>
        </div>

    </nav>`;
}

export function adminSwitchSection(id) {
    _activeSection = id;
    const body = document.getElementById('adm-body');
    if (body) body.innerHTML = _buildSection(id);
    document.querySelectorAll('.adm-nav-item').forEach(el =>
        el.classList.toggle('active', el.getAttribute('data-section') === id));
    if (id === 'rounds') _refreshAdminRounds();
    // Also refresh topbar tournament badge
    const topbar = document.querySelector('.adm-topbar');
    if (topbar) topbar.outerHTML = _buildTopBar();
    // Close drawer on mobile after navigation
    window.closeAdmSidebar?.();
}

function _buildSection(id) {
    switch(id) {
        case 'tournaments': return _sectionTournaments();
        case 'feedback':    return _sectionFeedback();
        case 'overview':    return _sectionOverview();
        case 'rounds':      return _sectionRounds();
        case 'ballots':     return _sectionBallots();
        case 'break':       return _sectionBreak();
        case 'publish':     return _sectionPublish();
        case 'urls':        return _sectionURLs();
        case 'data':        return _sectionData();
        case 'users':      return _sectionUsers();
        case 'sample':      return _sectionSample();
        case 'danger':      return _sectionDanger();
        default:            return _sectionOverview();
    }
}

// Simple Feedback Section for Admin Dashboard
function _sectionFeedback() {
    const tid = state.activeTournamentId;
    // Lazy-load feedback data for the active tournament
    const feedbackList = state.feedback?.length ? state.feedback : [];
    // Basic render with a placeholder; real list will render after api.getFeedback is invoked elsewhere
    return `
    <div class="adm-section-head">
        <h2>💬 Feedback</h2>
        <p>Overview of feedback captured for this tournament (judges and teams).</p>
    </div>
    <div class="adm-card adm-card--flush">
        <div class="adm-card-body" style="min-height:120px; display:flex; align-items:center; justify-content:center; color:#64748b;">
            No feedback loaded yet. Use the Feedback tab in Draw/Judges or submit new feedback from the portal.
        </div>
    </div>`;
}

// ============================================================================
// SECTION: TOURNAMENTS  
// ============================================================================
function _sectionTournaments() {
    // state.tournaments is keyed by ID, so use Object.entries to get id + data
    const tournaments = Object.entries(state.tournaments || {}).map(([id, t]) => ({ ...t, id }));
    const activeId    = state.activeTournamentId;

    return `
    <div class="adm-section-head">
        <h2>🏟️ Tournament Manager</h2>
        <p>Create and manage multiple tournaments. Switch between them to see different data sets.</p>
    </div>

    <!-- Create new tournament -->
    <div class="adm-card">
        <div class="adm-card-title">➕ Create New Tournament</div>
        <div class="adm-row end">
            <div class="adm-grow-2">
                <label class="adm-label">Tournament Name</label>
                <input type="text" id="new-tournament-name" class="adm-input"
                       placeholder="e.g. WSDC 2026, BP Open"
                       onkeydown="if(event.key==='Enter') window.adminCreateTournament()">
            </div>
            <div class="adm-grow">
                <label class="adm-label">Format</label>
                <select id="new-tournament-format" class="adm-select">
                    <option value="standard">World Schools (WSDC)</option>
                    <option value="bp">British Parliamentary (BP)</option>
                    <option value="speech">Speech Tournament</option>
                </select>
            </div>
            <div class="adm-row gap-sm">
                <button class="adm-btn primary" onclick="window.adminCreateTournament()">Create &amp; Switch</button>
            </div>
        </div>
    </div>

    <!-- Tournament list -->
    <div class="adm-card">
        <div class="adm-card-title">📋 All Tournaments <span class="adm-card-count">${tournaments.length}</span></div>
        ${tournaments.length === 0 ? `<div class="adm-empty">No tournaments yet.</div>` : `
        <div class="adm-col">
            ${tournaments.map((t) => {
                const isActive = t.id === activeId;
                const teamCount   = (t.teams   || []).length;
                const judgeCount  = (t.judges  || []).length;
                const roundCount  = (t.rounds  || []).length;
                const ballotsDone = (t.rounds  || []).flatMap(r => r.debates||[]).filter(d => d.entered).length;

                return `
                <div class="adm-tour-row ${isActive ? 'is-active' : ''}" style="padding:16px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
                    <div class="adm-grow">
                        <div class="adm-tour-header">
                            <strong style="font-size:16px;color:${isActive?'#4f46e5':'#1e293b'}">${escapeHTML(t.name)}</strong>
                            ${isActive ? `<span class="adm-badge indigo" style="margin-left:8px;">● ACTIVE</span>` : ''}
                        </div>
                        <div class="adm-tour-meta" style="font-size:12px;color:#64748b;margin-top:4px;display:flex;gap:12px;">
                            <span class="adm-format-badge std" style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-weight:700;text-transform:uppercase;font-size:10px;">${t.format || 'std'}</span>
                            <span>👥 ${teamCount} Teams</span>
                            <span>⚖️ ${judgeCount} Judges</span>
                            <span>🎲 ${roundCount} Rounds</span>
                            <span>🗳️ ${ballotsDone} Ballots</span>
                        </div>
                    </div>
                    <div class="adm-row gap-sm">
                        ${!isActive ? `
                            <button class="adm-btn primary xs" onclick="window.adminSwitchTournament('${t.id}')">🎯 Switch</button>
                        ` : ''}
                        <button class="adm-btn secondary xs" onclick="window.adminRenameTournament('${t.id}', '${escapeHTML(t.name).replace(/'/g,"\\'")}')">✏️ Rename</button>
                        <button class="adm-btn danger xs" onclick="window.adminDeleteTournament('${t.id}')" ${isActive && tournaments.length > 1 ? 'disabled' : ''}>🗑️</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`}
    </div>`;
}

async function adminSwitchTournament(id) {
    if (!confirm('Switch to this tournament?')) return;
    showNotification('Loading tournament data...', 'info');
    try {
        const [teams, judges, rounds] = await Promise.all([
            api.getTeams(id),
            api.getJudges(id),
            api.getRounds(id),
        ]);
        const publish = await api.getPublishState(id).catch(() => ({}));

        // Hot-swap state without a page reload (preserves login session)
        localStorage.setItem('orion_active_tournament_id', id);
        // Update the active tournament in-memory (ensure container exists)
        const s = state;
        if (!s.tournaments) s.tournaments = {};
        if (!s.tournaments[id]) {
            s.tournaments[id] = { name: '', format: 'standard', teams: [], judges: [], rounds: [], publish: {} };
        }
        s.tournaments[id].teams   = teams;
        s.tournaments[id].judges  = judges;
        s.tournaments[id].rounds  = rounds;
        s.tournaments[id].publish = publish;
        s.activeTournamentId = id;

        // Debugging logs to help diagnose issues when switching tournaments
        console.debug('[admin] switched tournament', id, {
          teams: teams?.length ?? 0,
          judges: judges?.length ?? 0,
          rounds: rounds?.length ?? 0,
          publish: publish
        });

        // Refresh the admin dashboard
        renderAdminDashboard();
        showNotification('Tournament switched!', 'success');
    } catch (err) {
        showNotification(`Switch failed: ${err.message}`, 'error');
    }
}
window.adminSwitchTournament = adminSwitchTournament;

async function adminRenameTournament(id, currentName) {
    const newName = prompt('Rename tournament:', currentName);
    if (!newName?.trim()) return;
    try {
        const updated = await api.updateTournament(id, { name: newName.trim() });
        if (state.tournaments?.[id]) state.tournaments[id].name = updated.name;
        adminSwitchSection('tournaments');
        showNotification('Tournament renamed', 'success');
    } catch (err) {
        showNotification(`Rename failed: ${err.message}`, 'error');
    }
}
window.adminRenameTournament = adminRenameTournament;

async function adminDeleteTournament(id) {
    if (!confirm('Delete this tournament? This cannot be undone.')) return;
    try {
        await api.deleteTournament(id);
        delete state.tournaments[id];
        const remaining = Object.values(state.tournaments || {});
        if (remaining.length > 0) {
            await adminSwitchTournament(remaining[0].id);
        } else {
            adminSwitchSection('tournaments');
        }
        showNotification('Tournament deleted', 'success');
    } catch (err) {
        showNotification(`Delete failed: ${err.message}`, 'error');
    }
}
window.adminDeleteTournament = adminDeleteTournament;

// Helper to get team name by ID
function _getTeamName(teamId) {
    if (!teamId) return 'TBD';
    const team = (state.teams || []).find(t => String(t.id) === String(teamId));
    return team?.name || 'Unknown';
}

// ============================================================================
// SECTION: OVERVIEW
// ============================================================================
function _sectionOverview() {
    const s = _getStats();
    const rounds = state.rounds || [];
    const currentRound = rounds.filter(r => r.debates?.length > 0).pop();
    
    let roomBallotsHtml = '';
    if (!currentRound) {
        roomBallotsHtml = `<div class="adm-empty">No rounds yet — go to Rounds &amp; Draw to create one.</div>`;
    } else {
        const debates = currentRound.debates || [];
        const rooms = currentRound.rooms || [];
        
        const submitted = debates.filter(d => d.entered).length;
        const pending = debates.length - submitted;
        
        let rows = debates.map((d, i) => {
            const roomName = rooms[i] || `Room ${i + 1}`;
            const isEntered = d.entered;
            const govTeam = _getTeamName(d.gov);
            const oppTeam = _getTeamName(d.opp);
            
            return `<div class="adm-room-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <div style="flex:1;">
                    <strong style="color:#1e293b;">${escapeHTML(roomName)}</strong>
                    <div style="font-size:12px;color:#64748b;">${escapeHTML(govTeam)} vs ${escapeHTML(oppTeam)}</div>
                </div>
                <span class="${isEntered ? 'adm-badge green' : 'adm-badge amber'}">${isEntered ? '✅ Submitted' : '⏳ Pending'}</span>
            </div>`;
        }).join('');
        
        roomBallotsHtml = `
            <div style="margin-bottom:12px;font-size:13px;color:#64748b;">
                <strong>Round ${currentRound.id}</strong> — ${submitted} submitted, ${pending} pending
            </div>
            ${rows}
            <div class="adm-card-action">
                <button class="adm-btn secondary sm" onclick="window.adminSwitchSection('rounds')">Manage ballots →</button>
            </div>`;
    }

    return `
    <div class="adm-section-head">
        <h2>📊 Tournament Overview</h2>
        <p>This section outlines the tournament details including format, teams, rounds and ballot progression, giving you a clear understanding of the tournament.
         <strong>${escapeHTML(activeTournament()?.name || 'current tournament')}</strong>.</p>
    </div>
    <!-- Key stats     -->
    <script>setTimeout(()=>{ if(typeof window.renderThemePicker==='function') window.renderThemePicker('theme-picker-container'); },50)</script>
    <div class="adm-overview-grid">
        <div class="adm-card">
            <div class="adm-card-title">⚡ Quick Access</div>
            <div class="adm-quick-grid">
                <button class="adm-quick" onclick="window.switchTab('standings')">
                    <span class="adm-quick-icon">📊</span>
                    <span class="adm-quick-label">Standings</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('draw')">
                    <span class="adm-quick-icon">🎲</span>
                    <span class="adm-quick-label">Draw</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('teams')">
                    <span class="adm-quick-icon">👥</span>
                    <span class="adm-quick-label">Teams</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('judges')">
                    <span class="adm-quick-icon">⚖️</span>
                    <span class="adm-quick-label">Judges</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('speakers')">
                    <span class="adm-quick-icon">🎤</span>
                    <span class="adm-quick-label">Speakers</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('knockout')">
                    <span class="adm-quick-icon">⚔️</span>
                    <span class="adm-quick-label">Outrounds</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('results')">
                    <span class="adm-quick-icon">✅</span>
                    <span class="adm-quick-label">Results</span>
                </button>
                <button class="adm-quick" onclick="window.switchTab('feedback')">
                    <span class="adm-quick-icon">💬</span>
                    <span class="adm-quick-label">Feedback</span>
                </button>
            </div>
        </div>
        <div class="adm-card">
            <div class="adm-card-title">📈 Progress</div>
            ${_progressBar('Ballot Completion', s.debates.entered, s.debates.total, '#f97316')}
            ${_progressBar('Rounds Completed',  s.rounds.completed, Math.max(s.rounds.total,1), '#3b82f6')}            
            ${_progressBar('Teams Breaking',    s.teams.breaking, Math.max(s.teams.total,1), '#8b5cf6')}
        </div>
        <div class="adm-card">
            <div class="adm-card-title">🚪 Ballot Submission per Room</div>
            ${roomBallotsHtml}
        </div>
    </div>`;
}

// ============================================================================
// SECTION: ROUNDS & DRAW — side-by-side layout
// ============================================================================
function _sectionRounds() {
    return `
    <div class="adm-section-head">
        <h2>🎲 Rounds &amp; Draw</h2>
        <p>Create rounds on the left, manage pairings on the right. For full judge drag-and-drop use the
           <button class="adm-btn secondary xs" onclick="window.switchTab('draw')">Draw tab →</button></p>
    </div>
    <div class="adm-rounds-split">
        <div class="adm-rounds-create-col" id="adm-rounds-sidebar">
            <div class="adm-empty">Loading…</div>
        </div>
        <div class="adm-rounds-live-col">
            <div class="adm-card adm-card--flush adm-card--no-mb">
                <div class="adm-card-header adm-row between">
                    <span class="adm-card-title adm-card-title--inline">
                        📋 Live Draw
                        <span class="adm-card-title-sub" id="adm-draw-count"></span>
                    </span>
                    <div class="adm-row gap-sm">
                        <select id="round-filter" onchange="window.displayAdminRounds()" class="adm-select adm-select--sm">
                            <option value="all">All Rounds</option>
                            <option value="pending">Pending</option>
                            <option value="completed">Submitted</option>
                            <option value="blinded">Blinded</option>
                        </select>
                        <button class="adm-btn secondary sm" onclick="window.refreshAdminRounds()">↺</button>
                    </div>
                </div>
                <div id="rounds-list" class="adm-rounds-list-body">
                    <div class="adm-empty">Loading…</div>
                </div>
            </div>
        </div>
    </div>`;
}

// ============================================================================
// SECTION: BALLOT OVERRIDE
// ============================================================================
function _sectionBallots() {
    const allRounds = state.rounds || [];
    const rounds = [...allRounds].reverse();
    return ` <div class="adm-section-head">
        <h2>🗳️ Ballot Override</h2>
        <p>Enter or override ballot results for any room. Normally judges submit via their portal link — use this as a bypass when needed.</p>
    </div>
    ${rounds.length === 0
        ? `<div class="adm-card"><div class="adm-empty">No rounds yet.</div></div>`
        : rounds.map(r => {
            const rIdx  = allRounds.indexOf(r);
            const done  = (r.debates||[]).filter(d=>d.entered).length;
            const total = (r.debates||[]).length;
            const pct   = total > 0 ? Math.round(done/total*100) : 0;
            return `
            <div class="adm-card">
                <div class="adm-ballot-header">
                    <div class="adm-row gap-sm">
                        <span class="adm-strong">Round ${r.id}</span>
                        ${r.type==='knockout'?'<span class="adm-badge red">KO</span>':''}
                        ${r.blinded?'<span class="adm-badge grey">Blind</span>':''}
                    </div>
                    <div class="adm-prog-row">
                        <div class="adm-bar-bg adm-bar-bg--fixed"><div class="adm-bar-fill" style="width:${pct}%"></div></div>
                        <span class="adm-pct">${done}/${total}</span>
                    </div>
                </div>
                <div class="adm-room-grid">
                ${(r.debates||[]).map((d,i) => {
                    const gov  = (state.teams||[]).find(t=>t.id===d.gov);
                    const opp  = (state.teams||[]).find(t=>t.id===d.opp);
                    const room = r.rooms?.[i] || `Room ${String.fromCharCode(65+i)}`;
                    const jnames = (d.panel||[]).map(p=>escapeHTML(p.name||'')).join(', ');
                    return `
                    <div class="adm-room-card ${d.entered?'done':''}">
                        <div class="adm-room-top">
                            <span class="adm-room-dot ${d.entered?'green':'amber'}"></span>
                            <strong>${escapeHTML(room)}</strong>
                            <span class="adm-room-status">${d.entered?'✓ Done':'⏳ Pending'}</span>
                        </div>
                        <div class="adm-room-teams">${gov?escapeHTML(gov.name):'?'} <em>vs</em> ${opp?escapeHTML(opp.name):'?'}</div>
                        ${jnames?`<div class="adm-room-judges">⚖️ ${jnames}</div>`:''}
                        ${d.entered?`<div class="adm-room-scores">${d.govResults?.total?.toFixed(1)||'?'} — ${d.oppResults?.total?.toFixed(1)||'?'}</div>`:''}
                        <button onclick="window.showEnterResults(${rIdx},${i})"
                                class="adm-ballot-btn ${d.entered?'done':'pending'}">
                            ${d.entered ? '✏️ Override Results' : '📝 Enter Results'}
                        </button>
                    </div>`;
                }).join('')}
                </div>
            </div>`;
        }).join('')}`;
}

// ============================================================================
// SECTION: BREAK & KNOCKOUT
// ============================================================================
function _sectionBreak() {
    const isBP = (activeTournament()?.format === 'bp');
    const winsLabel = isBP ? '1st/2nd' : 'Wins';

    // Category filter
    const allCats    = (typeof window.getCategories === 'function') ? window.getCategories() : [];
    const selectedCat = window._brkSelectedCat || '';

    const allTeams   = [...(state.teams||[])].filter(t => {
        if (!selectedCat) return true;
        return (typeof window.teamMatchesCategory === 'function')
            ? window.teamMatchesCategory(t, selectedCat)
            : (t.categories||[]).includes(selectedCat);
    }).sort((a,b)=>((b.wins||0)-(a.wins||0))||((b.total||0)-(a.total||0)));
    const breaking   = allTeams.filter(t=>_isCatBroke(t, selectedCat)).sort((a,b)=>(_catSeed(a,selectedCat)||99)-(_catSeed(b,selectedCat)||99));
    const ineligible = allTeams.filter(t=>_isCatIneligible(t, selectedCat));
    const totalRounds = (state.rounds||[]).filter(r=>r&&r.type==='prelim').length;
    const blindedCount = (state.rounds||[]).filter(r=>r.blinded&&r.type==='prelim').length;

    const catSelectorHtml = allCats.length === 0 ? '' : `
        <div class="adm-break-controls-stat" style="flex-direction:column;align-items:flex-start;min-width:140px;">
            <label class="adm-label adm-label--light" style="font-size:10px;margin-bottom:3px;">Category</label>
            <select class="adm-select adm-select--dark" onchange="window._brkSelectedCat=this.value;window.adminSwitchSection('break')">
                <option value="" ${!selectedCat?'selected':''}>All Teams</option>
                ${allCats.map(c=>`<option value="${c.id}" ${selectedCat===c.id?'selected':''}>${c.icon||''} ${escapeHTML(c.name)}</option>`).join('')}
            </select>
        </div>
        <div class="adm-break-controls-divider"></div>`;

    const teamRows = allTeams.map(t => {
        const rp     = Object.keys(t.roundScores||{}).length;
        const avg    = rp > 0 ? ((t.total||0)/rp).toFixed(1) : '—';
        const missed = totalRounds - rp;
        const inelig = _isCatIneligible(t, selectedCat);
        const broke  = _isCatBroke(t, selectedCat);
        const seed   = _catSeed(t, selectedCat);
        const reason = _catIneligReason(t, selectedCat);
        const rowClass = inelig ? 'adm-row--inelig' : (broke ? 'adm-row--breaking' : '');
        return `<tr class="${rowClass}" id="inelig-row-${t.id}">
            <td>
                <label class="adm-center-label">
                    <input type="checkbox" ${inelig?'checked':''}
                           onchange="window.adminToggleIneligible('${t.id}', this.checked)"
                           class="adm-inelig-checkbox">
                </label>
            </td>
            <td>
                <div class="adm-row gap-sm">
                    <strong>${escapeHTML(t.name)}</strong>
                    ${broke ? `<span class="adm-badge green">Seed ${seed}</span>` : ''}
                    ${missed > 0 ? `<span class="adm-badge amber">⚠️ ${missed} missed</span>` : ''}
                    ${(t.categories||[]).map(cid=>{const cat=allCats.find(c=>c.id===cid);return cat?`<span class="adm-badge" style="background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}44">${cat.icon||''} ${escapeHTML(cat.name)}</span>`:''}).join('')}
                </div>
            </td>
            <td><code class="adm-code">${escapeHTML(t.code||'')} </code></td>
            <td class="adm-td-wins">${t.wins||0}</td>
            <td>${(t.total||0).toFixed(1)}</td>
            <td class="adm-td-avg">${avg}</td>
            <td id="inelig-reason-cell-${t.id}">
                ${inelig
                    ? `<input type="text" value="${escapeHTML(reason)}"
                              placeholder="Reason (optional)…"
                              onchange="window.adminSetIneligibleReason('${t.id}', this.value)"
                              class="adm-inelig-input">`
                    : `<span class="adm-muted-sm">—</span>`}
            </td>
        </tr>`;
    }).join('');

    const breakingTable = breaking.length === 0
        ? `<div class="adm-empty">No teams confirmed yet — preview and confirm above.</div>`
        : `<div class="adm-table-wrap"><table class="adm-table">
            <thead><tr><th>Seed</th><th>Team</th><th>Code</th><th>${winsLabel}</th><th>Points</th><th>Avg</th></tr></thead>
            <tbody>${breaking.map(t => {
                const rp = Object.keys(t.roundScores||{}).length;
                return `<tr>
                    <td><span class="adm-badge green">${_catSeed(t, selectedCat)}</span></td>
                    <td><strong>${escapeHTML(t.name)}</strong></td>
                    <td><code class="adm-code">${escapeHTML(t.code||'')} </code></td>
                    <td class="adm-td-wins">${t.wins||0}</td>
                    <td>${(t.total||0).toFixed(1)}</td>
                    <td class="adm-td-avg">${rp>0?((t.total||0)/rp).toFixed(1):'—'}</td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`;

    const ineligCount = ineligible.length;
    const catLabel = selectedCat
        ? (allCats.find(c=>c.id===selectedCat)?.name || selectedCat)
        : 'All Teams';

    return `
    <div class="adm-section-head">
        <h2>🏆 Break &amp; Outrounds</h2>
        <p>Generate Breaks, preview and confirm the break. You can toggle eligibility manually to include/exclude teams as needed.
        ${blindedCount>0?`<span class="adm-blinded-badge">⚠️ ${blindedCount} round${blindedCount!==1?'s':''} blinded</span>`:''}
        </p>
    </div>

    <!-- STICKY CONTROL BAR -->
    <div class="adm-break-controls-bar">
        ${catSelectorHtml}
        <div class="adm-break-controls-stat">
            <div class="adm-break-controls-stat-val">${allTeams.length}</div>
            <div class="adm-break-controls-stat-lbl">${escapeHTML(catLabel)}</div>
        </div>
        ${ineligCount > 0 ? `
        <div class="adm-break-controls-stat">
            <div class="adm-break-controls-stat-val adm-break-controls-stat-val--danger">${ineligCount}</div>
            <div class="adm-break-controls-stat-lbl">Ineligible</div>
        </div>` : ''}
        ${breaking.length > 0 ? `
        <div class="adm-break-controls-stat">
            <div class="adm-break-controls-stat-val adm-break-controls-stat-val--success">${breaking.length}</div>
            <div class="adm-break-controls-stat-lbl">Breaking</div>
        </div>` : ''}
        <div class="adm-break-controls-divider"></div>
        <div class="adm-break-size-col">
            <label class="adm-label adm-label--light">Break Size</label>
            <select id="adm-break-size" class="adm-select adm-select--dark adm-select--dark-wide">
                ${isBP ? `
                    <option value="4">Grand Final (4 teams)</option>
                    <option value="8">Semi-Finals (8 teams)</option>
                    <option value="16" selected>Quarter-Finals (16 teams)</option>
                    <option value="32">Octo-Finals (32 teams)</option>
                    <option value="64">Round of 64 (64 teams)</option>
                    <option disabled>──────────</option>
                    <option value="6p">Partial Finals (6 total: 2 bye + 4 play)</option>
                    <option value="12p">Partial Semi-Finals (12 total: 4 bye + 8 play)</option>
                    <option value="24p">Partial Quarter-Finals (24 total: 8 bye + 16 play)</option>
                    <option value="48p">Partial Octo-Finals (48 total: 16 bye + 32 play)</option>
                ` : `
                    <option value="2">Grand Final (2 teams)</option>
                    <option value="4">Semi-Finals (4 teams)</option>
                    <option value="8" selected>Quarter-Finals (8 teams)</option>
                    <option value="16">Octo-Finals (16 teams)</option>
                    <option value="32">Round of 32 (32 teams)</option>
                    <option value="64">Round of 64 (64 teams)</option>
                    <option disabled>──────────</option>
                    <option value="3p">Partial Finals (3 total: 1 bye + 2 play)</option>
                    <option value="6p">Partial Semi-Finals (6 total: 2 bye + 4 play)</option>
                    <option value="12p">Partial Quarter-Finals (12 total: 4 bye + 8 play)</option>
                    <option value="24p">Partial Octo-Finals (24 total: 8 bye + 16 play)</option>
                `}
            </select>
        </div>
        <div class="adm-break-controls-actions">
            <button class="adm-btn light sm" onclick="window.adminPreviewBreak()">Preview</button>
            <button class="adm-btn glow sm" onclick="window.adminConfirmBreak()">✅ Confirm Break</button>
            <div class="adm-break-controls-divider"></div>           
            <button class="adm-btn light sm" onclick="window.generateKnockout?.()">Start Outrounds</button>
            <button class="adm-btn light sm" onclick="window.switchTab('knockout')">View Draw →</button>
        </div>        
    </div>

    <!-- Preview result area -->
    <div id="adm-break-preview" class="hidden">
        <div class="adm-card adm-preview-card adm-card--mt">
            <div class="adm-row between adm-card-header-inner">
                <div class="adm-card-title adm-preview-title adm-card-title--inline">
                    👁 Break Preview <span class="adm-hint-xs">(not saved yet)</span>
                </div>
                <div class="adm-row gap-sm">
                    <button class="adm-btn secondary sm" onclick="document.getElementById('adm-break-preview').classList.add('hidden')">✕ Dismiss</button>
                    <button class="adm-btn glow sm" onclick="window.adminConfirmBreak()">✅ Confirm &amp; Save</button>
                </div>
            </div>
            <div id="adm-break-preview-content"></div>
        </div>
    </div>

    <!-- TABBED LAYOUT: reduces scrolling -->
    <div class="adm-card adm-card--flush">
        <div class="brk-tab-bar">
            <button id="brk-tab-all" class="brk-tab brk-tab-active" onclick="window._brkTab('all')">
                All Teams <span class="brk-tab-count">${allTeams.length}</span>
            </button>
            <button id="brk-tab-breaking" class="brk-tab" onclick="window._brkTab('breaking')">
                Breaking <span class="brk-tab-count brk-tab-count--green">${breaking.length}</span>
            </button>
            <button id="brk-tab-inelig" class="brk-tab" onclick="window._brkTab('inelig')">
                Ineligible <span class="brk-tab-count brk-tab-count--red">${ineligCount}</span>
            </button>
        </div>
        <div id="brk-pane-all" class="adm-brk-pane is-active" style="display:block">
            <div class="adm-table-wrap"><table class="adm-table">
                <thead><tr>
                    <th class="adm-th-icon">🚫</th>
                    <th>Team</th><th>Code</th>
                    <th class="adm-th-center">${winsLabel}</th>
                    <th class="adm-th-center">Pts</th>
                    <th class="adm-th-center">Avg</th>
                    <th>Reason</th>
                </tr></thead>
                <tbody>${teamRows}</tbody>
            </table></div>
        </div>
        <div id="brk-pane-breaking" class="adm-brk-pane" style="display:none">
            ${breakingTable}
            ${breaking.length > 0 ? `
            <div class="adm-brk-pane-actions">
                <button class="adm-btn primary" onclick="window.generateKnockout?.()">⚔️ Start Knockout</button>
                <button class="adm-btn secondary" onclick="window.switchTab('knockout')">View Bracket →</button>
            </div>` : ''}
        </div>
        <div id="brk-pane-inelig" class="adm-brk-pane" style="display:none">
            ${ineligible.length === 0
                ? `<div class="adm-empty">No teams marked ineligible. Tick 🚫 in the All Teams tab to exclude a team.</div>`
                : `<div class="adm-table-wrap"><table class="adm-table">
                    <thead><tr><th>Team</th><th>${winsLabel}</th><th>Points</th><th>Reason</th><th></th></tr></thead>
                    <tbody>${ineligible.map(t=>`<tr>
                        <td><strong>${escapeHTML(t.name)}</strong></td>
                        <td class="adm-td-wins">${t.wins||0}</td>
                        <td>${(t.total||0).toFixed(1)}</td>
                        <td class="adm-td-avg">${escapeHTML(_catIneligReason(t, selectedCat)||'—')}</td>
                        <td><button class="adm-btn secondary xs" onclick="window.adminToggleIneligible('${t.id}',false);window.adminSwitchSection('break')">Remove</button></td>
                    </tr>`).join('')}</tbody>
                </table></div>`}
        </div>
    </div>
    `;
}


// ============================================================================
// SECTION: PUBLISH CONTROLS
// ============================================================================
function _sectionPublish() {
    const pub = state.publish || {};
    const tabs = [
        { id:'draw',      icon:'🎲', label:'Draw',      desc:'Show round pairings publicly' },
        { id:'standings', icon:'📊', label:'Standings',  desc:'Show team win/loss table' },
        { id:'speakers',  icon:'🗣️', label:'Speakers',   desc:'Show speaker score rankings' },
        { id:'break',     icon:'🏆', label:'Break',      desc:'Show breaking teams list' },
        { id:'knockout',  icon:'⚔️', label:'Outrounds',   desc:'Show knockout bracket' },
        { id:'motions',   icon:'📜', label:'Motions',    desc:'Show all round motions' },
        { id:'results',   icon:'✅', label:'Results',    desc:'Show debate result scores' },
    ];
    const rounds = state.rounds || [];

    return `
    <div class="adm-section-head">
        <h2>📡 Publish Controls</h2>
        <p>Toggle what the general public can see for <strong>${escapeHTML(activeTournament()?.name || 'this tournament')}</strong>.<br>
        <span style="font-size:12px;color:#64748b">⚠️ <strong>Admin accounts always see all tabs</strong> — publish state does not affect you. Published tabs are visible to everyone including unauthenticated visitors.</span></p>
    </div>
    <div class="adm-card">
        <div class="adm-card-title">🌐 Tab Visibility</div>
        <p class="adm-card-desc">Turn each public tab on or off.</p>
        <div class="adm-publish-list">
            ${tabs.map(t => `
            <div class="adm-pub-row">
                <div class="adm-pub-info">
                    <span class="adm-pub-icon">${t.icon}</span>
                    <div>
                        <div class="adm-pub-label">${t.label}</div>
                        <div class="adm-pub-desc">${t.desc}</div>
                    </div>
                </div>
                <div class="adm-pub-right">
                    <span class="adm-pub-state ${pub[t.id]?'on':'off'}">${pub[t.id]?'Live':'Hidden'}</span>
                    <button class="adm-toggle ${pub[t.id]?'on':''}" onclick="window.adminTogglePublish('${t.id}')">
                        <span class="adm-toggle-knob"></span>
                    </button>
                </div>
            </div>`).join('')}
        </div>
        <div class="adm-card-actions-bordered">
            <button class="adm-btn primary" onclick="window.adminPublishAll()">📡 Publish Everything</button>
            <button class="adm-btn secondary" onclick="window.adminHideAll()">🔒 Hide Everything</button>
        </div>
    </div>
    <div class="adm-card">
        <div class="adm-card-title">🔒 Round Blind Controls</div>
        <p class="adm-card-desc">Blinding a round hides its results from teams and the public.</p>
        ${rounds.length === 0
            ? `<div class="adm-empty">No rounds yet.</div>`
            : `<div class="adm-col">
                ${rounds.map((r, idx) => {
                    const done = (r.debates||[]).filter(d=>d.entered).length;
                    const tot  = (r.debates||[]).length;
                    return `
                    <div class="adm-pub-row">
                        <div class="adm-pub-info">
                            <span class="adm-pub-icon">${r.type==='knockout'?'🏆':'🎲'}</span>
                            <div>
                                <div class="adm-pub-label">Round ${r.id}${r.motion ? ': '+escapeHTML(r.motion.substring(0,40))+'…' : ''}</div>
                                <div class="adm-pub-desc">${done}/${tot} ballots submitted · ${r.type||'prelim'}</div>
                            </div>
                        </div>
                        <div class="adm-pub-right">
                            <span class="adm-pub-state ${r.blinded?'off':'on'}">${r.blinded?'Blinded':'Visible'}</span>
                            ${r.type !== 'knockout' ? `
                            <button class="adm-toggle ${r.blinded?'':' on'}" onclick="window.toggleBlindRound(${idx});window.adminSwitchSection('publish')">
                                <span class="adm-toggle-knob"></span>
                            </button>` : '<span class="adm-ko-label">KO — always visible</span>'}
                        </div>
                    </div>`;
                }).join('')}
            </div>`}
    </div>`;
}

// ============================================================================
// SECTION: URLs & ACCESS
// ============================================================================
function _sectionURLs() {
    setTimeout(_loadURLsData, 0);
    return `
    <div class="adm-section-head">
        <h2>🔗 URLs &amp; Access</h2>
        <p>Generate private access links for judges and teams. Links are secured by email — only the person whose email is on file can use the link.</p>
    </div>
    <div id="adm-urls-body">
        <div style="text-align:center;padding:40px;color:#94a3b8;">Loading…</div>
    </div>`;
}

async function _loadURLsData() {
    const tournId = state.activeTournamentId;
    const el = document.getElementById('adm-urls-body');
    if (!el) return;
    const safe = async (fn) => { try { return await fn(); } catch(_) { return []; } };
    const [jTokens, tTokens] = await Promise.all([
        tournId ? safe(() => api.getJudgeTokenStatus(tournId)) : [],
        tournId ? safe(() => api.getTeamTokenStatus(tournId))  : [],
    ]);
    if (!document.getElementById('adm-urls-body')) return;
    el.innerHTML = _buildURLsBody(jTokens || [], tTokens || []);
}

function _buildURLsBody(jTokens, tTokens) {
    const base   = window.location.origin + window.location.pathname;
    const jMap   = Object.fromEntries((jTokens).map(t => [t.judge_id, t]));
    const tMap   = Object.fromEntries((tTokens).map(t => [t.team_id,  t]));
    const judges = state.judges || [];
    const teams  = state.teams  || [];
    const jCount = Object.keys(jMap).length;
    const tCount = Object.keys(tMap).length;

    function judgeRow(j) {
        const tok   = jMap[j.id];
        const url   = tok ? `${base}?judge=${tok.token}` : null;
        const safeUrl  = url  ? url.replace(/'/g, '%27')  : '';
        const safeName = escapeHTML(j.name);
        const safeEmail = escapeHTML(j.email || '');
        const used  = tok?.last_used_at ? new Date(tok.last_used_at).toLocaleDateString() : null;
        return `
        <div class="url-row ${tok ? 'url-row--active' : ''}">
            <span class="url-status-dot ${tok ? 'url-status-dot--on' : 'url-status-dot--off'}"></span>
            <div class="url-row-info">
                <span class="url-row-name">${safeName}</span>
                ${safeEmail ? `<span class="url-row-email">${safeEmail}</span>` : '<span class="url-row-email url-row-email--missing">no email — link not protected</span>'}
                ${used      ? `<span class="url-row-meta">Last used ${used}</span>` : ''}
            </div>
            <div class="url-row-actions">
                ${!tok ? `
                    <button class="url-btn url-btn--gen" onclick="window._adminGenJudgeURL('${j.id}')">Generate link</button>
                ` : `
                    <button class="url-btn url-btn--copy"   onclick="window._adminCopyURL('${safeUrl}')">Copy</button>
                    <button class="url-btn url-btn--send"   onclick="window._adminSendURL('${safeUrl}','${safeEmail}','judge','${safeName}')">Send</button>
                    <button class="url-btn url-btn--regen"  onclick="window._adminGenJudgeURL('${j.id}')" title="Regenerate (invalidates old link)">↺ New</button>
                    <button class="url-btn url-btn--revoke" onclick="window._adminRevokeJudgeURL('${j.id}')">Revoke</button>
                `}
            </div>
        </div>`;
    }

    function teamRow(t) {
        const tok   = tMap[t.id];
        const url   = tok ? `${base}?team=${tok.token}` : null;
        const safeUrl  = url  ? url.replace(/'/g, '%27')  : '';
        const safeName = escapeHTML(t.name);
        const safeEmail = escapeHTML(t.email || '');
        const used  = tok?.last_used_at ? new Date(tok.last_used_at).toLocaleDateString() : null;
        return `
        <div class="url-row ${tok ? 'url-row--active' : ''}">
            <span class="url-status-dot ${tok ? 'url-status-dot--on' : 'url-status-dot--off'}"></span>
            <div class="url-row-info">
                <span class="url-row-name">${safeName}</span>
                ${safeEmail ? `<span class="url-row-email">${safeEmail}</span>` : '<span class="url-row-email url-row-email--missing">no email — link not protected</span>'}
                ${used      ? `<span class="url-row-meta">Last used ${used}</span>` : ''}
            </div>
            <div class="url-row-actions">
                ${!tok ? `
                    <button class="url-btn url-btn--gen" onclick="window._adminGenTeamURL('${t.id}')">Generate link</button>
                ` : `
                    <button class="url-btn url-btn--copy"   onclick="window._adminCopyURL('${safeUrl}')">Copy</button>
                    <button class="url-btn url-btn--send"   onclick="window._adminSendURL('${safeUrl}','${safeEmail}','team','${safeName}')">Send</button>
                    <button class="url-btn url-btn--regen"  onclick="window._adminGenTeamURL('${t.id}')" title="Regenerate (invalidates old link)">↺ New</button>
                    <button class="url-btn url-btn--revoke" onclick="window._adminRevokeTeamURL('${t.id}')">Revoke</button>
                `}
            </div>
        </div>`;
    }

    const emptyMsg = '<div class="url-empty">None added yet.</div>';

    return `
    <style>
    .url-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
    @media(max-width:700px){.url-columns{grid-template-columns:1fr;}}
    .url-col{background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;}
    .url-col-head{padding:18px 20px 14px;border-bottom:1px solid #f1f5f9;}
    .url-col-title{font-size:15px;font-weight:700;color:#111827;margin:0 0 2px;}
    .url-col-sub{font-size:12px;color:#94a3b8;margin:0 0 14px;}
    .url-col-bulk{display:flex;gap:8px;flex-wrap:wrap;}
    .url-col-bulk-btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid;}
    .url-col-bulk-btn.gen{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;}
    .url-col-bulk-btn.gen:hover{background:#dbeafe;}
    .url-col-bulk-btn.send{background:#f0fdf4;color:#15803d;border-color:#bbf7d0;}
    .url-col-bulk-btn.send:hover{background:#dcfce7;}
    .url-col-bulk-btn.danger{background:#fff1f2;color:#be123c;border-color:#fecdd3;}
    .url-col-bulk-btn.danger:hover{background:#ffe4e6;}
    .url-list{max-height:420px;overflow-y:auto;}
    .url-row{display:flex;align-items:center;gap:10px;padding:11px 20px;border-bottom:1px solid #f8fafc;transition:background .1s;}
    .url-row:last-child{border-bottom:none;}
    .url-row:hover{background:#fafafa;}
    .url-status-dot{flex-shrink:0;width:8px;height:8px;border-radius:50%;}
    .url-status-dot--on{background:#22c55e;}
    .url-status-dot--off{background:#d1d5db;}
    .url-row-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}
    .url-row-name{font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .url-row-email{font-size:11px;color:#94a3b8;}
    .url-row-email--missing{color:#f59e0b;font-style:italic;}
    .url-row-meta{font-size:11px;color:#c4b5fd;}
    .url-row-actions{display:flex;gap:4px;flex-shrink:0;}
    .url-btn{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1.5px solid;white-space:nowrap;transition:opacity .1s;}
    .url-btn:hover{opacity:.8;}
    .url-btn--gen{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;}
    .url-btn--copy{background:#f8fafc;color:#374151;border-color:#e2e8f0;}
    .url-btn--send{background:#f0fdf4;color:#15803d;border-color:#bbf7d0;}
    .url-btn--regen{background:#fefce8;color:#854d0e;border-color:#fde68a;}
    .url-btn--revoke{background:#fff1f2;color:#be123c;border-color:#fecdd3;}
    .url-empty{padding:24px;text-align:center;font-size:13px;color:#94a3b8;}
    </style>
    <div class="url-columns">

      <div class="url-col">
        <div class="url-col-head">
          <div class="url-col-title">⚖️ Judge Access Links</div>
          <div class="url-col-sub">${jCount} of ${judges.length} generated</div>
          <div class="url-col-bulk">
            <button class="url-col-bulk-btn gen"    onclick="window._adminGenAllJudgeURLs()">Generate all</button>
            <button class="url-col-bulk-btn send"   onclick="window._adminBulkSendURLs('judges')">Send all</button>
            <button class="url-col-bulk-btn danger" onclick="window._adminRevokeAllJudgeURLs()">Revoke all</button>
          </div>
        </div>
        <div class="url-list">
          ${judges.length ? judges.map(judgeRow).join('') : emptyMsg}
        </div>
      </div>

      <div class="url-col">
        <div class="url-col-head">
          <div class="url-col-title">👥 Team Access Links</div>
          <div class="url-col-sub">${tCount} of ${teams.length} generated</div>
          <div class="url-col-bulk">
            <button class="url-col-bulk-btn gen"    onclick="window._adminGenAllTeamURLs()">Generate all</button>
            <button class="url-col-bulk-btn send"   onclick="window._adminBulkSendURLs('teams')">Send all</button>
            <button class="url-col-bulk-btn danger" onclick="window._adminRevokeAllTeamURLs()">Revoke all</button>
          </div>
        </div>
        <div class="url-list">
          ${teams.length ? teams.map(teamRow).join('') : emptyMsg}
        </div>
      </div>

    </div>`;
}

// ── Admin URL CRUD window functions ───────────────────────────────────────────
async function _adminGenJudgeURL(judgeId) {
    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }
    try {
        const { url } = await api.generateJudgeToken(judgeId, tournId);
        showNotification('URL generated — copy it from the list', 'success');
        _loadURLsData();
        // Auto-copy for convenience
        navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e) { showNotification(`Failed to generate: ${e.message}`, 'error'); }
}

async function _adminGenTeamURL(teamId) {
    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }
    try {
        const { url } = await api.generateTeamToken(teamId, tournId);
        showNotification('URL generated — copy it from the list', 'success');
        _loadURLsData();
        navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e) { showNotification(`Failed to generate: ${e.message}`, 'error'); }
}

async function _adminRevokeJudgeURL(judgeId) {
    const tournId = state.activeTournamentId;
    if (!tournId) return;
    if (!confirm('Revoke this judge\'s access link?')) return;
    try {
        await api.revokeJudgeToken(judgeId, tournId);
        showNotification('Judge URL revoked', 'info');
        _loadURLsData();
    } catch (e) { showNotification(`Failed: ${e.message}`, 'error'); }
}

async function _adminRevokeTeamURL(teamId) {
    const tournId = state.activeTournamentId;
    if (!tournId) return;
    if (!confirm('Revoke this team\'s access link?')) return;
    try {
        await api.revokeTeamToken(teamId, tournId);
        showNotification('Team URL revoked', 'info');
        _loadURLsData();
    } catch (e) { showNotification(`Failed: ${e.message}`, 'error'); }
}

function _adminCopyURL(url) {
    navigator.clipboard.writeText(url)
        .then(() => showNotification('URL copied to clipboard', 'success'))
        .catch(() => { prompt('Copy this URL:', url); });
}

function _adminSendURL(url, email, type, name) {
    const subject = encodeURIComponent(`Your ${type === 'judge' ? 'Judge' : 'Team'} Portal Access`);
    const body = encodeURIComponent(
        `Hi ${name},\n\nHere is your private access link for the tournament portal:\n\n${url}\n\n` +
        `You will be asked to verify your email address when you first open the link.\n\n` +
        `Please keep this link private — it is unique to you.\n\nBest,\nTournament Admin`
    );
    const to = email ? encodeURIComponent(email) : '';
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
}

async function _adminGenAllJudgeURLs() {
    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }
    const judges = state.judges || [];
    if (!judges.length) { showNotification('No judges added yet', 'error'); return; }
    let count = 0, failed = 0;
    for (const j of judges) {
        try { await api.generateJudgeToken(j.id, tournId); count++; }
        catch (e) { failed++; console.error('generateJudgeToken failed for', j.name, e.message); }
    }
    if (failed) showNotification(`Generated ${count}, failed ${failed}. Check console for details.`, failed === judges.length ? 'error' : 'info');
    else showNotification(`Generated ${count} judge URL(s)`, 'success');
    _loadURLsData();
}

async function _adminGenAllTeamURLs() {
    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }
    const teams = state.teams || [];
    if (!teams.length) { showNotification('No teams added yet', 'error'); return; }
    let count = 0, failed = 0;
    for (const t of teams) {
        try { await api.generateTeamToken(t.id, tournId); count++; }
        catch (e) { failed++; console.error('generateTeamToken failed for', t.name, e.message); }
    }
    if (failed) showNotification(`Generated ${count}, failed ${failed}. Check console for details.`, failed === teams.length ? 'error' : 'info');
    else showNotification(`Generated ${count} team URL(s)`, 'success');
    _loadURLsData();
}

async function _adminBulkSendURLs(type) {
    const tournId = state.activeTournamentId;
    if (!tournId) return;
    try {
        let tokens, entities;
        if (type === 'judges') {
            tokens   = await api.getJudgeTokenStatus(tournId);
            entities = state.judges || [];
        } else {
            tokens   = await api.getTeamTokenStatus(tournId);
            entities = state.teams || [];
        }
        const base = window.location.origin + window.location.pathname;
        const param = type === 'judges' ? 'judge' : 'team';
        const idKey = type === 'judges' ? 'judge_id' : 'team_id';
        const map   = Object.fromEntries((tokens || []).map(t => [t[idKey], t]));
        let sent = 0;
        for (const entity of entities) {
            const tok = map[entity.id];
            if (!tok || !entity.email) continue;
            const url  = `${base}?${param}=${tok.token}`;
            const name = entity.name || '';
            _adminSendURL(url, entity.email, param, name);
            sent++;
            if (sent >= 5) break; // browsers block > 5 mailto popups
        }
        if (sent === 0) showNotification('No entities with email addresses and active URLs found', 'info');
        else showNotification(`Opened ${sent} email draft(s)`, 'success');
    } catch (e) { showNotification(`Failed: ${e.message}`, 'error'); }
}

async function _adminRevokeAllURLs() {
    const tournId = state.activeTournamentId;
    if (!tournId) return;
    if (!confirm('Revoke ALL judge and team access links? They will need to be regenerated.')) return;
    try {
        await Promise.all([api.revokeAllTokens(tournId), api.revokeAllTeamTokens(tournId)]);
        showNotification('All URLs revoked', 'info');
        _loadURLsData();
    } catch (e) { showNotification(`Failed: ${e.message}`, 'error'); }
}

async function _adminRevokeAllJudgeURLs() {
    const tournId = state.activeTournamentId;
    if (!tournId) return;
    if (!confirm('Revoke all judge access links?')) return;
    try {
        await api.revokeAllTokens(tournId);
        showNotification('All judge URLs revoked', 'info');
        _loadURLsData();
    } catch (e) { showNotification(`Failed: ${e.message}`, 'error'); }
}

async function _adminRevokeAllTeamURLs() {
    const tournId = state.activeTournamentId;
    if (!tournId) return;
    if (!confirm('Revoke all team access links?')) return;
    try {
        await api.revokeAllTeamTokens(tournId);
        showNotification('All team URLs revoked', 'info');
        _loadURLsData();
    } catch (e) { showNotification(`Failed: ${e.message}`, 'error'); }
}

// ============================================================================
// SECTION: TEST DATA
// ============================================================================
function _sectionSample() {
    return `
    <div class="adm-section-head">
        <h2>🚀 Test Data</h2>
        <p>Generate a realistic sample tournament to explore all features without setting up real participants.</p>
    </div>

    <div class="adm-two-col">
        <div class="adm-card">
            <div class="adm-card-title">⚙️ Configure Dataset</div>

            <div class="adm-form-stack">
                <div class="adm-field">
                    <label class="adm-label">Number of Teams</label>
                    <input type="range" id="sample-team-count" min="8" max="32" value="20" step="2"
                           class="adm-range"
                           oninput="document.getElementById('sample-team-display').textContent=this.value+' teams'">
                    <div class="adm-range-labels">
                        <span>8</span><span id="sample-team-display" class="adm-range-val">20 teams</span><span>32</span>
                    </div>
                </div>

                <div class="adm-field">
                    <label class="adm-label">Preliminary Rounds</label>
                    <input type="range" id="sample-round-count" min="3" max="8" value="5" step="1"
                           class="adm-range"
                           oninput="document.getElementById('sample-round-display').textContent=this.value+' rounds'">
                    <div class="adm-range-labels">
                        <span>3</span><span id="sample-round-display" class="adm-range-val">5 rounds</span><span>8</span>
                    </div>
                </div>

                <div class="adm-field">
                    <label class="adm-label">Number of Judges</label>
                    <input type="range" id="sample-judge-count" min="4" max="20" value="12" step="1"
                           class="adm-range"
                           oninput="document.getElementById('sample-judge-display').textContent=this.value+' judges'">
                    <div class="adm-range-labels">
                        <span>4</span><span id="sample-judge-display" class="adm-range-val">12 judges</span><span>20</span>
                    </div>
                </div>

                <label class="adm-check">
                    <input type="checkbox" id="sample-include-knockout" checked class="adm-range">
                    <span>Include Outrounds</span>
                </label>

                <label class="adm-check">
                    <input type="checkbox" id="sample-randomize-scores" checked class="adm-range">
                    <span>Randomize Scores (realistic distribution)</span>
                </label>
            </div>

            <div class="adm-card-actions">
                <button class="adm-btn primary full" onclick="window.generateCustomSampleData()">🚀 Generate Data</button>
            </div>
        </div>

        <div class="adm-card">
            <div class="adm-card-title">✅ What Gets Generated</div>
            <div class="adm-gen-list">
                <div>🏫 Teams with school affiliations &amp; speakers</div>
                <div>👨‍⚖️ Judges with conflict flags</div>
                <div>🎲 Completed prelim rounds &amp; pairings</div>
                <div>📊 Ballot results &amp; team scores</div>
                <div>🗣️ Speaker scores &amp; standings</div>
                <div>🏆 Outround bracket (if enabled)</div>
            </div>

            <div class="adm-info-banner adm-info-banner--mt">
                ⚠️ <strong>Warning:</strong> This will replace all existing tournament data. Export first if needed.
            </div>

            <div class="adm-card-actions">
                <button class="adm-btn secondary" onclick="window.adminSwitchSection('data')">📤 Export First</button>
                <button class="adm-btn secondary" onclick="window.adminSwitchSection('danger')">🗑️ Reset First</button>
            </div>
        </div>
    </div>`;
}

// ============================================================================
// SECTION: DATA & EXPORT
// ============================================================================
function _sectionData() {
    return `
    <div class="adm-section-head">
        <h2>💾 Data &amp; Export</h2>
        <p>Export tournament data or bring in new participants.</p>
    </div>
    <div class="adm-two-col">
        <div class="adm-card">
            <div class="adm-card-title">📤 Export</div>
            <div class="adm-form-stack">
                <button class="adm-btn secondary full" onclick="window.exportData()">📥 Export Full JSON</button>
                <button class="adm-btn secondary full" onclick="window.exportStandings?.()">📊 Export Standings CSV</button>
                <button class="adm-btn secondary full" onclick="window.exportSpeakerStandings?.()">🗣️ Export Speakers CSV</button>
            </div>
        </div>
        <div class="adm-card">
            <div class="adm-card-title">📥 Import &amp; Sample</div>
            <div class="adm-form-stack">
                <button class="adm-btn secondary full" onclick="window.switchTab('import')">📤 Go to Import Tab</button>
                <button class="adm-btn secondary full" onclick="window.adminSwitchSection('sample')">🚀 Go to Test Data</button>
            </div>
        </div>
    </div>`;
}

// ============================================================================
// SECTION: LOCAL USERS
// ============================================================================
function _sectionUsers() {
    const users = getLocalUsers();
    const userRows = users.map(u => `
        <tr>
            <td>${escapeHTML(u.username)}</td>
            <td>${escapeHTML(u.name)}</td>
            <td>
                <select class="adm-select" style="width:auto;padding:4px 8px;font-size:12px"
                        onchange="window.adminUpdateLocalUserRole('${escapeHTML(u.username)}', this.value)">
                    <option value="public" ${u.role==='public'?'selected':''}>Public</option>
                    <option value="judge" ${u.role==='judge'?'selected':''}>Judge</option>
                    <option value="team" ${u.role==='team'?'selected':''}>Speaker</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
                </select>
            </td>
            <td>${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
            <td>
                <button class="adm-btn danger xs" onclick="window.adminDeleteLocalUser('${escapeHTML(u.username)}')">🗑</button>
            </td>
        </tr>
    `).join('');

    return `
    <div class="adm-section-head">
        <h2>👥 Local Users</h2>
        <p>Manage offline users when Supabase is unreachable.</p>
    </div>
    <div class="adm-card">
        <div class="adm-card-title">➕ Add Local User</div>
        <div class="adm-form-stack">
            <div class="adm-field">
                <label class="adm-label">Username / Email</label>
                <input type="text" id="adm-local-username" class="adm-input" placeholder="Username or email">
            </div>
            <div class="adm-field">
                <label class="adm-label">Name</label>
                <input type="text" id="adm-local-name" class="adm-input" placeholder="Full name">
            </div>
            <div class="adm-field">
                <label class="adm-label">Password</label>
                <input type="password" id="adm-local-password" class="adm-input" placeholder="Min 8 characters">
            </div>
            <div class="adm-field">
                <label class="adm-label">Role</label>
                <select id="adm-local-role" class="adm-select">
                    <option value="public">Public Viewer</option>
                    <option value="judge">Judge</option>
                    <option value="team">Speaker</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <button class="adm-btn primary full" onclick="window.adminCreateLocalUser()">Create User</button>
        </div>
    </div>
    <div class="adm-card">
        <div class="adm-card-title">Existing Users (${users.length})</div>
        <table class="adm-table">
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${userRows || '<tr><td colspan="5" style="text-align:center;color:#64748b;">No local users yet</td></tr>'}
            </tbody>
        </table>
    </div>`;
}

window.adminCreateLocalUser = async function() {
    const username = document.getElementById('adm-local-username')?.value.trim();
    const name = document.getElementById('adm-local-name')?.value.trim();
    const password = document.getElementById('adm-local-password')?.value;
    const role = document.getElementById('adm-local-role')?.value || 'public';

    if (!username || !name || !password) {
        showNotification('All fields are required', 'error');
        return;
    }
    if (password.length < 8) {
        showNotification('Password must be at least 8 characters', 'error');
        return;
    }

    try {
        await registerLocalUser({ username, password, name, role });
        showNotification('User created', 'success');
        renderAdminDashboard();
    } catch (err) {
        showNotification(err.message, 'error');
    }
};

window.adminDeleteLocalUser = async function(username) {
    if (!confirm(`Delete user ${username}?`)) return;
    try {
        await deleteLocalUser(username);
        showNotification('User deleted', 'success');
        renderAdminDashboard();
    } catch (err) {
        showNotification(err.message, 'error');
    }
};

window.adminUpdateLocalUserRole = async function(username, role) {
    try {
        await updateLocalUserRole(username, role);
        showNotification('Role updated', 'success');
    } catch (err) {
        showNotification(err.message, 'error');
    }
};

// ============================================================================
// SECTION: DANGER ZONE
// ============================================================================
function _sectionDanger() {
    return `
    <div class="adm-section-head">
        <h2>⚠️ Danger Zone ⚠️</h2>
        <p>These actions are permanent and cannot be undone. Read carefully.</p>
    </div>
    <div class="adm-card danger-card">
        <div class="adm-danger-item">
            <div class="adm-danger-info">
                <strong>↺ Reset Draw Only</strong>
                <p>Clears all rounds, debates, and results for <em>${escapeHTML(activeTournament()?.name||'current tournament')}</em>. Resets team/speaker stats. <strong>Teams and judges are preserved.</strong></p>
            </div>
            <button class="adm-btn warning" onclick="window.showResetConfirmation()">Reset Draw</button>
        </div>
        <div class="adm-danger-item">
            <div class="adm-danger-info">
                <strong>💣 Full Wipe</strong>
                <p>Deletes everything in the current tournament — teams, judges, rounds, all data.</p>
            </div>
            <button class="adm-btn danger" onclick="window.adminConfirmFullWipe()">Full Wipe</button>
        </div>
        <div class="adm-danger-item">
            <div class="adm-danger-info">
                <strong>🔑 Reset All URLs</strong>
                <p>Invalidates all judge and team access links for this tournament.</p>
            </div>
            <button class="adm-btn warning" onclick="window.adminResetURLs()">Reset URLs</button>
        </div>
    </div>`;
}

// ============================================================================
// HELPERS
// ============================================================================
function _progressBar(label, val, max, color) {
    const pct = max > 0 ? Math.min(100, Math.round(val/max*100)) : 0;
    return `<div class="adm-prog-item">
        <div class="adm-prog-hd"><span>${label}</span><span>${val}/${max}</span></div>
        <div class="adm-bar-bg"><div class="adm-bar-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
}

function _getStats() {
    const teams      = state.teams  || [];
    const judges     = state.judges || [];
    const rounds     = state.rounds || [];
    const allDebates = rounds.flatMap(r => r.debates || []);
    return {
        teams:   { total: teams.length,   breaking: teams.filter(t=>t.broke).length },
        judges:  { total: judges.length,  chair: judges.filter(j=>j.role==='chair').length },
        rounds:  { total: rounds.length,  completed: rounds.filter(r=>(r.debates||[]).every(d=>d.entered)&&r.debates?.length>0).length },
        debates: { total: allDebates.length, entered: allDebates.filter(d=>d.entered).length },
    };
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

export function adminCreateRound() {
    const motion       = document.getElementById('adm-motion')?.value.trim()    || 'Debate Round';
    const method       = document.getElementById('adm-pair-method')?.value      || 'random';
    const sideMethod   = document.getElementById('adm-side-method')?.value      || 'random';
    const autoAllocate = document.getElementById('adm-auto-allocate')?.checked ?? true;
    const blind        = document.getElementById('adm-blind-round')?.checked    ?? false;

    const fn = typeof createRound === 'function' ? createRound : window.createRound;
    if (typeof fn !== 'function') { showNotification('createRound not available — is draw.js loaded?','error'); return; }
    fn({ motion, method, sideMethod, autoAllocate, blind });
    _refreshAdminRounds();
}

// Toggle a team's ineligibility manually — saves immediately
export function adminToggleIneligible(teamId, isIneligible) {
    const team = (state.teams||[]).find(t => String(t.id) === String(teamId));
    if (!team) return;
    const catId = window._brkSelectedCat || '';

    if (catId) {
        if (!team.categoryIneligible) team.categoryIneligible = {};
        if (!team.categoryIneligibleReason) team.categoryIneligibleReason = {};
        if (isIneligible) {
            team.categoryIneligible[catId] = true;
            team.categoryIneligibleReason[catId] = team.categoryIneligibleReason[catId] || '';
        } else {
            delete team.categoryIneligible[catId];
            delete team.categoryIneligibleReason[catId];
        }
    } else {
        if (isIneligible) {
            team.breakIneligible = true;
            team.breakIneligibleReason = team.breakIneligibleReason || '';
        } else {
            delete team.breakIneligible;
            delete team.breakIneligibleReason;
        }
    }

    save();
    const row = document.getElementById(`inelig-row-${teamId}`);
    if (row) row.classList.toggle('adm-row--inelig', isIneligible);
    const cell = document.getElementById(`inelig-reason-cell-${teamId}`);
    if (cell) {
        cell.innerHTML = isIneligible
            ? `<input type="text" value=""
                      placeholder="Reason (optional)…"
                      onchange="window.adminSetIneligibleReason('${teamId}', this.value)"
                      class="adm-inelig-input">`
            : `<span class="adm-muted-sm">—</span>`;
    }
}

// Update the reason string for a manually ineligible team
export function adminSetIneligibleReason(teamId, reason) {
    const team = (state.teams||[]).find(t => String(t.id) === String(teamId));
    if (!team) return;
    const catId = window._brkSelectedCat || '';
    if (catId) {
        if (!team.categoryIneligibleReason) team.categoryIneligibleReason = {};
        team.categoryIneligibleReason[catId] = reason.trim();
    } else {
        if (!team.breakIneligible) return;
        team.breakIneligibleReason = reason.trim();
    }
    save();
}

// ── Per-category break helpers ────────────────────────────────────────────────
function _isCatIneligible(t, catId) {
    return catId
        ? !!(t.categoryIneligible?.[catId])
        : !!t.breakIneligible;
}
function _isCatBroke(t, catId) {
    return catId
        ? !!(t.categoryBreaks?.[catId]?.broke)
        : !!t.broke;
}
function _catSeed(t, catId) {
    return catId
        ? (t.categoryBreaks?.[catId]?.seed ?? null)
        : (t.seed ?? null);
}
function _catIneligReason(t, catId) {
    return catId
        ? (t.categoryIneligibleReason?.[catId] || '')
        : (t.breakIneligibleReason || '');
}

// Pure compute — uses per-category or global ineligible flags
function _computeBreak(size) {
    const catId = window._brkSelectedCat || '';
    const eligible = (state.teams||[])
        .filter(t => !_isCatIneligible(t, catId))
        .filter(t => {
            if (!catId) return true;
            return (typeof window.teamMatchesCategory === 'function')
                ? window.teamMatchesCategory(t, catId)
                : (t.categories||[]).includes(catId);
        })
        .sort((a,b) => ((b.wins||0)-(a.wins||0)) || ((b.total||0)-(a.total||0)));

    const cutoff = Math.min(size, eligible.length);
    return {
        breaking:  eligible.slice(0, cutoff).map((t,i) => ({...t, _previewSeed: i+1})),
        bubble:    eligible.slice(cutoff, cutoff+3),
        ineligible:(state.teams||[])
            .filter(t => {
                if (!_isCatIneligible(t, catId)) return false;
                if (!catId) return true;
                return (typeof window.teamMatchesCategory === 'function')
                    ? window.teamMatchesCategory(t, catId)
                    : (t.categories||[]).includes(catId);
            })
            .sort((a,b) => ((b.wins||0)-(a.wins||0))||((b.total||0)-(a.total||0)))
    };
}

export function adminPreviewBreak() {
    const sizeVal = document.getElementById('adm-break-size')?.value || '8';
    const isPartial = sizeVal.endsWith('p');
    const totalSize = parseInt(sizeVal) || 8;
    const catId = window._brkSelectedCat || '';
    const isBP = (activeTournament()?.format === 'bp');
    const winsLabel = isBP ? '1st/2nd' : 'Wins';

    const { breaking, bubble, ineligible } = _computeBreak(totalSize);

    const row = (t, seed, badgeClass='green', note='') => {
        const rp = Object.keys(t.roundScores||{}).length;
        const avg = rp > 0 ? ((t.total||0)/rp).toFixed(1) : '—';
        return `<tr>
            <td><span class="adm-badge ${badgeClass}">${seed}${note}</span></td>
            <td><strong>${escapeHTML(t.name)}</strong></td>
            <td><code class="adm-code">${escapeHTML(t.code||'')}</code></td>
            <td class="adm-td-wins">${t.wins||0}</td>
            <td>${(t.total||0).toFixed(1)}</td>
            <td class="adm-td-avg">${avg}</td>
        </tr>`;
    };

    let bodyHtml;
    if (isPartial) {
        const reservedCount = Math.floor(totalSize / 3);
        const byeTeams  = breaking.slice(0, reservedCount);
        const playTeams = breaking.slice(reservedCount);
        bodyHtml = `
            ${byeTeams.map((t,i) => row(t, i+1, 'green', ' 🏅')).join('')}
            <tr class="adm-brk-bubble-row"><td colspan="6">— Preliminary Elimination Round (${playTeams.length} teams play) —</td></tr>
            ${playTeams.map((t,i) => row(t, reservedCount+i+1, 'amber')).join('')}`;
    } else {
        bodyHtml = breaking.map((t,i) => row(t, i+1)).join('');
    }

    let html = `
        ${isPartial ? `<div style="padding:8px 12px;background:#fef9e7;border-radius:6px;margin-bottom:10px;font-size:12px;color:#92400e;">
            <strong>Partial Break:</strong> top ${Math.floor(totalSize/3)} get byes (🏅), seeds ${Math.floor(totalSize/3)+1}–${totalSize} play the Preliminary Elimination Round.
        </div>` : ''}
        <div class="adm-table-wrap"><table class="adm-table">
            <thead><tr><th>Seed</th><th>Team</th><th>Code</th><th>${winsLabel}</th><th>Points</th><th>Avg</th></tr></thead>
            <tbody>
                ${bodyHtml}
                ${!isPartial && bubble.length ? `<tr class="adm-brk-bubble-row"><td colspan="6">— Bubble (next ${bubble.length}) —</td></tr>${bubble.map((t,i)=>row(t,breaking.length+i+1,'grey')).join('')}` : ''}
            </tbody>
        </table></div>`;

    if (ineligible.length) {
        html += `<div class="adm-inelig-block">
            <div class="adm-inelig-block-title">🚫 ${ineligible.length} manually excluded</div>
            ${ineligible.map(t=>`<div class="adm-inelig-block-row">
                <strong>${escapeHTML(t.name)}</strong>${_catIneligReason(t,catId)?` — ${escapeHTML(_catIneligReason(t,catId))}` :''}
            </div>`).join('')}
        </div>`;
    }

    const el = document.getElementById('adm-break-preview');
    const content = document.getElementById('adm-break-preview-content');
    if (el && content) {
        content.innerHTML = html;
        el.style.display = 'block';
        el.classList.remove('hidden');
    }
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function adminConfirmBreak() {
    const sizeVal = document.getElementById('adm-break-size')?.value || '8';
    const isPartial = sizeVal.endsWith('p');
    const totalSize = parseInt(sizeVal) || 8;
    const catId = window._brkSelectedCat || '';

    // Reset break data for all teams in scope
    (state.teams||[]).forEach(t => {
        if (!catId) {
            t.broke = false; t.seed = null; t.reserved = false;
        } else {
            const matches = (typeof window.teamMatchesCategory === 'function')
                ? window.teamMatchesCategory(t, catId)
                : (t.categories||[]).includes(catId);
            if (matches) {
                if (!t.categoryBreaks) t.categoryBreaks = {};
                t.categoryBreaks[catId] = { broke: false, seed: null, reserved: false };
            }
        }
    });

    const eligible = (state.teams||[])
        .filter(t => !_isCatIneligible(t, catId))
        .filter(t => {
            if (!catId) return true;
            return (typeof window.teamMatchesCategory === 'function')
                ? window.teamMatchesCategory(t, catId)
                : (t.categories||[]).includes(catId);
        })
        .sort((a,b) => ((b.wins||0)-(a.wins||0)) || ((b.total||0)-(a.total||0)));

    if (eligible.length < totalSize) {
        showNotification(`Only ${eligible.length} eligible teams. Cannot break ${totalSize}.`, 'error');
        return;
    }

    let reservedCount = 0;
    if (isPartial) {
        reservedCount = Math.floor(totalSize / 3);
        eligible.slice(0, reservedCount).forEach((t, i) => {
            if (catId) {
                if (!t.categoryBreaks) t.categoryBreaks = {};
                t.categoryBreaks[catId] = { broke: true, seed: i + 1, reserved: true };
            } else {
                t.broke = true; t.seed = i + 1; t.reserved = true;
            }
        });
        eligible.slice(reservedCount, totalSize).forEach((t, i) => {
            if (catId) {
                if (!t.categoryBreaks) t.categoryBreaks = {};
                t.categoryBreaks[catId] = { broke: true, seed: reservedCount + i + 1, reserved: false };
            } else {
                t.broke = true; t.seed = reservedCount + i + 1; t.reserved = false;
            }
        });
        if (!state.tournament) state.tournament = {};
        state.tournament.isPartial = true;
        state.tournament.reservedCount = reservedCount;
    } else {
        eligible.slice(0, totalSize).forEach((t, i) => {
            if (catId) {
                if (!t.categoryBreaks) t.categoryBreaks = {};
                t.categoryBreaks[catId] = { broke: true, seed: i + 1 };
            } else {
                t.broke = true; t.seed = i + 1;
            }
        });
        if (!state.tournament) state.tournament = {};
        state.tournament.isPartial = false;
        state.tournament.reservedCount = 0;
    }

    save();

    const ineligCount = (state.teams||[]).filter(t => _isCatIneligible(t, catId)).length;
    const catLabel = catId
        ? ((typeof window.getCategoryById === 'function' ? window.getCategoryById(catId) : null)?.name || catId)
        : '';
    let msg = isPartial
        ? `Partial break confirmed — ${reservedCount} byes + ${totalSize - reservedCount} in preliminary round`
        : `Break confirmed — ${totalSize} team${totalSize !== 1 ? 's' : ''} breaking`;
    if (catLabel) msg += ` (${catLabel})`;
    if (ineligCount) msg += ` · ${ineligCount} excluded`;
    showNotification(msg, 'success');

    const prev = document.getElementById('adm-break-preview');
    if (prev) prev.style.display = 'none';
    setTimeout(() => {
        adminSwitchSection('break');
        window.renderBreakDisplay?.();
    }, 150);
}

// Backward-compat alias
export function adminCalculateBreak() { adminConfirmBreak(); }

export function adminTogglePublish(tabId) {
    if (!state?.publish) return;
    state.publish[tabId] = !state.publish[tabId];
    save();
    adminSwitchSection('publish');
    showNotification(`${tabId} ${state.publish[tabId]?'published':'hidden'}`, state.publish[tabId]?'success':'info');
}

export function adminPublishAll() {
    if (!state?.publish) return;
    ['draw','standings','speakers','break','knockout','motions','results'].forEach(t=>state.publish[t]=true);
    save(); adminSwitchSection('publish');
    showNotification('All tabs published','success');
}

export function adminHideAll() {
    if (!state) return;
    state.publish = {};
    save(); adminSwitchSection('publish');
    showNotification('All tabs hidden','info');
}

function adminDeleteRound(id) {
    if (!confirm(`Delete Round ${id}? All debate data will be lost.`)) return;
    api.deleteRound(id).then(() => {
        state.rounds = (state.rounds||[]).filter(r=>r.id!==id);
        saveNow();
        showNotification(`Round ${id} deleted`,'info');
        _refreshAdminRounds();
    }).catch(err => {
        showNotification(`Delete failed: ${err.message}`, 'error');
    });
}

// ── Tournament action handlers ──────────────────────────

async function adminCreateTournamentWithOpt(autoSwitch) {
    const name   = document.getElementById('new-tournament-name')?.value.trim();
    const format = document.getElementById('new-tournament-format')?.value || 'standard';
    if (!name) { showNotification('Please enter a tournament name', 'error'); return; }

    try {
        const t = await api.createTournament(name, format);
        state.tournaments[t.id] = {
            name: t.name,
            format: t.format,
            teams: [],
            judges: [],
            rounds: [],
            publish: {},
            feedback: [],
            judgeTokens: {},
            roomURLs: {}
        };

        if (format === 'speech') {
            state.tournaments[t.id].publish.speech = true;
            state.tournaments[t.id].publish.speakers = true;
            state.tournaments[t.id].speechMode = true;
        }

        if (autoSwitch) {
            switchTournamentCache(t.id, { teams: [], judges: [], rounds: [], publish: {} });
        }

        document.getElementById('new-tournament-name').value = '';
        adminSwitchSection('tournaments');
        showNotification(`Tournament "${t.name}" created`, 'success');
    } catch (err) {
        showNotification(`Create failed: ${err.message}`, 'error');
    }
}

// ── Danger zone ──────────────────────────────────────────────────────────────

function showResetConfirmation() {
    closeAllModals();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.onclick = e => { if(e.target===overlay) closeAllModals(); };
    const modal = document.createElement('div'); modal.className = 'modal modal--center';
    modal.innerHTML = `<div class="adm-modal-icon">⚠️</div>
        <h3 class="adm-modal-danger-title">Reset Tournament?</h3>
        <p class="adm-modal-body">Deletes all rounds and results. Teams and judges are kept.</p>
        <div class="adm-modal-actions">
            <button onclick="window.closeAllModals()" class="adm-btn secondary">Cancel</button>
            <button onclick="window.resetTournamentDrawOnly?.();window.closeAllModals();window.renderAdminDashboard();" class="adm-btn danger">Yes, Reset Draw</button>
        </div>`;
    overlay.appendChild(modal); document.body.appendChild(overlay);
}

function adminConfirmFullWipe() {
    closeAllModals();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    overlay.onclick = e => { if(e.target===overlay) closeAllModals(); };
    const modal = document.createElement('div'); modal.className = 'modal modal--center';
    modal.innerHTML = `<div class="adm-modal-icon">💣</div>
        <h3 class="adm-modal-danger-title">Full Wipe?</h3>
        <p class="adm-modal-body-sm"><strong>This deletes everything.</strong></p>
        <p class="adm-modal-body">Teams, judges, rounds, URLs — permanently gone.</p>
        <div class="adm-modal-actions">
            <button onclick="window.closeAllModals()" class="adm-btn secondary">Cancel</button>
            <button onclick="window.fullTournamentWipe?.();window.closeAllModals();window.renderAdminDashboard();" class="adm-btn danger">Wipe Everything</button>
        </div>`;
    overlay.appendChild(modal); document.body.appendChild(overlay);
}

function adminResetURLs() {
    _adminRevokeAllURLs();
}

async function resetTournamentDrawOnly() {
    const tournId = state.activeTournamentId;
    if (!tournId) return;

    try {
        await api.resetDrawOnly(tournId);

        state.rounds = [];
        state.teams = (state.teams || []).map(team => ({
            ...team,
            wins: 0,
            total_points: 0,
            broke: false,
            seed: null,
            eliminated: false,
            break_ineligible: false,
            break_ineligible_reason: null,
            category_breaks: {}
        }));
        showNotification('Tournament draw reset', 'success');
    } catch (err) {
        showNotification(`Reset failed: ${err.message}`, 'error');
    }
}

async function fullTournamentWipe() {
    return fullReset();
}

// ============================================================================
// INIT — register all functions on window
// ============================================================================
export function initAdminDashboard() {
    window._brkSelectedCat = window._brkSelectedCat ?? '';
    window.renderAdminDashboard      = renderAdminDashboard;
    window.adminSwitchSection        = adminSwitchSection;
    window.adminCreateRound          = adminCreateRound;
    window.refreshAdminRounds        = _refreshAdminRounds;
    window.displayAdminRounds        = displayAdminRounds;
    window.adminCalculateBreak       = adminCalculateBreak;
    window.adminPreviewBreak         = adminPreviewBreak;
    window.adminConfirmBreak         = adminConfirmBreak;
    window.adminToggleIneligible     = adminToggleIneligible;
    window.adminSetIneligibleReason  = adminSetIneligibleReason;
    window.adminTogglePublish        = adminTogglePublish;
    window.adminPublishAll           = adminPublishAll;
    window.adminHideAll              = adminHideAll;
    window.adminDeleteRound          = adminDeleteRound;
    window.adminConfirmFullWipe      = adminConfirmFullWipe;
    window.adminResetURLs             = adminResetURLs;
    window._adminGenJudgeURL         = _adminGenJudgeURL;
    window._adminGenTeamURL          = _adminGenTeamURL;
    window._adminRevokeJudgeURL      = _adminRevokeJudgeURL;
    window._adminRevokeTeamURL       = _adminRevokeTeamURL;
    window._adminCopyURL             = _adminCopyURL;
    window._adminSendURL             = _adminSendURL;
    window._adminGenAllJudgeURLs     = _adminGenAllJudgeURLs;
    window._adminGenAllTeamURLs      = _adminGenAllTeamURLs;
    window._adminBulkSendURLs        = _adminBulkSendURLs;
    window._adminRevokeAllURLs       = _adminRevokeAllURLs;
    window._adminRevokeAllJudgeURLs  = _adminRevokeAllJudgeURLs;
    window._adminRevokeAllTeamURLs   = _adminRevokeAllTeamURLs;
    window.showResetConfirmation     = showResetConfirmation;
    window.exportData                = exportData;
    window.resetTournamentDrawOnly   = resetTournamentDrawOnly;
    window.fullTournamentWipe        = fullTournamentWipe;

    // Hamburger sidebar toggle — mobile only
    window.toggleAdmSidebar = function() {
        const sidebar  = document.getElementById('adm-sidebar');
        const overlay  = document.getElementById('adm-sidebar-overlay');
        if (!sidebar) return;
        const nowOpen = sidebar.classList.toggle('adm-sidebar--open');
        overlay?.classList.toggle('adm-sidebar--open', nowOpen);
        document.body.style.overflow = nowOpen ? 'hidden' : '';
    };
    window.closeAdmSidebar = function() {
        document.getElementById('adm-sidebar')?.classList.remove('adm-sidebar--open');
        document.getElementById('adm-sidebar-overlay')?.classList.remove('adm-sidebar--open');
        document.body.style.overflow = '';
    };

    // Format hint switcher — updates description card under the create-tournament form
    window._admShowFormatHint = function(format) {
        const el = document.getElementById('adm-format-hint');
        if (!el) return;
        const hints = {
            standard: { cls: 'adm-format-hint--standard', icon: '🏛️', html: '<strong>WSDC / Standard</strong> — Teams compete head-to-head each round. Standings track wins, total speaker points, and averages per team.' },
            bp:       { cls: 'adm-format-hint--bp',       icon: '⚖️', html: '<strong>British Parliamentary</strong> — Four teams per room ranked 1st–4th. Standings use points (3/2/1/0) per round.' },
            speech:   { cls: 'adm-format-hint--speech',   icon: '🎤', html: '<strong>Speech Tournament</strong> — Tracks <em>individual speaker scores</em> per round rather than team wins. Perfect for public speaking competitions and oratory events. The public <strong>Speech tab</strong> shows a live per-speaker leaderboard with round-by-round scores and optional category sub-tabs.' }
        };
        const h = hints[format] || hints.standard;
        el.className = 'adm-format-hint ' + h.cls;
        el.innerHTML = '<span class="adm-format-hint__icon">' + h.icon + '</span><div>' + h.html + '</div>';
    };

    // Draw selector memory helper
    window._admSaveDrawPref = function(key, value) {
        try {
            const prefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}');
            prefs[key] = value;
            localStorage.setItem('orion_draw_prefs', JSON.stringify(prefs));
        } catch(e) {}
    };

    /**
     * isTabVisible(tabId)
     * Central tab-visibility check used by the main app's nav and tab renderers.
         */
    window.isTabVisible = function(tabId) {
        const role    = state.auth?.currentUser?.role;
        const isAdmin = role === 'admin';
        // Admin always has access regardless of publish state
        if (isAdmin) return true;
        // Published tabs are publicly accessible — no login required
        if (state.publish?.[tabId]) return true;
        return false;
    };

    // Tournament management
    window.adminCreateTournament         = () => adminCreateTournamentWithOpt(true);
    window.adminCreateTournamentNoSwitch = () => adminCreateTournamentWithOpt(false);
    window.adminSwitchTournament         = adminSwitchTournament;
    window.adminRenameTournament         = adminRenameTournament;
    window.adminDeleteTournament         = adminDeleteTournament;

    // Break section tab switcher 
    window._brkTab = function(tab) {
        ['all','breaking','inelig'].forEach(function(id) {
            const pane = document.getElementById('brk-pane-' + id);
            const btn  = document.getElementById('brk-tab-' + id);
            if (!pane || !btn) return;
            const active = id === tab;
            pane.style.display = active ? 'block' : 'none';
            pane.classList.toggle('is-active', active);
            btn.classList.toggle('brk-tab-active', active);
        });
    };
}
