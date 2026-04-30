// ============================================================
// SUPABASE-SYNC.JS (refactored — thin pass-through)
//
// The original version saved/loaded all tournament data to/from
// localStorage with a Supabase mirror. This is no longer needed:
//   - Reads come from api.js → Supabase on startup
//   - Writes go through api.js → Supabase immediately
//   - IndexedDB (cache.js) provides offline read fallback
//
// This file is kept for backward-compat with any imports that
// reference it. The named exports match the old signature.
// ============================================================

import { api } from './api.js';

/**
 * load from Supabase on startup.
 * Called by main.js init() — kept for backward-compat.
 * Returns true if data was loaded, false if user not logged in.
 */
export async function loadFromSupabase() {
    try {
        const { supabase } = await import('./supabase.js');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return false;
        // Actual data loading is now handled by main.js init()
        // via api.getTeams(), api.getJudges(), api.getRounds()
        return true;
    } catch {
        return false;
    }
}

/**
 * save() — no-op. Mutations go through api.js.
 * Kept for backward-compat with files that import save from here.
 */
export function save()    { /* no-op — use api.js for mutations */ }
export function saveNow() { /* no-op — use api.js for mutations */ }
