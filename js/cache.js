// js/cache.js — IndexedDB read cache for offline resilience
// Pattern: try Supabase first, fall back to IndexedDB cache.
// NEVER write directly to cache from outside this module.
// Cache is updated ONLY after a successful Supabase fetch.

const DB_NAME    = 'orion_cache';
const DB_VERSION = 1;
const STORES     = ['teams', 'judges', 'rounds', 'tournaments', 'publish'];

let _db = null;

async function openDb() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            for (const store of STORES) {
                if (!db.objectStoreNames.contains(store)) {
                    // Each store keyed by 'id' except 'publish' (keyed by tournament_id)
                    const keyPath = store === 'publish' ? 'tournament_id' : 'id';
                    db.createObjectStore(store, { keyPath });
                }
            }
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror   = (e) => reject(e.target.error);
    });
}

async function _put(storeName, records) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const items = Array.isArray(records) ? records : [records];
        for (const item of items) store.put(item);
        tx.oncomplete = resolve;
        tx.onerror    = (e) => reject(e.target.error);
    });
}

async function _getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(storeName).objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = (e) => reject(e.target.error);
    });
}

async function _getByIndex(storeName, indexField, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx    = db.transaction(storeName);
        const store = tx.objectStore(storeName);
        const req   = store.getAll();
        req.onsuccess = () => resolve(req.result.filter(r => String(r[indexField]) === String(value)));
        req.onerror   = (e) => reject(e.target.error);
    });
}

async function _clear(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
        req.onsuccess = resolve;
        req.onerror   = (e) => reject(e.target.error);
    });
}

// ── Public cache API ───────────────────────────────────────────────────────

export const cache = {

    async setTeams(teams) {
        await _clear('teams');
        if (teams.length) await _put('teams', teams);
    },
    async getTeams(tournamentId) {
        const all = await _getAll('teams');
        return all.filter(t => String(t.tournament_id) === String(tournamentId));
    },

    async setJudges(judges) {
        await _clear('judges');
        if (judges.length) await _put('judges', judges);
    },
    async getJudges(tournamentId) {
        const all = await _getAll('judges');
        return all.filter(j => String(j.tournament_id) === String(tournamentId));
    },

    async setRounds(rounds) {
        await _clear('rounds');
        if (rounds.length) await _put('rounds', rounds);
    },
    async getRounds(tournamentId) {
        const all = await _getAll('rounds');
        return all.filter(r => String(r.tournament_id) === String(tournamentId))
            .sort((a, b) => a.round_number - b.round_number);
    },

    async setTournaments(tournaments) {
        await _clear('tournaments');
        if (tournaments.length) await _put('tournaments', tournaments);
    },
    async getTournaments() {
        return _getAll('tournaments');
    },

    async setPublish(publishState) {
        await _put('publish', publishState);
    },
    async getPublish(tournamentId) {
        const all = await _getAll('publish');
        return all.find(p => String(p.tournament_id) === String(tournamentId)) || null;
    },

    async clearAll() {
        for (const store of STORES) await _clear(store);
    },
};

// ── Cached loader helpers ──────────────────────────────────────────────────
// Use these in api.js wrappers to get try-remote/fallback-to-cache behaviour.

/**
 * @param {Function} fetchFn    – async fn that returns fresh data from Supabase
 * @param {Function} setCacheFn – cache.setXxx
 * @param {Function} getCacheFn – cache.getXxx (may return stale data)
 * @returns {Promise<Array>}
 */
export async function withCache(fetchFn, setCacheFn, getCacheFn) {
    try {
        const data = await fetchFn();
        // Update cache silently — don't await to avoid blocking the UI
        setCacheFn(data).catch(e => console.warn('[cache] Write failed:', e));
        return data;
    } catch (err) {
        console.warn('[cache] Supabase unavailable, serving cached data:', err.message);
        return getCacheFn();
    }
}

// ── Direct load helpers for main.js ────────────────────────────────────────
export async function loadRounds(tournamentId) {
    return cache.getRounds(tournamentId);
}

export async function loadTeams(tournamentId) {
    return cache.getTeams(tournamentId);
}

export async function loadJudges(tournamentId) {
    return cache.getJudges(tournamentId);
}

export async function loadTournaments() {
    return cache.getTournaments();
}

export async function loadPublish(tournamentId) {
    return cache.getPublish(tournamentId);
}