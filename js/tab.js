// ============================================
// ENHANCED TAB MANAGEMENT
// ============================================

import { state } from './state.js';
import { updatePublicCounts, escapeHTML, teamCode } from './utils.js';
import { renderFeedback } from './feedback.js';
import { renderJudgePortal } from './portal.js';
import { renderTeams } from './teams.js';
import { renderJudges } from './judges.js';
import { renderDraw } from './draw.js';
import { renderBreak, renderKnockout } from './knockout.js';
import { renderImport } from './file-manager.js';
import { renderSpeakerStandings } from './speakers.js';
import { getCategories, getCategoryById, teamMatchesCategory } from './categories.js';

// ============================================
// MAIN TAB SWITCHING FUNCTION
// ============================================

const _TAB_META = {
    teams:           { icon: '👥', label: 'Teams',            blurb: 'Manage registered teams and their speakers.' },
    judges:          { icon: '⚖️', label: 'Judges',           blurb: 'Manage judges, roles, and conflict affiliations.' },
    import:          { icon: '📂', label: 'Import / Export',  blurb: 'Import tournament data or export results.' },
    draw:            { icon: '🎯', label: 'Draw',             blurb: 'View room assignments and pairings for each round.' },
    standings:       { icon: '📊', label: 'Standings',        blurb: 'See the current team standings and rankings.' },
    speakers:        { icon: '🎤', label: 'Speaker Tab',      blurb: 'Individual speaker scores and rankings.' },
    results:         { icon: '🏅', label: 'Results',          blurb: 'Full debate results and scorecards.' },
    break:           { icon: '🏆', label: 'Break',            blurb: 'Teams advancing to the knockout stage.' },
    knockout:        { icon: '🔥', label: 'Knockout',         blurb: 'Knockout bracket and elimination rounds.' },
    motions:         { icon: '📋', label: 'Motions',          blurb: 'All round motions and topics.' },
    portal:          { icon: '📝', label: 'Judge Portal',     blurb: 'Submit and manage ballots for your assigned debates.' },
    'admin-dashboard': { icon: '⚙️', label: 'Admin Dashboard', blurb: 'Tournament administration — restricted to admins.' },
};

// ============================================
// STANDINGS FILTER — plain object, intentionally NOT on state.
// Keeping it here means the reactive state proxy can never intercept
// reads/writes, so no watcher fires while the user is typing.
// ============================================
const _sf = { status: 'all', search: '' };

// ============================================
// CATEGORY FILTER STATE
// ============================================

const _catFilter = { speakers: null, standings: null, break: null };
window._orionCatFilter = _catFilter;

function switchCategoryTab(tabType, catId) {
    _catFilter[tabType] = catId || null;
    window._orionCatFilter = _catFilter;
    switchTab(tabType);
}

function updateNavDropdowns() {
    const cats = getCategories();
    _rebuildSpeakersNav(cats);
    _rebuildStandingsNav(cats);
    _rebuildOutroundsNav(cats);
}

// ── Shared category nav builder ────────────────────────────────────────────────
// Builds a dropdown group with an "All" option plus one button per category.
// groupId       – element id of the <div class="dropdown-group"> to replace
// tabType       – first arg to switchCategoryTab (e.g. 'speakers', 'standings', 'break')
// baseLabel     – label for the "All" option (e.g. 'All Speakers')
// allTrigger    – trigger button text when no cats exist (e.g. '🎤 Speakers')
// extraItems    – optional HTML string appended inside the dropdown (e.g. Knockout link)
function _rebuildCategoryNav(groupId, tabType, allTrigger, baseLabel, extraItems = '') {
    const grp = document.getElementById(groupId);
    if (!grp) return;
    const cats = getCategories();
    if (cats.length === 0) {
        grp.innerHTML = `<button class="dropdown-trigger" onclick="window.switchTab('${tabType}')">${allTrigger}</button>${extraItems}`;
    } else {
        const catButtons = cats.map(cat =>
            `<button class="dropdown-item" onclick="window.switchCategoryTab('${tabType}','${cat.id}')">${cat.icon} ${escapeHTML(cat.name)}</button>`
        ).join('');
        grp.innerHTML =
            `<button class="dropdown-trigger">${allTrigger} \u25be</button>` +
            `<div class="dropdown-content">` +
            `<button class="dropdown-item" onclick="window.switchCategoryTab('${tabType}',null)">🌐 ${baseLabel}</button>` +
            `<div class="dropdown-divider" style="border-top:1px solid #e2e8f0;margin:4px 0;"></div>` +
            catButtons + extraItems +
            `</div>`;
    }
}

function _rebuildSpeakersNav(cats) {
    _rebuildCategoryNav('speakers-nav-group', 'speakers', '🎤 Speakers', 'All Speakers');
}

