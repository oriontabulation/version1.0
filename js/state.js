// ============================================================
// STATE.JS — In-memory read cache (NOT a persistence layer)
//
// WHAT CHANGED vs the original:
//   - No localStorage writes. Data lives in Supabase.
//   - save() / saveNow() removed from Proxy set handler.
//     The Proxy only notifies watchers for reactive UI updates.
//   - state.auth.currentUser.role is for DISPLAY only.
//     All actual access control happens in Supabase RLS.
//   - On startup: reads from Supabase via api.js, not localStorage.
//   - auth session: handled by supabase.auth, not state.
//
// WHAT STAYED:
//   - Same property names (state.teams, state.judges, state.rounds, …)
//   - Same watcher/notify API
//   - Same TOURNAMENT_KEYS list
//   - Proxy still fires reactive UI updates on mutation
// ============================================================

import { buildTeamMap, getJudgeAssignments } from './maps.js';

console.log('[state.js] Module loading...');

export const DEFAULT_TOURNAMENT_ID = '__orion_default_tournament__';

export function createDefaultTournament() {
    return {
        id: DEFAULT_TOURNAMENT_ID,
        name: 'My Tournament',
        format: 'standard',
        created_at: new Date(0).toISOString(),
        isLocalDefault: true
    };
}

export function createDefaultPublishState() {
    return {
        tournament_id: DEFAULT_TOURNAMENT_ID,
        draw: true,
        standings: true,
        speakers: true,
        break: true,
        knockout: true,
        motions: true,
        results: true
    };
}

// ── Private internal store ────────────────────────────────────────────────────
let _state = {
    activeTournamentId: null,
    auth: {
        currentUser: null,
        isAuthenticated: false,
        lastActivity: Date.now()
    },
    tournaments: {}
};


// ── Keys scoped to the active tournament ─────────────────────────────────────
export const TOURNAMENT_KEYS = [
    'teams', 'judges', 'rounds', 'tournament', 'publish',
    'roomURLs', 'feedback', 'judgeTokens', 'format'
];

// ── Watcher registry ─────────────────────────────────────────────────────────
const _watchers = {};

export function watch(key, fn) {
    if (!_watchers[key]) _watchers[key] = [];
    _watchers[key].push(fn);
}

export function notify(key) {
    if (!_watchers[key]) return;
    setTimeout(() => {
        for (const fn of _watchers[key]) {
            try { fn(); } catch (e) { console.error(`[state] Watcher error (${key}):`, e); }
        }
    }, 0);
}

function _notifyForKey(key) {
    notify(key);
    if (key === 'teams')  notify('speakers');
    if (key === 'rounds') { notify('standings'); notify('speakers'); }
}

// ── Deep Proxy (notifications only — no save()) ───────────────────────────────
function _makeProxy(target, onMutate) {
    if (target === null || typeof target !== 'object') return target;
    if (target.__isProxy) return target;

    return new Proxy(target, {
        get(obj, prop) {
            if (prop === '__isProxy') return true;
            const val = obj[prop];
            if (val !== null && typeof val === 'object') return _makeProxy(val, onMutate);
            return val;
        },
        set(obj, prop, value) {
            if (obj[prop] === value) return true;
            obj[prop] = value;
            onMutate(String(prop));   // notify watchers — NO save() call
            return true;
        },
        deleteProperty(obj, prop) {
            delete obj[prop];
            onMutate(String(prop));
            return true;
        }
    });
}

// ── Exported state object ─────────────────────────────────────────────────────
export const state = {};

// Tournament-scoped properties (delegate to active tournament)
for (const key of TOURNAMENT_KEYS) {
    Object.defineProperty(state, key, {
        get() {
            const t = _state.tournaments[_state.activeTournamentId];
            if (!t) return key === 'teams' || key === 'judges' || key === 'rounds' ? [] : undefined;
            if (!t[`__proxy_${key}`]) {
                t[`__proxy_${key}`] = _makeProxy(t[key], () => _notifyForKey(key));
            }
            return t[`__proxy_${key}`];
        },
        set(v) {
            const t = _state.tournaments[_state.activeTournamentId];
            if (t) {
                t[key] = v;
                delete t[`__proxy_${key}`];
                _notifyForKey(key);
            }
        },
        enumerable: true,
        configurable: true
    });
}

// Auth (global, not tournament-scoped)
Object.defineProperty(state, 'auth', {
    get() {
        if (!_state.__authProxy) {
            _state.__authProxy = _makeProxy(_state.auth, () => notify('auth'));
        }
        return _state.__authProxy;
    },
    set(v) {
        _state.auth = v;
        delete _state.__authProxy;
        notify('auth');
    },
    enumerable: true,
    configurable: true
});

Object.defineProperty(state, 'activeTournamentId', {
    get() { return _state.activeTournamentId; },
    set(v) {
        _state.activeTournamentId = v;
        // Clear proxy caches for the new active tournament
        const t = _state.tournaments[v];
        if (t) TOURNAMENT_KEYS.forEach(k => delete t[`__proxy_${k}`]);
        notify('tournament');
        Object.keys(_watchers).forEach(k => notify(k));
    },
    enumerable: true,
    configurable: true
});

