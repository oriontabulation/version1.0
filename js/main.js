console.log('[main.js] Module loading...');

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (window.ENV || {});

// Global error handler to prevent blank screen on errors
window.addEventListener('error', (e) => {
    console.error('[global] Uncaught error:', e.error);
    // Show visible error to user
    const errDiv = document.getElementById('init-error');
    if (errDiv) {
        errDiv.style.display = 'block';
        errDiv.textContent = 'Error: ' + (e.error?.message || e.message);
    }
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('[global] Unhandled rejection:', e.reason);
});

// ============================================================
// MAIN.JS — Application entry point (refactored)
//
// KEY CHANGES:
//   - Startup reads from Supabase via api.js (not localStorage)
//   - window.X assignments replaced by registerActions()
//   - exposeOnWindow() only for legacy onclick shims (marked for removal)
//   - Role check uses JWT (via supabase-auth.js _applyProfileToState)
// ============================================================

import { api } from './api.js';
import {
    hydrateState, state,
    restoreUIPrefs
} from './state.js';
import {
    cache, loadTeams,
    loadJudges, loadRounds
} from './cache.js';
import {
    restoreSession,
    updateHeaderControls,
    updateAdminNavVisibility,
    showLoginModal, logout,
    guestLogin, registerUser,
    handleLogin, switchAuthTab,
    handleRoleChange,
    renderProfile,
    renderInactivitySettings,
    setInactivityTimeoutMinutes,
    signInWithGoogle, signInWithDiscord, signInWithApple,
} from './supabase-auth.js';
import {
    initRouter,
    registerActions, registerTab,
    installDelegatedListener
} from './router.js';
import { supabase } from './supabase.js';
import { initImageOptimizations } from './image-optimizer.js';

// ── Tab render functions ──────────────────────────────────────────────────────
import {
    switchTab as _legacySwitchTab,
    renderStandings, renderMotions, renderResults,
    updateTabsForRole, updateNavDropdowns,
    switchCategoryTab, updateStandingsFilter
} from './tab.js';
import {
    renderTeams, displayTeams,
    addTeam, deleteTeam,
    showEditTeam, saveEditTeam,
    filterTeamsByCategory
} from './teams.js';
import {
    renderJudges, displayJudges,
    addJudge, deleteJudge,
    showEditJudge, saveEditJudge
} from './judges.js';
import {
    renderDraw, displayRounds, createRound,
    showJudgeManagement, addJudgeToPanel,
    removeJudgeFromPanel, showEnterResults,
    submitResults, toggleBlindRound,
    redrawRound, swapTeams, moveJudgeToPanel,
    executeMoveTeam, dndJudgeDragStart,
    dndJudgeDragOver, dndJudgeDrop,
    dndTeamDragStart, dndTeamDragOver,
    dndTeamDrop, dndDragEnd, dndDragLeave
} from './draw.js';
import {
    renderBreak, calculateBreak,
    generateKnockout, renderKnockout,
    enterKnockoutResult, submitKnockoutResult
} from './knockout.js';
import {
    renderAdminDashboard, adminSwitchSection,
    adminCreateRound, adminTogglePublish,
    adminPublishAll, adminHideAll,
    initAdminDashboard
} from './admin.js';
import {
    renderSpeakerStandings,
    toggleReplyColumn
} from './speakers.js';
import { renderFeedback } from './feedback.js';
import { renderJudgePortal, checkUrlForJudgeToken } from './portal.js';
import { renderParticipants, initParticipants } from './participants.js';
import {
    renderImport, importTeams, importJudges,
    exportData, exportStandings, exportTeams,
    exportSpeakerStandings, fullReset,
    previewTeams, previewJudges,
    clearTeamImport, clearJudgeImport
} from './file-manager.js';
import { generateCustomSampleData } from './sample.js';
import {
    showNotification, closeAllModals,
    updatePublicCounts, updateHeaderTournamentName
} from './utils.js';
// URL generation is handled exclusively in the Admin dashboard (admin.js)
// The old localStorage-based url functions are no longer imported here.