function _rebuildStandingsNav(cats) {
    _rebuildCategoryNav('standings-nav-group', 'standings', '📊 Standings', 'All Teams');
}

function _rebuildOutroundsNav(cats) {
    const knockoutLink =
        `<div class="dropdown-divider" style="border-top:1px solid #e2e8f0;margin:4px 0;"></div>` +
        `<button class="dropdown-item" onclick="window.switchTab('knockout')">⚔️ Knockout</button>`;
    _rebuildCategoryNav('outrounds-nav-group', 'break', 'All Break', knockoutLink);
}

window.switchCategoryTab  = switchCategoryTab;
window.updateNavDropdowns = updateNavDropdowns;



function _renderLockedPage(containerId, reason) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const meta   = _TAB_META[containerId] || { icon: '🔒', label: 'This Page', blurb: '' };
    const isAuth = state.auth?.isAuthenticated && state.auth?.currentUser;

    let headline, sub, btnHtml, badgeClass, badgeText;

    if (reason === 'admin-only') {
        headline   = 'Admin Access Only';
        badgeClass = 'locked-badge locked-badge--danger';
        badgeText  = '🔒 Restricted';
        sub        = `<strong>${meta.label}</strong> is restricted to tournament administrators. You are logged in as <strong>${state.auth?.currentUser?.role || 'guest'}</strong>.`;
        btnHtml    = `<button onclick="window.switchTab('public')" class="btn btn-secondary btn-sm">← Back to Home</button>`;
    } else if (reason === 'not-published') {
        headline   = 'Not Available Yet';
        badgeClass = 'locked-badge locked-badge--warning';
        badgeText  = '⏳ Coming Soon';
        sub        = `The admin hasn't published <strong>${meta.label}</strong> yet. Check back later.`;
        btnHtml    = isAuth
            ? `<button onclick="window.switchTab('public')" class="btn btn-secondary btn-sm">← Back to Home</button>`
            : `<button data-action="showLoginModal" class="btn btn-primary btn-sm">Login</button>
               <button onclick="window.switchTab('public')" class="btn btn-secondary btn-sm">← Back to Home</button>`;
    } else {
        headline   = 'Login to View';
        badgeClass = 'locked-badge locked-badge--info';
        badgeText  = '🔑 Login Required';
        sub        = `You need to be logged in to view <strong>${meta.label}</strong>. ${meta.blurb}`;
        btnHtml    = `<button data-action="showLoginModal" class="btn btn-primary btn-sm">🔑 Login</button>
                      <button onclick="window.switchTab('public')" class="btn btn-secondary btn-sm">← Back to Home</button>`;
    }

    container.innerHTML = `
        <div class="locked-page">
            <div class="locked-page__inner">
                <div class="locked-page__icon">${meta.icon}</div>
                <span class="${badgeClass}">${badgeText}</span>
                <h2 class="locked-page__heading">${headline}</h2>
                <p class="locked-page__sub">${sub}</p>
                <div class="locked-page__actions">${btnHtml}</div>
            </div>
        </div>`;
}

