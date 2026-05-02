// ============================================================
// SUPABASE-SYNC.JS (compatibility shim)
//
// Modern CRUD code writes through api.js. Older draw/knockout/sample code
// still calls save()/saveNow() after mutating in-memory state, so these
// functions now persist the browser-local page-state snapshot.
// ============================================================

import { save as saveState } from './state.js';

export async function loadFromSupabase() {
    try {
        const { supabase } = await import('./supabase.js');
        const { data: { user } } = await supabase.auth.getUser();
        return !!user;
    } catch {
        return false;
    }
}

export function save() {
    saveState();
}

export function saveNow() {
    saveState();
}