// ── Register all tab renderers ────────────────────────────────────────────────
registerTab('public', async () => { updatePublicCounts(); });
registerTab('standings', async () => { renderStandings(); });
registerTab('teams', async () => { renderTeams(); });
registerTab('judges', async () => { renderJudges(); });
registerTab('draw', async () => { renderDraw(); });
registerTab('speakers', async () => { renderSpeakerStandings(); });
registerTab('results', async () => { renderResults(); });
registerTab('motions', async () => { renderMotions(); });
registerTab('break', async () => { window.renderBreakDisplay?.(); });
registerTab('knockout', async () => { renderKnockout(); });
registerTab('import', async () => { renderImport(); });
registerTab('feedback', async () => { renderFeedback(); });
registerTab('portal', async () => { renderJudgePortal(); });
registerTab('profile', async () => { renderProfile(); });
registerTab('admin-dashboard', async () => {
    if (state.auth?.currentUser?.role === 'admin') renderAdminDashboard();
});

// ── Register all actions ──────────────────────────────────────────────────────
registerActions({
    // Auth
    showLoginModal, logout, guestLogin, registerUser, handleLogin,
    switchAuthTab, handleRoleChange, closeAllModals, renderProfile,
    renderInactivitySettings, setInactivityTimeoutMinutes,
    signInWithGoogle, signInWithDiscord, signInWithApple,

    // Nav
    navigate: _legacySwitchTab,
    switchTab: _legacySwitchTab, // guarded version — enforces role/publish checks

    // Teams
    renderTeams, displayTeams, addTeam, deleteTeam, showEditTeam, saveEditTeam, filterTeamsByCategory,

    // Judges
    renderJudges, displayJudges, addJudge, deleteJudge, showEditJudge, saveEditJudge,

    // Draw
    renderDraw, displayRounds, createRound, showJudgeManagement, addJudgeToPanel,
    removeJudgeFromPanel, showEnterResults, submitResults, toggleBlindRound, redrawRound,
    swapTeams, moveJudgeToPanel, executeMoveTeam,

    // DnD
    dndJudgeDragStart, dndJudgeDragOver, dndJudgeDrop,
    dndTeamDragStart, dndTeamDragOver, dndTeamDrop,
    dndDragEnd, dndDragLeave,

    // Break & Knockout
    renderBreak, calculateBreak, generateKnockout, renderKnockout,
    enterKnockoutResult, submitKnockoutResult,

    // Admin
    renderAdminDashboard, adminSwitchSection, adminCreateRound,
    'admin-section': adminSwitchSection,
    adminTogglePublish, adminPublishAll, adminHideAll, initAdminDashboard,

    // Speakers
    renderSpeakerStandings, toggleReplyColumn,

    // Import / Export
    renderImport, importTeams, importJudges, exportData, exportStandings,
    exportTeams, exportSpeakerStandings, fullReset,
    previewTeams, previewJudges, clearTeamImport, clearJudgeImport,

    // Feedback & Portal
    renderFeedback, renderJudgePortal,

    // Participants
    renderParticipants,

    // Standings filters
    updateStandingsFilter: (k, v) => {
        import('./tab.js').then(m => m.updateStandingsFilter(k, v));
    },
    resetStandingsFilter: () => {
        import('./tab.js').then(m => m.resetStandingsFilter());
    },

    // Samples
    generateCustomSampleData,

    // Misc
    updatePublicCounts,
    switchCategoryTab,
    showNotification,
});

// ── Global exposure for legacy onclick handlers ──────────────────────────────
window.switchTab = _legacySwitchTab;
window.switchCategoryTab = switchCategoryTab;
window.showNotification = showNotification;
window.state = state;
window.updatePublicCounts = updatePublicCounts;
window.updateHeaderTournamentName = updateHeaderTournamentName;
window.updateTabsForRole = updateTabsForRole;
window.updateNavDropdowns = updateNavDropdowns;
window.navigate = _legacySwitchTab;
window.showLoginModal = showLoginModal;
window.logout = logout;
window.renderInactivitySettings = renderInactivitySettings;
window.setInactivityTimeoutMinutes = setInactivityTimeoutMinutes;
window.renderAdminDashboard = renderAdminDashboard;
window.adminSwitchSection = adminSwitchSection;
window.adminCreateRound = adminCreateRound;
window.adminPublishAll = adminPublishAll;
window.adminHideAll = adminHideAll;