function switchTab(tabId) {
    console.log('Switching to tab:', tabId);

    // ── Role & Publish guard ──────────────────────────────────────────────────
    // Re-read auth from state on every call — never rely on a cached variable.
    const sess    = state.auth;
    const isAdmin = sess?.currentUser?.role === 'admin';
    const isJudge = sess?.currentUser?.role === 'judge';
    const isAuth  = !!(sess?.isAuthenticated && sess?.currentUser);

    let lockedReason = null;
    const originalTabId = tabId;

    // Management tabs — admin only
    const adminOnlyTabs = ['judges', 'import', 'admin-dashboard'];
    if (adminOnlyTabs.includes(tabId) && !isAdmin) {
        lockedReason = isAuth ? 'admin-only' : 'login-required';
    }

    // Teams tab — admin sees all, team role sees own team, others are blocked
    if (!lockedReason && tabId === 'teams') {
        const role = sess?.currentUser?.role;
        if (!isAdmin && role !== 'team') {
            lockedReason = isAuth ? 'admin-only' : 'login-required';
        }
    }

    // Published-content tabs (draw, standings, speakers, etc.)
    //
    // Rules:
    //  • Admin         → always visible, no publish check.
    //  • Logged-in     → always visible regardless of publish state.
    //                    (judges/teams need to see their data whether or not
    //                     the admin has flipped the public publish toggle)
    //  • Guest / unauth → only visible when the admin has published the tab.
    const publishedTabs = ['draw', 'standings', 'speakers', 'break', 'knockout', 'motions', 'results'];
    if (!lockedReason && publishedTabs.includes(tabId) && !isAdmin && !isAuth) {
        const published = (state.publish || {})[tabId];
        if (!published) {
            lockedReason = 'not-published';
        }
    }

    // Judge portal — requires judge or admin login
    if (tabId === 'portal' && !isAdmin && !isJudge) {
        lockedReason = isAuth ? 'admin-only' : 'login-required';
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Toggle admin-mode chrome ONLY for authenticated admins on the dashboard.
    const hideChrome = (tabId === 'admin-dashboard') && isAdmin && !lockedReason;
    document.body.classList.toggle('admin-mode', hideChrome);
    const siteHeader = document.querySelector('header');
    const publicNav  = document.querySelector('.dropdown-menu-container');
    if (siteHeader) siteHeader.classList.toggle('nav--hidden', hideChrome);
    if (publicNav)  publicNav.classList.toggle('nav--hidden', hideChrome);

    // Hide all tab contents + deactivate buttons
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
        tab.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const displayTabId = lockedReason ? originalTabId : tabId;
    const selectedTab  = document.getElementById(displayTabId);

    if (selectedTab) {
        selectedTab.classList.add('active');
        selectedTab.style.display = 'block';

        // Highlight nav button
        document.querySelectorAll('.tab-btn').forEach(btn => {
            const t = btn.textContent.toLowerCase();
            if (t.includes(displayTabId) || (displayTabId === 'admin-dashboard' && t.includes('admin'))) {
                btn.classList.add('active');
            }
        });

        if (lockedReason) {
            _renderLockedPage(displayTabId, lockedReason);
            return;
        }

        // Normal render
        switch (tabId) {
            case 'public':
                if (typeof updatePublicCounts === 'function') updatePublicCounts();
                break;
            case 'standings':
                renderStandings();
                break;
            case 'admin-dashboard':
                if (typeof window.renderAdminDashboard === 'function') {
                    window.renderAdminDashboard();
                }
                break;
            case 'motions':
                renderMotions();
                break;
            case 'results':
                renderResults();
                break;
            case 'profile':
                if (typeof window.renderProfile === 'function') window.renderProfile();
                break;
            case 'feedback':
                if (typeof renderFeedback === 'function') renderFeedback();
                break;
            case 'portal':
                if (typeof renderJudgePortal === 'function') renderJudgePortal();
                break;
            case 'teams':
                if (typeof renderTeams === 'function') renderTeams();
                break;
            case 'judges':
                if (typeof renderJudges === 'function') renderJudges();
                break;
            case 'draw':
                if (typeof renderDraw === 'function') renderDraw();
                break;
            case 'break':
                renderBreakDisplay();
                break;
            case 'knockout':
                if (typeof renderKnockout === 'function') renderKnockout();
                break;
            case 'import':
                if (typeof renderImport === 'function') renderImport();
                break;
            case 'speakers':
                // Pass category filter to speakers.js via global
                window._orionCatFilter = _catFilter;
                if (typeof renderSpeakerStandings === 'function') renderSpeakerStandings();
                break;
            default:
                console.log(`No render function for tab: ${tabId}`);
        }
        setTimeout(() => {
            window.syncGlobalSearchForActiveTab?.();
            window.applyGlobalSearch?.();
        }, 0);
    } else {
        console.error(`Tab with id "${tabId}" not found`);
    }
}

// ============================================
// UPDATE TABS BASED ON USER ROLE
// ============================================

function updateTabsForRole() {
    const isAuth = state.auth?.isAuthenticated && state.auth?.currentUser;
    const role = state.auth?.currentUser?.role || 'public';

    // ── FIX: Move tabNames definition to the top of the function ──
    const tabNames = {
        public: '🏠 Public',       standings: '📊 Standings',
        motions: '📋 Motions',     profile: '👤 Profile',
        teams: '👥 Teams',         judges: '⚖️ Judges',
        draw: '🎯 Draw',           break: '📈 Break',
        knockout: '🏆 Knockout',   import: '📥 Import',
        feedback: '💬 Feedback',   portal: '🚪 Portal',
        speakers: '🗣️ Speakers',   results: '💹 Results',
        admin: '⚙️ Admin',
    };
    tabNames['admin-dashboard'] = tabNames.admin;

    const rolePermissions = {
        admin: {
            teams: true, judges: true, draw: true, break: true,
            knockout: true, import: true, portal: true, feedback: true,
            speakers: true, results: true, 'admin-dashboard': true
        },
        judge: {
            portal: true, draw: true, speakers: true, results: true,
            break: false, knockout: false, teams: false, judges: false, import: false
        },
        team: {
            draw: true, speakers: true,
            results: false, teams: false, judges: false, import: false
        },
        public: {
            speakers: true,
            results: false, teams: false, judges: false, draw: false, import: false
        }
    };

    const tabs = {
        public: true,
        standings: true,
        motions: true,
        results: true,
        profile: isAuth,
        teams: true, judges: true, draw: true, break: true,
        knockout: true, import: true, portal: true, feedback: true,
        speakers: true, 'admin-dashboard': true
    };

    const tabsContainer = document.querySelector('.tabs');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    const tabOrder = ['public', 'teams', 'judges', 'standings', 'speakers', 'motions', 'results', 'draw', 'break', 'knockout', 'feedback', 'portal', 'import', 'admin-dashboard'];

    const mainContent = document.querySelector('main');

    tabOrder.forEach(id => {
        if (tabs[id]) {
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.textContent = tabNames[id];
            btn.onclick = () => switchTab(id);
            tabsContainer.appendChild(btn);

            if (!document.getElementById(id) && mainContent) {
                createTabContent(id, mainContent);
            }
        }
    });

    const activeTab = document.querySelector('.tab-content.active')?.id || 'public';
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.textContent.includes(tabNames[activeTab])) {
            btn.classList.add('active');
        }
    });

    // Rebuild nav dropdowns now that we know the auth state
    updateNavDropdowns();
}

