import * as Sentry from '@sentry/browser';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (window.ENV || {});

if (env.VITE_SENTRY_DSN && env.VITE_SENTRY_DSN !== 'YOUR_SENTRY_DSN') {
    Sentry.init({
        dsn: env.VITE_SENTRY_DSN,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration(),
        ],
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
    });
}

// Global error handler to prevent blank screen on errors
window.addEventListener('error', (e) => {
    console.error('[global] Uncaught error:', e.error);
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (window.ENV || {});
    if (env.VITE_SENTRY_DSN) Sentry.captureException(e.error);
    localStorage.setItem('orion_active_tab', 'public');
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
    restoreUIPrefs, patchDebate
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
    signInWithGoogle, signInWithDiscord, signInWithApple,
} from './supabase-auth.js';
import {
    navigate, initRouter,
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
    signInWithGoogle, signInWithDiscord, signInWithApple,

    // Nav
    navigate,
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
window.updatePublicCounts = updatePublicCounts;
window.updateHeaderTournamentName = updateHeaderTournamentName;
window.navigate = navigate;

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
function _setupRealtimeSync(tournamentId) {
    supabase
        .channel(`debates:${tournamentId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'debates',
            filter: `tournament_id=eq.${tournamentId}`
        }, payload => {
            const debate = payload.new;
            const roundId = debate.round_id;
            patchDebate(roundId, debate.id, debate);
            const { updateRoomStatus } = window._drawDomHelpers || {};
            if (updateRoomStatus) updateRoomStatus(debate.id, debate.entered);
        })
        .subscribe();

    supabase
        .channel(`publish:${tournamentId}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'tournament_publish',
            filter: `tournament_id=eq.${tournamentId}`
        }, payload => {
            const { tournament_id, ...flags } = payload.new;
            state.publish = flags;
            updateTabsForRole();
            updateNavDropdowns();
        })
        .subscribe();
}

// ── App initialization ────────────────────────────────────────────────────────
async function init() {
    // 0. Init router immediately
    initRouter();

    // 1. Restore Supabase auth session (BLOCKING — must know who we are first)
    const isAuthed = await restoreSession();
    console.log('[main] Auth restored:', isAuthed ? 'YES' : 'NO');

    // 2. Restore UI preferences (theme, draw prefs)
    restoreUIPrefs();
    updateHeaderControls();
    updateAdminNavVisibility();

    // 3. Load tournament list
    const tournaments = await api.getTournaments().catch(() => []);
    if (!tournaments.length) {
        // First run — create default tournament
        const tour = await api.createTournament('My Tournament').catch(() => null);
        if (tour) tournaments.push(tour);
    }

    // 4. Determine active tournament
    let activeId = localStorage.getItem('orion_active_tournament_id');

    // Validate if it still exists in the loaded list
    if (!activeId || !tournaments.find(t => t.id === activeId)) {
        activeId = tournaments[0]?.id;
    }

    if (!activeId) {
        showNotification('Could not load tournament data.', 'error');
        return;
    }

    // 5. Load active tournament data (BYPASS CACHE for diagnostics)
    console.log('[main] Active Tournament ID:', activeId);

    const [teams, judges, rounds, publish] = await Promise.all([
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

    // 10. Restore active tab (sticky navigation)
    const savedTab = localStorage.getItem('orion_active_tab');
    if (savedTab && savedTab !== 'public') {
        try {
            navigate(savedTab);
        } catch (e) {
            console.warn('[main] Failed to restore saved tab, falling back to public');
            localStorage.setItem('orion_active_tab', 'public');
            navigate('public');
        }
    }
}

// ── DOMContentLoaded ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Logo/profile nav
    document.querySelector('.header-logo')
        ?.addEventListener('click', () => navigate('public'));
    document.querySelector('.header-user')
        ?.addEventListener('click', () => navigate('profile'));

    document.getElementById('global-search')?.addEventListener('input', () => {
        syncGlobalSearchForActiveTab();
        applyGlobalSearch();
    });

    // Install the delegated click listener to handle data-action attributes
    installDelegatedListener();

    // Ensure the header login button works even if delegated listener fails
    const headerLoginBtn = document.getElementById('header-login-btn');
    console.log('[main] headerLoginBtn found:', !!headerLoginBtn);
    if (headerLoginBtn) {
        headerLoginBtn.addEventListener('click', e => {
            console.log('[main] Login button CLICKED!');
            alert('LOGIN CLICKED - opening modal');
            e.preventDefault();
            showLoginModal();
        });
    } else {
        alert('ERROR: header-login-btn NOT FOUND in DOM!');
    }

    // Auth modal — Enter key on inputs
    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && document.getElementById('loginPassword') === document.activeElement) {
            handleLogin();
        }
    });

    // Start the app
    init().catch(err => {
        console.error('[main] Init failed:', err);
        showNotification('Failed to connect to the server. Check your internet connection.', 'error');
        // Force navigate to public tab on any error
        localStorage.setItem('orion_active_tab', 'public');
        navigate('public');
    });
});

// ── Legacy shim: exposeOnWindow ───────────────────────────────────────────────
// Needed while any onclick="window.X()" attributes remain in HTML or JS templates.
// DELETE this block once all templates use data-action.
// The router's registerActions() already sets window.switchTab as a shim.
import { exposeOnWindow } from './registry.js';
exposeOnWindow();