// Teams
    window.addTeam = addTeam;
    window.exportTeams = exportTeams;
    window.deleteTeam = deleteTeam;
window.showEditTeam = showEditTeam;
window.saveEditTeam = saveEditTeam;
window.filterTeamsByCategory = filterTeamsByCategory;

// Judges
window.addJudge = addJudge;
window.deleteJudge = deleteJudge;
window.showEditJudge = showEditJudge;
window.saveEditJudge = saveEditJudge;

// File manager (import/export)
window.importTeams = importTeams;
window.importJudges = importJudges;
window.renderImport = renderImport;
window.exportData = exportData;
window.exportStandings = exportStandings;
window.exportSpeakerStandings = exportSpeakerStandings;
window.previewTeams = previewTeams;
window.previewJudges = previewJudges;
window.clearTeamImport = clearTeamImport;
window.clearJudgeImport = clearJudgeImport;

// Drag and Drop
window.dndJudgeDragStart = dndJudgeDragStart;
window.dndJudgeDragOver = dndJudgeDragOver;
window.dndJudgeDrop = dndJudgeDrop;
window.dndTeamDragStart = dndTeamDragStart;
window.dndTeamDragOver = dndTeamDragOver;
window.dndTeamDrop = dndTeamDrop;
window.dndDragEnd = dndDragEnd;
window.dndDragLeave = dndDragLeave;
window.executeMoveTeam = executeMoveTeam;
window.moveJudgeToPanel = moveJudgeToPanel;

function activeTabId() {
    return document.querySelector('.tab-content.active')?.id || 'public';
}

function globalSearchValue() {
    return document.getElementById('global-search')?.value.trim().toLowerCase() || '';
}