// ============================================
// CREATE TAB CONTENT
// ============================================

function createTabContent(id, mainContent) {
    const tabDiv = document.createElement('div');
    tabDiv.id = id;
    tabDiv.className = 'tab-content';

    switch (id) {
        case 'speakers':
            tabDiv.innerHTML = '<div id="speaker-rankings"></div>';
            break;
        default:
            tabDiv.innerHTML = `<div id="${id}-container"></div>`;
    }

    mainContent.appendChild(tabDiv);
}

// ============================================
// RENDER MOTIONS TAB
// ============================================

function renderMotions() {
    const container = document.getElementById('motions');
    if (!container) return;

    const allRounds = [...(state.rounds || [])].sort((a, b) => (b.id || 0) - (a.id || 0));
    const isAdmin   = state.auth?.currentUser?.role === 'admin';

    let html = `
        <div class="section">
            <div class="standings-header">
                <h2 class="u-mt-0">Round Motions</h2>
                ${isAdmin ? `<button onclick="window.showAddMotionModal?.()" class="btn btn-primary btn-sm">Add Motion</button>` : ''}
            </div>
            <p class="u-text-muted u-mb-xl">All motions from the tournament</p>
    `;

    if (allRounds.length === 0) {
        html += `
            <div class="empty-state">
                <div class="empty-state__icon">📋</div>
                <h3 class="empty-state__title">No Motions Yet</h3>
                <p class="empty-state__desc">Motions will appear here as rounds are created</p>
            </div>
        `;
    } else {
        allRounds.forEach(round => {
            if (!round) return;
            const roundId   = round.id || '?';
            const roundType = round.type || 'prelim';
            const debates   = round.debates || [];
            const isBlinded = round.blinded || false;

            html += `
                <div class="motion-card">
                    <div class="motion-card__header">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div class="motion-card__badge motion-card__badge--${roundType === 'knockout' ? 'knockout' : 'prelim'}">${roundId}</div>
                            <div>
                                <h3 class="u-mt-0 u-mb-0">Round ${roundId} ${roundType === 'knockout' ? '🏆 Knockout' : ''}</h3>
                                <p class="u-text-muted u-mb-0" style="font-size:14px;">
                                    ${debates.length} debates &bull;
                                    ${isBlinded ? '🔒 Blinded' : '👁️ Public'}
                                </p>
                            </div>
                        </div>
                        ${isBlinded ? '<span class="badge badge-warning">Results Hidden</span>' : ''}
                    </div>
                    <div class="motion-card__body">
                        <div class="motion-card__text">"${escapeHTML(round.motion || 'TBD')}"</div>
                        ${round.infoslide ? `
                            <div class="motion-card__infoslide">
                                <strong class="u-text-primary">📌 Info Slide:</strong> ${escapeHTML(round.infoslide)}
                            </div>
                        ` : ''}
                        ${isAdmin ? `
                            <div class="u-mt-lg">
                                <button onclick="window.showEditMotionModal?.(${state.rounds.indexOf(round)})" class="btn btn-secondary btn-xs">✏️ Edit Motion</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
    }

    html += `</div>`;
    container.innerHTML = html;
}

// ============================================
// RENDER STANDINGS WITH FILTERS
// ============================================

function renderStandings() {
    const container = document.getElementById('standings');
    if (!container) return;

    // _sf is a plain module-level object — no proxy involvement

    // Category filter (set by switchCategoryTab)
    const catId  = _catFilter.standings || null;
    const catObj = catId ? getCategoryById(catId) : null;

    const allRounds = [...(state.rounds || [])]
        .filter(r => r && r.type === 'prelim')
        .sort((a, b) => (a.id || 0) - (b.id || 0));

    let ranked = [...(state.teams || [])].sort((a, b) =>
        ((b.wins || 0) - (a.wins || 0)) ||
        ((b.total || 0) - (a.total || 0))
    );

    // Apply category filter before other filters
    if (catId) {
        ranked = ranked.filter(t => teamMatchesCategory(t, catId));
    }

    ranked = applyStandingsFilters(ranked, _sf, allRounds);

    let html = buildStandingsHeader(_sf, catObj);
    html += buildStandingsTable(ranked, allRounds);

    container.innerHTML = html;
}

// ============================================
// STANDINGS HELPER FUNCTIONS
// ============================================

function applyStandingsFilters(teams, filter, allRounds) {
    return teams.filter(team => {
        if (filter.status !== 'all') {
            if (filter.status === 'active'      && (team.eliminated || team.broke)) return false;
            if (filter.status === 'broke'        && !team.broke)                    return false;
            if (filter.status === 'eliminated'   && !team.eliminated)               return false;
        }
        if (filter.search) {
            const s = filter.search.toLowerCase();
            if (!(team.name||'').toLowerCase().includes(s) && !(team.code||'').toLowerCase().includes(s)) return false;
        }
        return true;
    });
}

function buildStandingsHeader(filter, catObj = null) {
    const hasFilters = filter.status !== 'all';
    return `
        <div class="section">
            <div class="standings-header">
                <div class="standings-title-group">
                    <div class="standings-title-row">
                        <h2 class="u-mt-0">Team Standings</h2>
                    ${catObj ? `<span class="standings-category-pill" style="background:${catObj.color}18;border-color:${catObj.color}50;color:${catObj.color};">${catObj.icon} ${escapeHTML(catObj.name)}</span>
                        <button onclick="window.switchCategoryTab('standings',null)" class="btn btn-ghost btn-xs" title="Show all">✕ Clear filter</button>` : ''}
                    </div>
                    <p class="section-subtitle compact">Current team rankings, records, and round-by-round movement.</p>
                </div>
                <button onclick="window.exportStandings?.()" class="btn btn-secondary btn-sm">📥 Export</button>
            </div>
            <div class="standings-filter-bar">
                <div class="standings-filter-group standings-filter-group--fixed">
                    <label class="standings-filter-label">Status</label>
                    <select id="status-filter" class="standings-filter-select"
                            onchange="window.updateStandingsFilter('status',this.value)">
                        <option value="all"       ${filter.status==='all'       ? 'selected' : ''}>All Teams</option>
                        <option value="active"    ${filter.status==='active'    ? 'selected' : ''}>Active Only</option>
                        <option value="broke"     ${filter.status==='broke'     ? 'selected' : ''}>Breaking Teams</option>
                        <option value="eliminated"${filter.status==='eliminated'? 'selected' : ''}>Eliminated</option>
                    </select>
                </div>
                ${hasFilters ? `<button onclick="window.resetStandingsFilter()" class="btn btn-secondary btn-xs">🔄 Reset</button>` : ''}
            </div>
    `;
}

function buildStandingsTable(ranked, allRounds) {
    if (ranked.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-state__icon">🔍</div>
                <h3 class="empty-state__title">No Teams Found</h3>
                <p class="empty-state__desc">Try adjusting your filters</p>
            </div>
        `;
    }

    const _role = state.auth?.currentUser?.role;
    const canSeeCode = _role === 'admin' || _role === 'judge';

    let html = `
        <div class="table-wrap">
            <table class="data-table data-table--dark-head">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Team</th>
                        ${canSeeCode ? '<th>Code</th>' : ''}
    `;

    allRounds.forEach(round => {
        html += `<th class="th-center">R${round.id}</th>`;
    });

    html += `
                        <th class="th-center th-accent" style="min-width:50px;">Wins</th>
                        <th class="th-center th-accent" style="min-width:60px;">Total</th>
                        <th class="th-center" style="min-width:50px;">Avg</th>
                        <th class="th-center" style="min-width:80px;">Status</th>
                    </tr>
                </thead>
                <tbody>
    `;

    ranked.forEach((team, index) => {
        const roundsPlayed = Object.keys(team.roundScores || {}).length;
        const teamAvg      = roundsPlayed > 0 ? ((team.total || 0) / roundsPlayed) : 0;
        const missedRounds = allRounds.length - roundsPlayed;

        let rankDisplay = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`;

        const tournamentOver = !!(state.tournament?.champion);
        let statusBadge = '<span class="status-active">Active</span>';
        if (!tournamentOver) {
            if (team.eliminated) {
                statusBadge = '<span class="status-eliminated">Eliminated</span>';
            } else if (team.broke) {
                statusBadge = `<span class="status-broke">Broke ${team.seed || ''}</span>`;
            }
        }

        html += `<tr>
            <td class="td-rank">${rankDisplay}</td>
            <td>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <strong>${escapeHTML(team.name)}</strong>
                    ${missedRounds > 0 ? `<span class="status-missed">⚠️ ${missedRounds} missed</span>` : ''}
                    ${team.breakIneligible ? `
                    <span class="inelig-wrap">
                        <span class="status-inelig">🚫 Ineligible</span>
                        ${team.breakIneligibleReason ? `<span class="inelig-tip">${escapeHTML(team.breakIneligibleReason)}</span>` : ''}
                    </span>` : ''}
                </div>
            </td>
            ${canSeeCode ? `<td><span class="badge badge-mono">${escapeHTML(teamCode(team))}</span></td>` : ''}
        `;

        allRounds.forEach(round => {
            const roundScore = team.roundScores?.[round.id];
            const roundData  = (state.rounds || []).find(r => r && r.id === round.id);
            const isBlinded  = roundData?.blinded || false;

            if (roundScore !== undefined) {
                html += `<td class="td-score">${isBlinded ? '🔒' : roundScore.toFixed(1)}</td>`;
            } else {
                html += `<td class="td-muted">—</td>`;
            }
        });

        html += `
            <td class="td-wins">${team.wins || 0}</td>
            <td class="td-total">${(team.total || 0).toFixed(1)}</td>
            <td class="td-avg">${teamAvg.toFixed(1)}</td>
            <td class="td-center">${statusBadge}</td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
}

// ============================================
// STANDINGS FILTER FUNCTIONS
// ============================================

// ── Search buffer ────────────────────────────────────────────────────────────
// We keep the in-flight search string here and NEVER write it to state until
// the debounce fires. This means the reactive proxy is never touched while the
// user is typing, so no watcher can trigger a premature re-render.
// Search is buffered in _pendingSearch — _sf.search is only written
// after the user stops typing, so the UI never updates mid-keystroke.
let _pendingSearch = '';
let _searchTimer   = null;

function updateStandingsFilter(key, value) {
    if (key === 'search') {
        _pendingSearch = value;             // local buffer — no state write
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => {
            _sf.search = _pendingSearch;    // plain object, not state proxy
            renderStandings();
        }, 350);
    } else {
        _sf[key] = value;                   // status/category — instant
        renderStandings();
    }
}

function resetStandingsFilter() {
    _sf.status = 'all';
    renderStandings();
    window.applyGlobalSearch?.();
}

// ============================================
// RENDER RESULTS TAB
// ============================================

function renderResults() {
    const container = document.getElementById('results');
    if (!container) return;

    const allRounds  = [...(state.rounds || [])].sort((a, b) => (b.id || 0) - (a.id || 0));
    const hasResults = allRounds.some(r => r.debates?.some(d => d.entered));

    let html = `
        <div class="section">
            <div class="standings-header">
                <h2 class="u-mt-0">Debate Results</h2>
            </div>
            <p class="u-text-muted u-mb-xl">Complete results from all debates</p>
    `;

    if (allRounds.length === 0) {
        html += `
            <div class="empty-state">
                <div class="empty-state__icon">🎯</div>
                <h3 class="empty-state__title">No Results Yet</h3>
                <p class="empty-state__desc">Results will appear here as debates are completed</p>
            </div>
        `;
    } else if (!hasResults) {
        html += `
            <div class="empty-state">
                <div class="empty-state__icon">⏳</div>
                <h3 class="empty-state__title">No Results Entered</h3>
                <p class="empty-state__desc">Results will appear once debates are completed</p>
            </div>
        `;
    } else {
        allRounds.forEach(round => {
            if (!round) return;
            const completedDebates = (round.debates || []).filter(d => d.entered);
            if (completedDebates.length === 0) return;

            const isBlinded = round.blinded || false;

            html += `
                <div class="result-card">
                    <div class="result-card__header">
                        <div>
                            <h2 class="u-mt-0 u-mb-sm">Round ${round.id} Results</h2>
                            <p class="u-text-muted u-mb-0">${completedDebates.length}/${round.debates.length} debates completed</p>
                        </div>
                        ${isBlinded ? '<span class="status-blinded">🔒 BLINDED</span>' : ''}
                    </div>
                    <div style="display:grid;gap:20px;">
            `;

            completedDebates.forEach(debate => {
                const gov = (state.teams || []).find(t => t && t.id === debate.gov);
                const opp = (state.teams || []).find(t => t && t.id === debate.opp);
                if (!gov || !opp) return;

                const govWin = (debate.govResults?.total || 0) > (debate.oppResults?.total || 0);

                html += `
                    <div class="result-debate">
                        <div class="result-debate__sides">
                            <div class="result-debate__team">
                                <div class="u-fw-700 ${!isBlinded && govWin ? 'result-debate__score--winner' : ''}">${escapeHTML(gov.name)}</div>
                                <div class="result-debate__score ${!isBlinded && govWin ? 'result-debate__score--winner' : ''}">
                                    ${!isBlinded ? debate.govResults?.total.toFixed(1) : '🔒'}
                                </div>
                            </div>
                            <div class="result-debate__vs">VS</div>
                            <div class="result-debate__team">
                                <div class="u-fw-700 ${!isBlinded && !govWin ? 'result-debate__score--winner' : ''}">${escapeHTML(opp.name)}</div>
                                <div class="result-debate__score ${!isBlinded && !govWin ? 'result-debate__score--winner' : ''}">
                                    ${!isBlinded ? debate.oppResults?.total.toFixed(1) : '🔒'}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `</div></div>`;
        });
    }

    html += `</div>`;
    container.innerHTML = html;
}

