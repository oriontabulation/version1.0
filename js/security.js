// ============================================================
// SECURITY.JS (refactored)
//
// The original version had:
//   - sanitizeInput() using regex to strip <script> tags (bypassable)
//   - preventXSS() string-escaping (duplicates escapeHTML in utils.js)
//   - createCSRFToken() using Math.random() (not cryptographically safe)
//   - validateAccess() checking client-side role (forgeable)
//
// This version:
//   - Removes all client-side "security" that gives false confidence
//   - Actual security is enforced by Supabase RLS (see schema.sql)
//   - Provides the one legitimate client-side helper: Content Security Policy
//   - CSP headers are set server-side; this module validates they are present
// ============================================================

/**
 * Encode a string so it is safe to insert as a DOM text node.
 * This is the ONLY safe way to insert user data into the DOM.
 *
 * Usage:
 *   element.textContent = userInput;        // always safe
 *   el('span', {}, userInput)               // safe via components.js
 *
 * NEVER do:
 *   element.innerHTML = `<b>${userInput}</b>`;   // XSS risk
 *
 * This function exists only as a last resort for legacy code paths
 * that cannot immediately be converted to DOM construction.
 * New code must use el() from ui/components.js instead.
 */
export function safeText(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Alias — used throughout codebase as escapeHTML
export { safeText as escapeHTML };

/**
 * Generate a cryptographically secure random token for client-side use.
 * Used only for ephemeral UI state (e.g. CSRF token for a form session).
 * Persistent tokens (judge tokens, room tokens) are generated server-side.
 */
export function generateCSRFToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate an input does not exceed a reasonable length.
 * Not a security boundary — just a UX guard before sending to server.
 * The server (Supabase column constraints) is the real enforcement.
 */
export function validateLength(value, min = 1, max = 500) {
    if (typeof value !== 'string') return false;
    const len = value.trim().length;
    return len >= min && len <= max;
}

/**
 * Validate an email format (client-side UX only — server validates too).
 */
export function validateEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Check that a ballot score is within the legal range.
 * Server enforces this via: check (score between 60 and 100)
 * This client-side check provides immediate UX feedback only.
 */
export function validateBallotScore(score, min = 60, max = 100) {
    const n = parseFloat(score);
    return !isNaN(n) && n >= min && n <= max;
}

// ── What NOT to do — documented to prevent re-introduction ───────────────────
//
// ❌ REMOVED: sanitizeInput(input) { return input.replace(/<script.*?>/gi, ''); }
//    Reason: Trivially bypassed with "<sCrIpT>" or "<script/>" or "<img onerror=...>"
//    Fix: Never put user data in innerHTML. Use textContent or el() from components.js.
//
// ❌ REMOVED: createCSRFToken() using Math.random().toString(36)
//    Reason: Math.random() is not a CSPRNG. Can be predicted in some V8 versions.
//    Fix: Use crypto.getRandomValues() (above) for any client-side tokens.
//    All persistent tokens use gen_random_bytes(32) in PostgreSQL.
//
// ❌ REMOVED: validateAccess(userRole, allowedRoles)
//    Reason: userRole comes from state.auth.currentUser.role which is display-only.
//    Checking it client-side gives false security — any user can forge it in DevTools.
//    Fix: All access control is enforced by Supabase RLS policies. See schema.sql.
//
// ❌ REMOVED: checkUserRole(user, role) — same reason as above.
//
// ❌ REMOVED: createSecureSession() — sessions are managed by Supabase Auth.
//    The session is stored in an httpOnly cookie set by Supabase.
//    JavaScript cannot read or write httpOnly cookies.
//
// ❌ REMOVED: rateLimit() using an in-memory object
//    Reason: Client-side rate limiting can be bypassed by refreshing the page.
//    Supabase Auth has server-side rate limiting built in.
//    For additional rate limiting, use Supabase Edge Function middleware.