function filterVisibleCards(selector, query) {
    document.querySelectorAll(selector).forEach(el => {
        el.style.display = !query || el.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
}

function filterVisibleRows(selector, query) {
    document.querySelectorAll(selector).forEach(row => {
        row.style.display = !query || row.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
}

function syncGlobalSearchForActiveTab() {
    const input = document.getElementById('global-search');
    if (!input) return;

    const tab = activeTabId();
    const placeholders = {
        standings: 'Search teams or codes...',
        speakers: 'Search speakers or teams...',
        teams: 'Search teams, codes, or speakers...',
        judges: 'Search judges...',
        draw: 'Search rooms, teams, judges...',
        results: 'Search results...',
        motions: 'Search motions...',
        participants: 'Search participants...'
    };
    input.placeholder = placeholders[tab] || 'Search teams, judges, rounds...';
}

function applyGlobalSearch() {
    const q = globalSearchValue();
    const tab = activeTabId();

    if (tab === 'standings') {
        updateStandingsFilter('search', q);
        return;
    }

    if (tab === 'participants') {
        window._parFilterTeams?.();
        window._parFilterJudges?.();
        return;
    }

    if (tab === 'teams') {
        filterVisibleCards('.team-card', q);
        return;
    }

    if (tab === 'judges') {
        filterVisibleCards('.judge-card', q);
        return;
    }

    if (tab === 'speakers') {
        filterVisibleRows('#speaker-rankings tbody tr', q);
        return;
    }

    if (tab === 'draw') {
        filterVisibleCards('.draw-room, .round-card, #rounds-list > div', q);
        return;
    }

    if (tab === 'results') {
        filterVisibleCards('.result-card', q);
        return;
    }

    if (tab === 'motions') {
        filterVisibleCards('.motion-card', q);
    }
}

window.applyGlobalSearch = applyGlobalSearch;
window.syncGlobalSearchForActiveTab = syncGlobalSearchForActiveTab;


// ── Supabase real-time subscription ──────────────────────────────────────────
let _realtimeChannels = [];
let _realtimeEpoch = 0;

function _shouldAutoCreateTournamentForCurrentUser() {
    return state.auth?.isAuthenticated && state.auth.currentUser?.role === 'admin';
}

async function ensureDefaultTournamentForAdmin() {
    if (!_shouldAutoCreateTournamentForCurrentUser()) return null;

    let tournaments = [];
    try {
        tournaments = await api.getTournaments();
    } catch (_) {
        return null;
    }

    if (tournaments.length) return tournaments[0];

    const created = await api.createTournament('My Tournament').catch(() => null);
    if (!created) return null;

    const activeId = created.id;
    const [teams, judges, rounds, publish] = await Promise.all([
        api.getTeams(activeId).catch(() => []),
        api.getJudges(activeId).catch(() => []),
        api.getRounds(activeId).catch(() => []),
        api.getPublishState(activeId).catch(() => ({}))
    ]);

    hydrateState({
        activeTournamentId: activeId,
        tournaments: [created],
        teams,
        judges,
        rounds,
        publish
    });
    updateHeaderTournamentName();
    _setupRealtimeSync(activeId);
    updateTabsForRole();
    updateNavDropdowns();
    updatePublicCounts();

    return created;
}

function _cleanupRealtimeChannels() {
    _realtimeChannels.forEach(ch => { try { supabase.removeChannel(ch); } catch (_) { /* ignore channel cleanup errors */ } });
    _realtimeChannels = [];
}

function _debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function _activeTabId() {
    return document.querySelector('.tab-content.active')?.id || localStorage.getItem('orion_active_tab') || 'public';
}

function _refreshVisibleRealtimeView() {
    const tabId = _activeTabId();
    const realtimeTabs = new Set(['draw', 'standings', 'speakers', 'break', 'knockout', 'results', 'public']);
    if (!realtimeTabs.has(tabId)) return;
    setTimeout(() => {
        try {
            const rerender = {
                draw: renderDraw,
                standings: renderStandings,
                speakers: renderSpeakerStandings,
                break: () => window.renderBreakDisplay?.(),
                knockout: renderKnockout,
                results: renderResults,
                public: updatePublicCounts
            }[tabId];
            rerender?.();
            window.updatePublicCounts?.();
        } catch (e) {
            console.warn('[rt] visible view refresh failed:', e);
        }
    }, 0);
}

function _setupRealtimeSync(tournamentId) {
    _cleanupRealtimeChannels();
    const epoch = ++_realtimeEpoch;
    const isCurrentRealtimeContext = () =>
        epoch === _realtimeEpoch && String(state.activeTournamentId) === String(tournamentId);

    const refetchTeams = _debounce(async () => {
        try {
            const teams = await api.getTeams(tournamentId);
            if (isCurrentRealtimeContext()) {
                state.teams = teams;
                _refreshVisibleRealtimeView();
            }
        } catch (e) { console.warn('[rt] teams refetch:', e); }
    }, 400);

    const refetchJudges = _debounce(async () => {
        try {
            const judges = await api.getJudges(tournamentId);
            if (isCurrentRealtimeContext()) {
                state.judges = judges;
                _refreshVisibleRealtimeView();
            }
        } catch (e) { console.warn('[rt] judges refetch:', e); }
    }, 400);

    const refetchRounds = _debounce(async () => {
        try {
            const rounds = await api.getRounds(tournamentId);
            if (isCurrentRealtimeContext()) {
                state.rounds = rounds;
                _refreshVisibleRealtimeView();
            }
        } catch (e) { console.warn('[rt] rounds refetch:', e); }
    }, 400);

    const refetchTeamsAndRounds = _debounce(async () => {
        try {
            const [teams, rounds] = await Promise.all([
                api.getTeams(tournamentId),
                api.getRounds(tournamentId),
            ]);
            if (isCurrentRealtimeContext()) {
                state.teams  = teams;
                state.rounds = rounds;
                _refreshVisibleRealtimeView();
            }
        } catch (e) { console.warn('[rt] teams+rounds refetch:', e); }
    }, 400);

    const refetchPublishedData = _debounce(async () => {
        try {
            const [teams, judges, rounds, publish] = await Promise.all([
                api.getTeams(tournamentId).catch(() => state.teams || []),
                api.getJudges(tournamentId).catch(() => state.judges || []),
                api.getRounds(tournamentId).catch(() => state.rounds || []),
                api.getPublishState(tournamentId).catch(() => state.publish || {}),
            ]);
            if (isCurrentRealtimeContext()) {
                state.teams = teams;
                state.judges = judges;
                state.rounds = rounds;
                const { tournament_id, ...flags } = publish || {};
                state.publish = flags;
                updateTabsForRole();
                updateNavDropdowns();
                _refreshVisibleRealtimeView();
            }
        } catch (e) { console.warn('[rt] published data refetch:', e); }
    }, 500);

    _realtimeChannels = [
        // Teams row changes
        supabase.channel(`rt-teams-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'teams',
                filter: `tournament_id=eq.${tournamentId}` }, refetchTeams)
            .subscribe(),

        // Speaker changes (embedded inside teams objects)
        supabase.channel(`rt-speakers-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'speakers',
                filter: `tournament_id=eq.${tournamentId}` }, refetchTeams)
            .subscribe(),

        // Judge row changes
        supabase.channel(`rt-judges-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'judges',
                filter: `tournament_id=eq.${tournamentId}` }, refetchJudges)
            .subscribe(),

        // Judge conflict changes — no tournament_id column, filter by known judge IDs
        supabase.channel(`rt-judge-conflicts`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'judge_conflicts' },
                payload => {
                    const jid = payload.new?.judge_id ?? payload.old?.judge_id;
                    if ((state.judges || []).some(j => String(j.id) === String(jid)))
                        refetchJudges();
                })
            .subscribe(),

        // Round row changes
        supabase.channel(`rt-rounds-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds',
                filter: `tournament_id=eq.${tournamentId}` }, refetchRounds)
            .subscribe(),

        // Debate changes — fast DOM patch for ballot-entry status; full refetch otherwise
        supabase.channel(`rt-debates-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'debates',
                filter: `tournament_id=eq.${tournamentId}` }, refetchRounds)
            .subscribe(),

        // Debate judge assignments — no tournament_id, filter by known debate IDs
        supabase.channel(`rt-debate-judges`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'debate_judges' },
                payload => {
                    const did = payload.new?.debate_id ?? payload.old?.debate_id;
                    const rounds = state.rounds || [];
                    if (rounds.some(r => (r.debates || []).some(d => String(d.id) === String(did))))
                        refetchRounds();
                })
            .subscribe(),

        // Ballot changes — edge function updates team stats after insert, so refetch both
        supabase.channel(`rt-ballots-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ballots',
                filter: `tournament_id=eq.${tournamentId}` }, refetchTeamsAndRounds)
            .subscribe(),

        // Publish flag changes
        supabase.channel(`rt-publish-${tournamentId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_publish',
                filter: `tournament_id=eq.${tournamentId}` }, payload => {
                if (payload.new) {
                    const { tournament_id, ...flags } = payload.new;
                    state.publish = flags;
                    updateTabsForRole();
                    updateNavDropdowns();
                    refetchPublishedData();
                    _refreshVisibleRealtimeView();
                }
            })
            .subscribe(),
    ];
}

// Exposed so admin.js can re-wire channels after a tournament switch
window._setupRealtimeSyncForTournament = id => { _cleanupRealtimeChannels(); _setupRealtimeSync(id); };
window.ensureDefaultTournamentForAdmin = ensureDefaultTournamentForAdmin;

// ── App initialization ────────────────────────────────────────────────────────
async function init() {
    window.__orionReady = false;
    window.__orionStep = 'starting';
    console.log('[main] init() started');
    
    try {
        window.__orionStep = 'init-router';
        console.log('[main] Step 1: Init router...');
        initRouter();
        window.__orionStep = 'restore-session';
        console.log('[main] Step 2: Restore session...');

        // 1. Restore Supabase auth session (blocking — identity affects nav and data visibility)
        const isAuthed = await restoreSession();
        console.log('[main] Auth restored:', isAuthed ? 'YES' : 'NO');

        // 2. Restore UI preferences (theme, draw prefs)
        restoreUIPrefs();
        updateHeaderControls();
        updateAdminNavVisibility();

        // 3. Load tournament list + active tournament data in parallel (optimistic prefetch)
        const storedActiveId = localStorage.getItem('orion_active_tournament_id');
        let [tournaments, prefetched] = await Promise.all([
            api.getTournaments().catch(() => []),
            storedActiveId ? Promise.all([
                api.getTeams(storedActiveId),
                api.getJudges(storedActiveId),
                api.getRounds(storedActiveId),
                api.getPublishState(storedActiveId).catch(() => ({}))
            ]).catch(() => null) : Promise.resolve(null)
        ]);

        if (!tournaments.length && _shouldAutoCreateTournamentForCurrentUser()) {
            const tour = await api.createTournament('My Tournament').catch(() => null);
            if (tour) tournaments.push(tour);
        }

        // 4. Determine active tournament
        let activeId = storedActiveId;
        if (!activeId || !tournaments.find(t => t.id === activeId)) {
            activeId = tournaments[0]?.id;
        }

        if (!activeId) {
            initAdminDashboard();
            initParticipants();
            updateTabsForRole();
            updateNavDropdowns();
            updatePublicCounts();
            syncGlobalSearchForActiveTab();
            initImageOptimizations();
            window.__orionReady = true;
            if (!_shouldAutoCreateTournamentForCurrentUser()) {
                showNotification('No published tournament is available yet.', 'info');
            }
            return;
        }

        // 5. Use prefetched data if it matched the resolved tournament, else fetch now
        console.log('[main] Active Tournament ID:', activeId);
        let [teams, judges, rounds, publish] = prefetched && storedActiveId === activeId
            ? prefetched
            : await Promise.all([
                api.getTeams(activeId),
                api.getJudges(activeId),
                api.getRounds(activeId),
                api.getPublishState(activeId).catch(() => ({}))
            ]);

        // 6. Hydrate in-memory state cache
        hydrateState({ activeTournamentId: activeId, tournaments, teams, judges, rounds, publish });

        // 6b. Update header with tournament name
        updateHeaderTournamentName();

        // 7. Set up real-time subscription
        _setupRealtimeSync(activeId);

        // 8. Check URL for judge token (portal access via URL param)
        await checkUrlForJudgeToken();

        // 9. Init subsystems
        initAdminDashboard();
        initParticipants();
        updateTabsForRole();
        updateNavDropdowns();
        updatePublicCounts();
        syncGlobalSearchForActiveTab();

        // 10. Initialize image optimizations
        initImageOptimizations();

        // 11. Settings button dropdown
        const settingsBtn = document.getElementById('header-settings-btn');
        const settingsDropdown = document.getElementById('header-settings-dropdown');
        const themeContainer = document.getElementById('theme-picker-container');
        
        const openSettings = () => {
            const isOpen = settingsDropdown.classList.contains('open');
            settingsDropdown.classList.toggle('open');
            if (!isOpen && typeof window.renderThemePicker === 'function') {
                window.renderThemePicker('theme-picker-container');
            }
            if (!isOpen && typeof window.renderInactivitySettings === 'function') {
                window.renderInactivitySettings('inactivity-settings-container');
            }
        };
        
        if (settingsBtn && settingsDropdown) {
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openSettings();
            });
            
            settingsDropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            themeContainer?.addEventListener('focus', () => {
                settingsDropdown.classList.add('open');
            }, true);
            
            document.addEventListener('click', (e) => {
                if (!settingsDropdown.contains(e.target) && e.target !== settingsBtn) {
                    settingsDropdown.classList.remove('open');
                }
            });
        }

        // Admin settings dropdown close — delegated so it works after lazy render
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('adm-top-settings-dropdown');
            const btn      = document.getElementById('adm-top-settings-btn');
            if (dropdown && dropdown.classList.contains('open')) {
                if (!dropdown.contains(e.target) && e.target !== btn) {
                    dropdown.classList.remove('open');
                }
            }
        });

        // 12. Restore active tab (sticky navigation)
        const savedTab = localStorage.getItem('orion_active_tab') || 'public';
        try {
            _legacySwitchTab(savedTab);
        } catch (e) {
            console.warn('[main] Failed to navigate to saved tab, falling back to public');
            _legacySwitchTab('public');
        }
        window.__orionReady = true;
        console.log('[main] Init complete, step:', window.__orionStep);
    } catch (err) {
        window.__orionStep = 'error';
        console.error('[main] Init error:', err);
    }
}



// Start the app
console.log('[main] About to call init()');
window.mainLoaded = true;
init().catch(err => {
    console.error('[main] Init failed:', err);
});