// ============================================
// BREAK TAB — display only, no controls
// ============================================
function renderBreakDisplay() {
    const container = document.getElementById('break-container');
    if (!container) return;

    // Category filter (set by switchCategoryTab)
    const catId  = _catFilter.break || null;
    const catObj = catId ? getCategoryById(catId) : null;
    const cats   = getCategories();

    let breaking = [...(state.teams || [])].filter(t => t.broke)
        .sort((a, b) => (a.seed || 999) - (b.seed || 999));

    // Apply category filter
    if (catId) {
        breaking = breaking.filter(t => teamMatchesCategory(t, catId));
    }

    // Category switcher bar (shown when multiple categories exist)
    const catBar = cats.length > 0 ? `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
            <span style="font-size:12px;color:#64748b;font-weight:500;">View:</span>
            <button onclick="window.switchCategoryTab('break',null)"
                style="border:1.5px solid ${!catId?'#1a73e8':'#e2e8f0'};border-radius:16px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;background:${!catId?'#1a73e8':'white'};color:${!catId?'white':'#64748b'};">
                All Break</button>
            ${cats.map(cat => `
            <button onclick="window.switchCategoryTab('break','${cat.id}')"
                style="background:${catId===cat.id?cat.color:cat.color+'15'};color:${catId===cat.id?'white':cat.color};border:1.5px solid ${cat.color}50;border-radius:16px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;">
                ${cat.icon} ${escapeHTML(cat.name)}</button>`).join('')}
        </div>` : '';

    if (breaking.length === 0) {
        container.innerHTML = catBar + `
            <div class="empty-state">
                <div class="empty-state__icon">🏆</div>
                <h3 class="empty-state__title">${catObj ? catObj.icon + ' ' + escapeHTML(catObj.name) + ' Break' : 'Break'} Not Yet Published</h3>
                <p class="empty-state__desc">The break will appear here once the admin has confirmed it.</p>
            </div>`;
        return;
    }

    const _bRole = state.auth?.currentUser?.role;
    const canSeeBreakCode = _bRole === 'admin' || _bRole === 'judge';

    const thead = `<thead><tr>
        <th>Seed</th><th>Team</th>${canSeeBreakCode ? '<th>Code</th>' : ''}
        <th class="th-center">Wins</th><th class="th-center">Points</th><th class="th-center">Avg</th>
    </tr></thead>`;

    const teamRow = (t, i) => {
        const rp  = Object.keys(t.roundScores || {}).length;
        const avg = rp > 0 ? ((t.total || 0) / rp).toFixed(1) : '—';
        return `<tr>
            <td class="td-rank u-text-warning u-fw-800" style="font-size:17px;">${t.seed || i + 1}</td>
            <td><strong>${escapeHTML(t.name)}</strong></td>
            ${canSeeBreakCode ? `<td><span class="badge badge-mono">${escapeHTML(teamCode(t))}</span></td>` : ''}
            <td class="td-wins">${t.wins || 0}</td>
            <td class="td-total">${(t.total || 0).toFixed(1)}</td>
            <td class="td-avg">${avg}</td>
        </tr>`;
    };

    // Detect partial break: tournament flag + at least one reserved team
    const isPartialBreak = state.tournament?.isPartial && breaking.some(t => t.reserved);

    if (isPartialBreak) {
        const byeTeams  = breaking.filter(t => t.reserved);
        const playTeams = breaking.filter(t => !t.reserved);
        container.innerHTML = catBar + `
            <div class="break-table-wrap" style="margin-bottom:24px;">
                <div class="break-table-header">
                    <div>
                        <h2 class="break-table-title">🏅 Direct Qualifiers — Bye</h2>
                        <p class="break-table-sub">${byeTeams.length} team${byeTeams.length !== 1 ? 's' : ''} advance directly to the knockout stage</p>
                    </div>
                    <span class="break-badge" style="background:#059669;">Top ${byeTeams.length}</span>
                </div>
                <div class="table-wrap">
                    <table class="data-table data-table--sm">${thead}<tbody>${byeTeams.map(teamRow).join('')}</tbody></table>
                </div>
            </div>
            <div class="break-table-wrap">
                <div class="break-table-header">
                    <div>
                        <h2 class="break-table-title">⚔️ Preliminary Elimination Round</h2>
                        <p class="break-table-sub">${playTeams.length} team${playTeams.length !== 1 ? 's' : ''} compete — winners advance to join the direct qualifiers</p>
                    </div>
                    <span class="break-badge" style="background:#d97706;">Seeds ${byeTeams.length + 1}–${breaking.length}</span>
                </div>
                <div class="table-wrap">
                    <table class="data-table data-table--sm">${thead}<tbody>${playTeams.map(teamRow).join('')}</tbody></table>
                </div>
            </div>`;
    } else {
        const titleLabel = catObj
            ? catObj.icon + ' ' + escapeHTML(catObj.name) + ' Break'
            : '🏆 Breaking Teams';
        container.innerHTML = catBar + `
            <div class="break-table-wrap">
                <div class="break-table-header">
                    <div>
                        <h2 class="break-table-title">${titleLabel}</h2>
                        <p class="break-table-sub">${breaking.length} team${breaking.length !== 1 ? 's' : ''} advancing to the knockout stage</p>
                    </div>
                    <span class="break-badge">Top ${breaking.length}</span>
                </div>
                <div class="table-wrap">
                    <table class="data-table data-table--sm">${thead}<tbody>${breaking.map(teamRow).join('')}</tbody></table>
                </div>
            </div>`;
    }
}
window.renderBreakDisplay = renderBreakDisplay;
window.renderMotions = renderMotions;
window.switchTab = switchTab;