Object.defineProperty(state, 'tournaments', {
    get() {
        if (!_state.__toursProxy) {
            _state.__toursProxy = _makeProxy(_state.tournaments, () => notify('tournaments'));
        }
        return _state.__toursProxy;
    },
    set(v) {
        _state.tournaments = v;
        delete _state.__toursProxy;
        notify('tournaments');
    },
    enumerable: true,
    configurable: true
});

// ── State hydration (called by main.js after Supabase load) ───────────────────
/**
 * Hydrate the in-memory cache from Supabase data.
 * Called once on startup and on tournament switch.
 *
 * @param {Object} options
 * @param {string}  options.activeTournamentId
 * @param {Array}   options.tournaments   — array of tournament rows
 * @param {Array}   options.teams
 * @param {Array}   options.judges
 * @param {Array}   options.rounds
 * @param {Object}  options.publish       — tournament_publish row
 */
export function hydrateState({ activeTournamentId, tournaments = [], teams = [], judges = [], rounds = [], publish = {} }) {
    // Never auto-create default tournament - let user see empty state
    if (!tournaments.length) {
        console.warn('[state] No tournaments provided to hydrateState. User must create one.');
        tournaments = [];
        // Don't set a default active tournament
        activeTournamentId = null;
        teams = [];
        judges = [];
        rounds = [];
        publish = {};
    }

    // Build tournament map
    _state.tournaments = {};
    delete _state.__toursProxy; // invalidate stale proxy — getter will re-wrap the new object
    for (const t of tournaments) {
        _state.tournaments[t.id] = {
            ...t,
            name:     t.name,
            format:   t.format,
            teams:    [],
            judges:   [],
            rounds:   [],
            publish:  {},
            feedback: [],
            judgeTokens: {},
            roomURLs: {}
        };
    }

    const activeId = activeTournamentId && _state.tournaments[activeTournamentId]
        ? activeTournamentId
        : tournaments[0]?.id;
    _state.activeTournamentId = activeId;

    // Core tournament records come from Supabase. Only keep explicit per-browser
    // UI adjuncts local; never merge browser-local team/round data back in.
    const active = _state.tournaments[activeId];
    if (active) {
        active.teams   = teams;
        active.judges  = judges;
        active.rounds  = rounds;
        active.publish = publish;

        try {
            const savedBracket = localStorage.getItem(`orion_bracket_${activeId}`);
            if (savedBracket) active.tournament = JSON.parse(savedBracket);
        } catch {
            // Ignore corrupt local bracket cache; Supabase state still loads.
        }

        _reapplyBreakData(activeId, active.teams);
    }

    // Notify all watchers
    Object.keys(_watchers).forEach(k => notify(k));
}

// Re-merge break flags (broke/seed/reserved/etc.) from localStorage into a teams array.
// Called after any teams replacement (hydrateState, refetchTeams) because these fields
// are not stored in Supabase — they live only in localStorage and in-memory.
function _reapplyBreakData(tid, teamArr) {
    if (!tid || !teamArr?.length) return;
    try {
        const raw = localStorage.getItem(`orion_breakdata_${tid}`);
        if (!raw) return;
        const breakData = JSON.parse(raw);
        if (!breakData?.length) return;
        const byId = new Map(breakData.map(b => [String(b.id), b]));
        teamArr.forEach(tm => {
            const b = byId.get(String(tm.id));
            if (!b) return;
            if (b.broke     !== undefined) tm.broke     = b.broke;
            if (b.seed      !== undefined) tm.seed      = b.seed;
            if (b.reserved  !== undefined) tm.reserved  = b.reserved;
            if (b.tournamentWins   !== undefined) tm.tournamentWins   = b.tournamentWins;
            if (b.tournamentLosses !== undefined) tm.tournamentLosses = b.tournamentLosses;
            if (b.eliminated !== undefined) tm.eliminated = b.eliminated;
        });
    } catch { /* corrupt break data — ignore */ }
}

export function reapplyBreakData() {
    const tid = _state.activeTournamentId;
    const t   = _state.tournaments[tid];
    if (t?.teams) _reapplyBreakData(tid, t.teams);
}

/**
 * save() — Persists knockout bracket to localStorage and notifies watchers.
 * Called by knockout.js after entering results.
 */
export function save() {
    try {
        const tid = _state.activeTournamentId;
        const t   = _state.tournaments[tid];
        if (tid && t?.tournament) {
            localStorage.setItem(`orion_bracket_${tid}`, JSON.stringify(t.tournament));
        }
        // Persist team breaking/seeding info too
        if (tid && t?.teams) {
            const breakData = t.teams
                .filter(tm => tm.broke || tm.seed || tm.reserved || tm.tournamentWins || tm.tournamentLosses)
                .map(tm => ({ id: tm.id, broke: tm.broke, seed: tm.seed, reserved: tm.reserved,
                              tournamentWins: tm.tournamentWins, tournamentLosses: tm.tournamentLosses,
                              eliminated: tm.eliminated }));
            if (breakData.length) localStorage.setItem(`orion_breakdata_${tid}`, JSON.stringify(breakData));
        }
        Object.keys(_watchers).forEach(k => notify(k));
    } catch (e) {
        console.warn('[state] save() failed:', e);
    }
}

