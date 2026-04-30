// ============================================================
// AUTH-VALIDATION.JS (refactored)
//
// ORIGINAL HAD:
//   - checkUserRole() — client-side role check (forgeable)
//   - createSecureSession() — stub that set a plain JS object as session
//   - rateLimit() — in-memory, bypassed by page refresh, used Math.random
//
// THESE ARE ALL DELETED. Here is what replaces each one:
//
//   checkUserRole()      → Supabase RLS (see schema.sql)
//   createSecureSession()→ supabase.auth.signInWithPassword() (session
//                          stored in httpOnly cookie by Supabase)
//   rateLimit()          → Supabase Auth built-in rate limiting
//                          + optional Edge Function middleware
//
// This file now provides:
//   - Form input validators (client UX only — server enforces too)
//   - Token format validators
// ============================================================

/**
 * Validate registration form inputs before sending to Supabase.
 * Returns { valid: boolean, errors: string[] }
 *
 * These are UX-only checks — Supabase and the DB enforce the real constraints.
 */
export function validateRegistrationForm({ name, email, username, password, confirmPassword }) {
    const errors = [];

    if (!name?.trim() || name.trim().length < 2) {
        errors.push('Name must be at least 2 characters.');
    }
    if (name?.trim().length > 100) {
        errors.push('Name must be 100 characters or fewer.');
    }

    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        errors.push('Enter a valid email address.');
    }

    if (!username?.trim() || username.trim().length < 3) {
        errors.push('Username must be at least 3 characters.');
    }
    if (username?.trim().length > 30) {
        errors.push('Username must be 30 characters or fewer.');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username?.trim() || '')) {
        errors.push('Username can only contain letters, numbers, and underscores.');
    }

    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters.');
    }
    if (password !== confirmPassword) {
        errors.push('Passwords do not match.');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate login form inputs.
 */
export function validateLoginForm({ email, password }) {
    const errors = [];
    if (!email?.trim()) errors.push('Email is required.');
    if (!password)      errors.push('Password is required.');
    return { valid: errors.length === 0, errors };
}

/**
 * Check a judge token URL parameter is the right format before
 * sending it to the validate-judge-token Edge Function.
 *
 * This is a format check only — the server verifies the actual token.
 * A malicious token that passes this check will be rejected by the
 * Edge Function (not found, revoked, or expired).
 */
export function isValidTokenFormat(token) {
    return typeof token === 'string'
        && token.length >= 16
        && token.length <= 128
        && /^[a-f0-9]+$/i.test(token);
}

/**
 * Sanitise a text input value for use as textContent (not innerHTML).
 * Returns a trimmed string with leading/trailing whitespace removed.
 *
 * Note: putting this value in element.textContent is always safe.
 *       Never use it with innerHTML without further escaping.
 */
export function sanitiseInput(value, maxLength = 500) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, maxLength);
}

// ── Removed functions ─────────────────────────────────────────────────────────
//
// module.exports = { checkUserRole, createSecureSession, rateLimit }
//   ↑ This used CommonJS exports — incompatible with the ES module system used
//     throughout the app (import/export). Also all three functions were insecure.
//
// The file now uses ES module exports only. Import as:
//   import { validateRegistrationForm } from './auth-validation.js';