// ============================================
// THEME SYSTEM
// ============================================

const THEMES = {
    default:      { label: '🎨 Default',      vars: {} },
    dark:         { label: '🌙 Dark',          vars: { '--clr-bg': '#0f172a', '--clr-surface': '#1e293b', '--clr-text': '#f1f5f9', '--clr-border': '#334155', '--clr-primary': '#3b82f6' } },
    highcontrast: { label: '♿ High Contrast', vars: { '--clr-bg': '#000000', '--clr-surface': '#111111', '--clr-text': '#ffffff', '--clr-border': '#ffffff', '--clr-primary': '#ffff00' } },
    warm:         { label: '🌅 Warm',          vars: { '--clr-bg': '#fef9f0', '--clr-surface': '#fff8ec', '--clr-text': '#292524', '--clr-border': '#d6c4a1', '--clr-primary': '#c2410c' } },
    cool:         { label: '🌊 Cool',          vars: { '--clr-bg': '#f0f9ff', '--clr-surface': '#e0f2fe', '--clr-text': '#0c4a6e', '--clr-border': '#7dd3fc', '--clr-primary': '#0284c7' } },
};

function applyTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.default;
    const root  = document.documentElement;
    Object.values(THEMES).forEach(t => Object.keys(t.vars).forEach(k => root.style.removeProperty(k)));
    Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    document.body.classList.toggle('theme-dark', themeId === 'dark' || themeId === 'highcontrast');
    try { localStorage.setItem('orion_theme', themeId); } catch(e) {}
}

function renderThemePicker(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const saved = (() => { try { return localStorage.getItem('orion_theme') || 'default'; } catch(e) { return 'default'; } })();
    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <label class="standings-filter-label">🎨 Theme:</label>
            <select onchange="window.applyTheme(this.value)" class="standings-filter-select" style="width:auto;">
                ${Object.entries(THEMES).map(([id, t]) => `<option value="${id}" ${id === saved ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
        </div>`;
}

// Auto-apply saved theme on load
try {
    const savedTheme = localStorage.getItem('orion_theme');
    if (savedTheme && savedTheme !== 'default') applyTheme(savedTheme);
} catch(e) {}

window.applyTheme      = applyTheme;
window.renderThemePicker = renderThemePicker;

// ============================================
// EXPORT ALL FUNCTIONS
// ============================================

export {
    switchTab,
    updateTabsForRole,
    updateNavDropdowns,
    renderStandings,
    updateStandingsFilter,
    resetStandingsFilter,
    renderMotions,
    renderResults,
    renderSpeakerStandings,
    renderBreakDisplay,
    switchCategoryTab,
};