/** Alias kept for backward-compat with any code that calls saveNow() */
export const saveNow = save;

/**
 * Partially update the active tournament's cache after a mutation.
 * Avoids full re-fetch when only one entity changed.
 */
export function patchTeam(teamId, patch) {
    const teams = _state.tournaments[_state.activeTournamentId]?.teams;
    if (!teams) return;
    const idx = teams.findIndex(t => String(t.id) === String(teamId));
    if (idx >= 0) Object.assign(teams[idx], patch);
    notify('teams');
    notify('speakers');
}

export function addTeamToCache(team) {
    const t = _state.tournaments[_state.activeTournamentId];
    if (t) { t.teams = [...(t.teams || []), team]; delete t.__proxy_teams; }
    notify('teams');
}

export function removeTeamFromCache(teamId) {
    const t = _state.tournaments[_state.activeTournamentId];
    if (t) { t.teams = (t.teams || []).filter(t => String(t.id) !== String(teamId)); delete t.__proxy_teams; }
    notify('teams');
}

export function addJudgeToCache(judge) {
    const t = _state.tournaments[_state.activeTournamentId];
    if (t) { t.judges = [...(t.judges || []), judge]; delete t.__proxy_judges; }
    notify('judges');
}

export function removeJudgeFromCache(judgeId) {
    const t = _state.tournaments[_state.activeTournamentId];
    if (t) { t.judges = (t.judges || []).filter(j => String(j.id) !== String(judgeId)); delete t.__proxy_judges; }
    notify('judges');
}

export function patchJudge(judgeId, patch) {
    const judges = _state.tournaments[_state.activeTournamentId]?.judges;
    if (!judges) return;
    const idx = judges.findIndex(j => String(j.id) === String(judgeId));
    if (idx >= 0) Object.assign(judges[idx], patch);
    notify('judges');
}

export function addRoundToCache(round) {
    const t = _state.tournaments[_state.activeTournamentId];
    if (t) { t.rounds = [...(t.rounds || []), round]; delete t.__proxy_rounds; }
    notify('rounds');
}

export function patchRound(roundId, patch) {
    const rounds = _state.tournaments[_state.activeTournamentId]?.rounds;
    if (!rounds) return;
    const idx = rounds.findIndex(r => String(r.id) === String(roundId));
    if (idx >= 0) Object.assign(rounds[idx], patch);
    notify('rounds');
}

export function patchDebate(roundId, debateId, patch) {
    const rounds = _state.tournaments[_state.activeTournamentId]?.rounds;
    if (!rounds) return;
    const round = rounds.find(r => String(r.id) === String(roundId));
    if (!round) return;
    const debate = (round.debates || []).find(d => String(d.id) === String(debateId));
    if (debate) Object.assign(debate, patch);
    notify('rounds');
}

// ── Tournament management ─────────────────────────────────────────────────────
export function activeTournament() {
    if (!_state.activeTournamentId || !_state.tournaments[_state.activeTournamentId]) {
        return null;
    }
    return _state.tournaments[_state.activeTournamentId];
}

export function switchTournamentCache(id, { teams = [], judges = [], rounds = [], publish = {} }) {
    if (!id || !_state.tournaments[id]) {
        console.warn('[state] Cannot switch to non-existent tournament:', id);
        return;
    }
    _state.activeTournamentId = id;
    const t = _state.tournaments[id];
    if (t) {
        t.teams   = teams;
        t.judges  = judges;
        t.rounds  = rounds;
        t.publish = publish;
        TOURNAMENT_KEYS.forEach(k => delete t[`__proxy_${k}`]);
    }
    Object.keys(_watchers).forEach(k => notify(k));
}



// ── Restore UI preferences (non-sensitive, OK in localStorage) ────────────────
export function restoreUIPrefs() {
    try {
        const theme = localStorage.getItem('orion_theme');
        if (theme && !theme.startsWith('#') && window.applyTheme) window.applyTheme(theme);

        const drawPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}');
        return drawPrefs;
    } catch { return {}; }
}

export function saveDrawPref(key, value) {
    try {
        const prefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}');
        prefs[key] = value;
        localStorage.setItem('orion_draw_prefs', JSON.stringify(prefs));
    } catch {
        // Ignore unavailable localStorage for non-sensitive UI preferences.
    }
}

// ── Legacy: token helpers (now backed by Supabase) ────────────────────────────
// Kept for backward-compat with state.js callers.
// New code uses api.generateJudgeToken() directly.
export function getJudgeCurrentAssignment(judgeId) {
    // Now uses proper import from maps.js
    const teamById = buildTeamMap(state.teams || []);
    return getJudgeAssignments(judgeId, state.rounds || [], teamById);
}

// ── escapeHTML (re-exported from utils for legacy imports) ────────────────────
export { escapeHTML } from './utils.js';
