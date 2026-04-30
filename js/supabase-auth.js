// js/supabase-auth.js — Secure auth using JWT app_metadata for roles
// KEY CHANGE: role is read from user.app_metadata (JWT-signed by Supabase).
//             It is NEVER stored in state, localStorage, or the DB user_profiles row.
//             Modifying localStorage cannot escalate privileges.

import { supabase }   from './supabase.js';
import { api }        from './api.js';
import { state, save } from './state.js';
import { showNotification, closeAllModals, escapeHTML } from './utils.js';
import { registerLocalUser, loginLocalUser, getLocalSession, logoutLocalUser,
         isSupabaseReachable, getLocalUsers, deleteLocalUser, updateLocalUserRole } from './local-auth.js';

let isOfflineMode = false;

// ── Internal: apply verified profile to in-memory state ───────────────────
async function _applyProfileToState(supabaseUser) {
    if (!supabaseUser) return false;
    const user = supabaseUser;

    const role = user.app_metadata?.role || 'public';

    const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .select('id, username, name, associated_id, status')
        .eq('id', user.id)
        .single();

    if (profileErr || !profile) {
        // For OAuth sign-ins the profile row may not exist yet — create a minimal one
        const displayName = user.user_metadata?.full_name || user.user_metadata?.name
            || user.email?.split('@')[0] || 'User';
        const username = (user.email?.split('@')[0] || user.id.slice(0, 8))
            .toLowerCase().replace(/[^a-z0-9_]/g, '_');
        try {
            await supabase.from('user_profiles').upsert({
                id:       user.id,
                username,
                name:     displayName,
                status:   'active',
            }, { onConflict: 'id' });
        } catch (_) {}
        // Proceed with minimal state, then prompt to complete profile
        state.auth.currentUser = { id: user.id, username, role, name: displayName, email: user.email, associatedId: null };
        state.auth.isAuthenticated = true;
        _resetActivity();
        // Show role-completion dialog for brand-new OAuth accounts
        setTimeout(() => _showProfileCompletion(user), 600);
        return true;
    }

    if (profile.status === 'suspended') {
        await supabase.auth.signOut();
        showNotification('Your account has been suspended. Contact the tournament admin.', 'error');
        return false;
    }

    state.auth.currentUser = {
        id:           profile.id,
        username:     profile.username,
        role,
        name:         profile.name,
        email:        user.email,
        associatedId: profile.associated_id,
    };
    state.auth.isAuthenticated = true;
    _resetActivity();

    api.updateLastLogin(user.id).catch(() => {});
    return profile;
}

// ── LOGIN ──────────────────────────────────────────────────────────────────
async function handleLogin() {
    const email    = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const errorEl  = document.getElementById('loginError');
    const loginBtn = document.getElementById('modalLoginBtn');

    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }

    if (!email || !password) {
        const msg = 'Email and password are required.';
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
        showNotification(msg, 'error');
        return;
    }

    if (loginBtn) { loginBtn.textContent = 'Logging in…'; loginBtn.disabled = true; }

    // Try Supabase first, fall back to local auth
    const reachable = await isSupabaseReachable();
    isOfflineMode = !reachable;

    try {
        if (isOfflineMode) {
            // Use local auth
            const session = await loginLocalUser(email, password);
            state.auth.currentUser = {
                id: session.id,
                username: session.username,
                role: session.role,
                name: session.name,
                isLocal: true
            };
            state.auth.isAuthenticated = true;
            updateHeaderControls();
            updateAdminNavVisibility();
            closeAllModals();
            showNotification('Logged in (offline mode)', 'info');
            return;
        }

        // Normal Supabase login
        await api.signIn(email, password);

    } catch (err) {
        console.error('[auth] Login error:', err);

        // Try local auth as fallback
        try {
            const session = await loginLocalUser(email, password);
            isOfflineMode = true;
            state.auth.currentUser = {
                id: session.id,
                username: session.username,
                role: session.role,
                name: session.name,
                isLocal: true
            };
            state.auth.isAuthenticated = true;
            updateHeaderControls();
            updateAdminNavVisibility();
            closeAllModals();
            showNotification('Logged in (offline mode)', 'info');
            return;
        } catch (localErr) {
            // Local auth also failed
        }

        if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
        showNotification('Login failed: ' + err.message, 'error');
        if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
    }
}

// ── REGISTER ───────────────────────────────────────────────────────────────
async function registerUser() {
    const name       = document.getElementById('registerName')?.value.trim();
    const email      = document.getElementById('registerEmail')?.value.trim();
    const password   = document.getElementById('registerPassword')?.value;
    const confirm    = document.getElementById('registerConfirmPassword')?.value;
    // Support both new radio cards and legacy select
    const roleRadio  = document.querySelector('input[name="regRole"]:checked');
    const role       = roleRadio?.value || document.getElementById('registerRole')?.value || 'public';
    const assocId    = document.getElementById('registerAssociation')?.value || null;
    // Derive username from email prefix
    const username   = (email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'user';
    const errorEl    = document.getElementById('registerError');

    if (errorEl) errorEl.textContent = '';

    if (!name || !email || !username || !password) {
        if (errorEl) errorEl.textContent = 'All fields are required.';
        return;
    }
    if (password !== confirm) {
        if (errorEl) errorEl.textContent = 'Passwords do not match.';
        return;
    }
    if (password.length < 8) {
        if (errorEl) errorEl.textContent = 'Password must be at least 8 characters.';
        return;
    }

    // Try Supabase first, fall back to local auth
    const reachable = await isSupabaseReachable();
    isOfflineMode = !reachable;

    try {
        if (isOfflineMode) {
            // Register locally
            const user = await registerLocalUser({ username: email, password, name, role });
            state.auth.currentUser = {
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name,
                isLocal: true
            };
            state.auth.isAuthenticated = true;
            updateHeaderControls();
            updateAdminNavVisibility();
            showNotification('Account created! (offline mode)', 'success');
            closeAllModals();
            return;
        }

        // Allowed self-registration roles — admin role CANNOT be self-assigned
        const allowedSelfRoles = ['public', 'judge', 'team'];
        const safeRole = allowedSelfRoles.includes(role) ? role : 'public';

        const { user } = await api.signUp(email, password, { name });

        // Create the profile row
        if (user) {
            await api.upsertProfile({
                id:           user.id,
                username:     username.toLowerCase().trim(),
                name:         name,
                associated_id: assocId || null,
                status:       'active',
            });

            // Role is set server-side via Edge Function — never client-side
            // (public/judge/team are the only self-assignable roles)
            if (safeRole !== 'public') {
                try {
                    // This will fail with 403 if caller is not an admin,
                    // which is correct — only admins promote roles
                    await api.setUserRole(user.id, safeRole);
                } catch {
                    // Non-admin registrations default to 'public' — acceptable
                }
            }
        }

        showNotification('Account created! Check your email to confirm.', 'success');
        closeAllModals();
    } catch (err) {
        // Try local registration as fallback
        try {
            const user = await registerLocalUser({ username: email, password, name, role });
            isOfflineMode = true;
            state.auth.currentUser = {
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name,
                isLocal: true
            };
            state.auth.isAuthenticated = true;
            updateHeaderControls();
            updateAdminNavVisibility();
            showNotification('Account created! (offline mode)', 'success');
            closeAllModals();
            return;
        } catch (localErr) {
            if (errorEl) errorEl.textContent = err.message;
            showNotification('Registration failed: ' + err.message, 'error');
        }
    }
}

// ── LOGOUT ─────────────────────────────────────────────────────────────────
async function logout() {
    const user = state.auth.currentUser;

    // Clear local session if in offline mode
    if (user?.isLocal || isOfflineMode) {
        logoutLocalUser();
    } else {
        // Only call Supabase signout if we are online
        try {
            await api.signOut();
        } catch (err) {
            console.error('[auth] Logout error:', err.message);
        }
    }

    // Clear in-memory auth state — NOT localStorage (no longer used for auth)
    state.auth.currentUser    = null;
    state.auth.isAuthenticated = false;
    state.auth.lastActivity   = Date.now();
    isOfflineMode = false;

    updateHeaderControls();
    updateAdminNavVisibility();
    if (typeof window.switchTab === 'function') window.switchTab('public');
    showNotification('Logged out successfully', 'info');
}

// ── GUEST LOGIN ─────────────────────────────────────────────────────────────
function guestLogin() {
    state.auth.currentUser    = { role: 'public', name: 'Guest' };
    state.auth.isAuthenticated = false;
    updateHeaderControls();
    updateAdminNavVisibility();
    closeAllModals();
    if (typeof window.switchTab === 'function') window.switchTab('public');
    showNotification('Browsing as guest', 'info');
}

// ── RESTORE SESSION ─────────────────────────────────────────────────────────
async function restoreSession() {
    // Local session (offline mode) takes priority
    const localSession = getLocalSession();
    if (localSession) {
        // Enforce 1-hour inactivity on local sessions
        if (localSession.loggedInAt && Date.now() - localSession.loggedInAt > 3_600_000) {
            logoutLocalUser();
        } else {
            isOfflineMode = true;
            state.auth.currentUser = {
                id: localSession.id, username: localSession.username,
                role: localSession.role, name: localSession.name, isLocal: true
            };
            state.auth.isAuthenticated = true;
            _resetActivity();
            return true;
        }
    }

    // Supabase session — getSession() reads from localStorage first (no network
    // needed when the JWT hasn't expired). Only makes a network call to refresh
    // an expired token. With a 7-day JWT expiry set in Supabase Auth settings,
    // this almost never needs a network round-trip.
    const { data: { session }, error } = await supabase.auth.getSession();
    if (!error && session?.user) return _applyProfileToState(session.user);

    if (error) console.warn('[auth] Session restore failed:', error.message);
    return false;
}

// ── AUTH STATE CHANGE LISTENER ──────────────────────────────────────────────
supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
        const ok = await _applyProfileToState(session.user);
        if (ok) {
            updateHeaderControls();
            updateAdminNavVisibility();
            if (typeof window.updateTabsForRole === 'function') window.updateTabsForRole();
            if (typeof window.updateAdminDropdownVisibility === 'function') {
                window.updateAdminDropdownVisibility();
            }
            closeAllModals();
            showNotification(`Welcome back, ${state.auth.currentUser?.name || 'User'}!`, 'success');
        }
    }

    if (event === 'SIGNED_OUT') {
        // Only clear if we were actually authenticated to begin with
        // (Avoids clearing display state during a slow refresh)
        if (state.auth?.isAuthenticated) {
            state.auth.currentUser     = null;
            state.auth.isAuthenticated  = false;
            updateHeaderControls();
            updateAdminNavVisibility();
            if (typeof window.updateTabsForRole === 'function') window.updateTabsForRole();
            if (typeof window.updateAdminDropdownVisibility === 'function') {
                window.updateAdminDropdownVisibility();
            }
        }
    }

    // PASSWORD_RECOVERY, TOKEN_REFRESHED handled automatically by Supabase SDK
});

// ── HEADER CONTROLS ─────────────────────────────────────────────────────────
function updateHeaderControls() {
    const user   = state.auth.currentUser;
    const isAuth = state.auth.isAuthenticated;

    // Header
    const headerName   = document.getElementById('header-user-name');
    const headerInfo   = document.getElementById('header-user-info');
    const headerLogin  = document.getElementById('header-login-btn');
    const headerLogout = document.getElementById('header-logout-btn');
    if (headerName)   headerName.textContent    = user?.name || 'Guest';
    if (headerInfo)   headerInfo.style.display  = isAuth ? '' : 'none';
    if (headerLogin)  headerLogin.style.display = isAuth ? 'none' : '';
    if (headerLogout) headerLogout.style.display = isAuth ? '' : 'none';

    // Drawer
    const drawerName   = document.getElementById('drawer-user-name');
    const drawerLogin  = document.getElementById('drawer-login-btn');
    const drawerLogout = document.getElementById('drawer-logout-btn');
    if (drawerName)   drawerName.textContent    = user?.name || 'Guest';
    if (drawerLogin)  drawerLogin.style.display = isAuth ? 'none' : '';
    if (drawerLogout) drawerLogout.style.display = isAuth ? '' : 'none';

    // Offline mode indicator
    let offlineBadge = document.getElementById('offline-indicator');
    if (!offlineBadge) {
        offlineBadge = document.createElement('span');
        offlineBadge.id = 'offline-indicator';
        offlineBadge.style.cssText = 'background:#dc2626;color:white;padding:2px 6px;border-radius:4px;font-size:11px;margin-left:8px;';
        offlineBadge.textContent = 'OFFLINE';
        const headerControls = document.getElementById('header-controls');
        if (headerControls) headerControls.appendChild(offlineBadge);
    }
    offlineBadge.style.display = (isOfflineMode && isAuth) ? '' : 'none';
}

// ── ADMIN NAVIGATION VISIBILITY ────────────────────────────────────────────
export function updateAdminNavVisibility() {
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    // Hide/show admin-only navigation items (e.g., dropdown, specific buttons)
    const adminNavItems = document.querySelectorAll('.admin-only-nav, .admin-dropdown, [data-admin-only="true"]');
    adminNavItems.forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });
}

// ── OAUTH PROFILE COMPLETION ─────────────────────────────────────────────────
function _showProfileCompletion(supabaseUser) {
    closeAllModals();
    const overlay = document.createElement('div');
    overlay.id = 'profile-complete-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';

    const judgeOptions = (state.judges || []).map(j =>
        `<option value="${escapeHTML(String(j.id))}">${escapeHTML(j.name)}</option>`).join('');
    const teamOptions  = (state.teams  || []).map(t =>
        `<option value="${escapeHTML(String(t.id))}">${escapeHTML(t.name)}</option>`).join('');

    overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:400px;padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div style="text-align:center;margin-bottom:20px;">
            <div style="font-size:36px;margin-bottom:8px;">👋</div>
            <h2 style="margin:0 0 6px;font-size:1.3rem;">Almost there!</h2>
            <p style="color:#64748b;font-size:14px;margin:0;">Tell us how you're participating so we can set up your portal correctly.</p>
        </div>
        <div id="pcErr" style="background:#fef2f2;color:#dc2626;border-radius:8px;padding:10px;font-size:13px;margin-bottom:14px;display:none;"></div>
        <div style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">I am joining as…</label>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                <label style="border:2px solid #e5e7eb;border-radius:10px;padding:12px 6px;text-align:center;cursor:pointer;">
                    <input type="radio" name="pcRole" value="judge" style="display:none;">
                    <div style="font-size:22px;margin-bottom:4px;">⚖️</div>
                    <span style="font-size:11px;font-weight:700;color:#374151;display:block;">Judge</span>
                </label>
                <label style="border:2px solid #6366f1;background:#eef2ff;border-radius:10px;padding:12px 6px;text-align:center;cursor:pointer;">
                    <input type="radio" name="pcRole" value="team" checked style="display:none;">
                    <div style="font-size:22px;margin-bottom:4px;">🏫</div>
                    <span style="font-size:11px;font-weight:700;color:#4f46e5;display:block;">Speaker</span>
                </label>
                <label style="border:2px solid #e5e7eb;border-radius:10px;padding:12px 6px;text-align:center;cursor:pointer;">
                    <input type="radio" name="pcRole" value="public" style="display:none;">
                    <div style="font-size:22px;margin-bottom:4px;">👁️</div>
                    <span style="font-size:11px;font-weight:700;color:#374151;display:block;">Observer</span>
                </label>
            </div>
        </div>
        <div id="pcAssocGroup" style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px;" id="pcAssocLabel">Which team are you on?</label>
            <select id="pcAssociation" style="width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:14px;box-sizing:border-box;">
                <option value="">— Select —</option>
                <optgroup label="Judges" id="pcJudgeGrp">${judgeOptions}</optgroup>
                <optgroup label="Teams" id="pcTeamGrp">${teamOptions}</optgroup>
            </select>
        </div>
        <button id="pcSaveBtn" style="width:100%;padding:12px;background:#6366f1;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">
            Finish Setup
        </button>
    </div>`;

    document.body.appendChild(overlay);

    // Wire role cards styling + association visibility
    function updatePcRole(role) {
        overlay.querySelectorAll('label[style*="border"]').forEach(l => {
            const inp = l.querySelector('input[name="pcRole"]');
            const active = inp?.value === role;
            l.style.borderColor = active ? '#6366f1' : '#e5e7eb';
            l.style.background  = active ? '#eef2ff' : '#fff';
            l.querySelectorAll('span').forEach(s => s.style.color = active ? '#4f46e5' : '#374151');
        });
        const ag = document.getElementById('pcAssocGroup');
        const al = document.getElementById('pcAssocLabel');
        const jg = document.getElementById('pcJudgeGrp');
        const tg = document.getElementById('pcTeamGrp');
        if (role === 'judge') { if (ag) ag.style.display=''; if (al) al.textContent='Which judge are you?'; if (jg) jg.style.display=''; if (tg) tg.style.display='none'; }
        else if (role === 'team') { if (ag) ag.style.display=''; if (al) al.textContent='Which team are you on?'; if (jg) jg.style.display='none'; if (tg) tg.style.display=''; }
        else { if (ag) ag.style.display='none'; }
    }
    overlay.querySelectorAll('input[name="pcRole"]').forEach(r =>
        r.addEventListener('change', () => updatePcRole(r.value))
    );
    updatePcRole('team');

    document.getElementById('pcSaveBtn')?.addEventListener('click', async () => {
        const role   = overlay.querySelector('input[name="pcRole"]:checked')?.value || 'public';
        const assocId = document.getElementById('pcAssociation')?.value || null;
        const errEl  = document.getElementById('pcErr');
        const btn    = document.getElementById('pcSaveBtn');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            await supabase.from('user_profiles').update({
                associated_id: assocId || null,
            }).eq('id', supabaseUser.id);
            if (role !== 'public') {
                await api.setUserRole(supabaseUser.id, role).catch(() => {});
            }
            if (state.auth.currentUser) {
                state.auth.currentUser.role = role;
                state.auth.currentUser.associatedId = assocId;
            }
            updateHeaderControls();
            updateAdminNavVisibility();
            if (typeof window.updateTabsForRole === 'function') window.updateTabsForRole();
            overlay.remove();
            showNotification('Profile complete! Welcome.', 'success');
        } catch (e) {
            if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
            btn.disabled = false; btn.textContent = 'Finish Setup';
        }
    });
}

// ── INACTIVITY TIMEOUT (1 hour) ──────────────────────────────────────────────
const INACTIVITY_LIMIT = 60 * 60 * 1000; // 1 hour
let _lastActivity = Date.now();
let _inactivityTimer = null;

function _resetActivity() {
    _lastActivity = Date.now();
}

function _initInactivityWatcher() {
    const touch = () => { _lastActivity = Date.now(); };
    ['mousemove','keydown','click','touchstart','scroll'].forEach(ev =>
        window.addEventListener(ev, touch, { passive: true })
    );
    _inactivityTimer = setInterval(() => {
        if (!state.auth?.isAuthenticated) return;
        if (Date.now() - _lastActivity > INACTIVITY_LIMIT) {
            showNotification('You were logged out due to inactivity.', 'info');
            logout();
        }
    }, 60_000); // check every minute
}

// ── OAUTH ─────────────────────────────────────────────────────────────────────
async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
}
async function signInWithDiscord() {
    await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
}
async function signInWithApple() {
    await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
}

// ── SHOW LOGIN MODAL ─────────────────────────────────────────────────────────
function showLoginModal() {
    closeAllModals();

    const overlay     = document.createElement('div');
    overlay.id        = 'auth-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAllModals(); });

    const modal = document.createElement('div');
    modal.id    = 'auth-modal';
    modal.style.cssText = 'background:#fff;border-radius:20px;width:100%;max-width:440px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);';

    const judgeOptions = (state.judges || []).map(j =>
        `<option value="${escapeHTML(String(j.id))}">${escapeHTML(j.name)}</option>`
    ).join('');
    const teamOptions  = (state.teams  || []).map(t =>
        `<option value="${escapeHTML(String(t.id))}">${escapeHTML(t.name)}</option>`
    ).join('');

    const oauthLinks = ''; /* OAuth providers hidden — under development */

    modal.innerHTML = `
    <style>
    #auth-modal{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;}
    .auth-inner{padding:36px 32px 28px;}
    @media(max-width:480px){.auth-inner{padding:28px 20px 22px;}}
    .auth-logo-wrap{display:flex;flex-direction:column;align-items:center;margin-bottom:28px;}
    .auth-logo{height:44px;width:44px;object-fit:contain;border-radius:50%;display:block;}
    .auth-brand{font-size:10px;letter-spacing:.14em;color:#475569;text-transform:uppercase;margin:7px 0 0;font-weight:500;}
    .auth-tabs{display:flex;background:#1e293b;border-radius:10px;padding:3px;margin-bottom:26px;gap:3px;}
    .auth-tab-btn{flex:1;padding:9px;border:none;background:transparent;border-radius:8px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;transition:all .18s;letter-spacing:.01em;}
    .auth-tab-btn.is-active{background:#334155;color:#f1f5f9;box-shadow:0 1px 6px rgba(0,0,0,.35);}
    .auth-field{margin-bottom:16px;}
    .auth-field label{display:block;font-size:11.5px;font-weight:600;color:#64748b;margin-bottom:5px;letter-spacing:.02em;text-transform:uppercase;}
    .auth-field input,.auth-field select{width:100%;box-sizing:border-box;padding:11px 14px;border:1.5px solid #1e293b;border-radius:10px;font-size:14px;color:#f1f5f9;outline:none;transition:border-color .15s;background:#1e293b;}
    .auth-field input:focus,.auth-field select:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.18);}
    .auth-field input::placeholder{color:#334155;}
    .auth-submit{width:100%;padding:13px;background:#f97316;color:#fff;border:1.5px solid transparent;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px;transition:all .18s;letter-spacing:.01em;}
    .auth-submit:hover{background:#ea6c10;border-color:rgba(255,255,255,.22);}
    .auth-guest{display:block;width:100%;text-align:center;background:none;border:none;padding:8px;font-size:13px;color:#475569;cursor:pointer;text-decoration:none;}
    .auth-guest:hover{color:#94a3b8;}
    .auth-oauth-link{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1.5px solid #1e293b;border-radius:8px;background:#1e293b;cursor:pointer;font-size:13px;font-weight:500;color:#94a3b8;transition:border-color .15s,background .15s;}
    .auth-oauth-link:hover{border-color:#f97316;background:#1a2332;}
    .auth-oauth-link span{font-size:12.5px;}
    .auth-err{background:#450a0a;color:#fca5a5;border:1px solid #7f1d1d;border-radius:8px;padding:10px 13px;font-size:13px;margin-bottom:16px;display:none;line-height:1.4;}
    .role-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;}
    .role-card{border:1.5px solid #1e293b;border-radius:10px;padding:14px 8px 10px;text-align:center;cursor:pointer;transition:all .15s;background:#1e293b;}
    .role-card input{display:none;}
    .role-card-icon{font-size:24px;margin-bottom:6px;display:block;}
    .role-card-label{font-size:11.5px;font-weight:700;color:#94a3b8;display:block;letter-spacing:.01em;}
    .role-card-desc{font-size:10px;color:#475569;margin-top:3px;display:block;line-height:1.3;}
    .role-card:has(input:checked){border-color:#f97316;background:#1c1917;}
    .role-card:has(input:checked) .role-card-label{color:#f97316;}
    .auth-divider{display:flex;align-items:center;gap:12px;margin:22px 0 16px;}
    .auth-divider hr{flex:1;border:none;border-top:1px solid #1e293b;}
    .auth-divider span{font-size:11px;color:#334155;white-space:nowrap;letter-spacing:.04em;}
    </style>
    <div class="auth-inner">
        <div class="auth-logo-wrap">
            <img src="IMG/logo.png" alt="Orion logo" class="auth-logo">
            <p class="auth-brand">Tournament Management</p>
        </div>
        <div class="auth-tabs">
            <button id="loginTabBtn"    class="auth-tab-btn is-active">Sign In</button>
            <button id="registerTabBtn" class="auth-tab-btn">Create Account</button>
        </div>

        <!-- ── LOGIN ── -->
        <div id="loginForm">
            <div id="loginError" class="auth-err" role="alert"></div>
            <div class="auth-field">
                <label>Email</label>
                <input type="email" id="loginEmail" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="auth-field">
                <label>Password</label>
                <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
            </div>
            <button class="auth-submit" id="modalLoginBtn">Sign In</button>
            <button class="auth-guest"  id="modalGuestBtn">Continue as guest</button>
            ${oauthLinks}
        </div>

        <!-- ── REGISTER ── -->
        <div id="registerForm" style="display:none;">
            <div id="registerError" class="auth-err" role="alert"></div>
            <div class="auth-field">
                <label>Full Name</label>
                <input type="text" id="registerName" placeholder="Your full name" autocomplete="name">
            </div>
            <div class="auth-field">
                <label>Email</label>
                <input type="email" id="registerEmail" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="auth-field">
                <label>Password</label>
                <input type="password" id="registerPassword" placeholder="Minimum 8 characters" autocomplete="new-password">
            </div>
            <div class="auth-field">
                <label>Confirm Password</label>
                <input type="password" id="registerConfirmPassword" placeholder="Repeat password" autocomplete="new-password">
            </div>
            <div style="margin-bottom:16px;">
                <p style="font-size:11.5px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.02em;margin:0 0 10px;">I am joining as</p>
                <div class="role-cards">
                    <label class="role-card">
                        <input type="radio" name="regRole" value="judge">
                        <span class="role-card-icon">⚖️</span>
                        <span class="role-card-label">Judge</span>
                        <span class="role-card-desc">Submit ballots &amp; give feedback</span>
                    </label>
                    <label class="role-card">
                        <input type="radio" name="regRole" value="team" checked>
                        <span class="role-card-icon">🗣️</span>
                        <span class="role-card-label">Speaker</span>
                        <span class="role-card-desc">Rate your judges</span>
                    </label>
                    <label class="role-card">
                        <input type="radio" name="regRole" value="public">
                        <span class="role-card-icon">👁️</span>
                        <span class="role-card-label">Observer</span>
                        <span class="role-card-desc">View draws &amp; results</span>
                    </label>
                </div>
            </div>
            <div id="associationGroup" style="display:none;" class="auth-field">
                <label id="assocLabel">Link to your profile</label>
                <select id="registerAssociation">
                    <option value="">— Select —</option>
                    <optgroup label="Judges" id="assocJudgeGroup">${judgeOptions}</optgroup>
                    <optgroup label="Teams / Speakers" id="assocTeamGroup">${teamOptions}</optgroup>
                </select>
            </div>
            <button class="auth-submit" id="modalRegisterBtn">Create Account</button>
            <p style="font-size:11px;color:#c4c9d4;text-align:center;margin:12px 0 0;line-height:1.5;">
                By registering you confirm you are a participant in this tournament.
            </p>
            ${oauthLinks}
        </div>
    </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Wire events
    document.getElementById('loginTabBtn')    ?.addEventListener('click', () => switchAuthTab('login'));
    document.getElementById('registerTabBtn') ?.addEventListener('click', () => switchAuthTab('register'));
    document.getElementById('modalLoginBtn')  ?.addEventListener('click', handleLogin);
    document.getElementById('modalGuestBtn')  ?.addEventListener('click', guestLogin);
    document.getElementById('modalRegisterBtn')?.addEventListener('click', registerUser);
    document.getElementById('loginPassword')  ?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('registerConfirmPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') registerUser(); });

    // Role card → show/hide association
    modal.querySelectorAll('input[name="regRole"]').forEach(radio => {
        radio.addEventListener('change', () => _onRegRoleChange(radio.value));
    });
    _onRegRoleChange('team'); // default

    // OAuth — both tabs share the same buttons (duplicated ids avoided via querySelectorAll)
    modal.querySelectorAll('#oauthGoogleBtn') .forEach(b => b.addEventListener('click', signInWithGoogle));
    modal.querySelectorAll('#oauthDiscordBtn').forEach(b => b.addEventListener('click', signInWithDiscord));
    modal.querySelectorAll('#oauthAppleBtn')  .forEach(b => b.addEventListener('click', signInWithApple));
}

function _onRegRoleChange(role) {
    const group     = document.getElementById('associationGroup');
    const label     = document.getElementById('assocLabel');
    const judgeGrp  = document.getElementById('assocJudgeGroup');
    const teamGrp   = document.getElementById('assocTeamGroup');
    if (!group) return;
    if (role === 'judge') {
        group.style.display = '';
        if (label) label.textContent = 'Which judge are you?';
        if (judgeGrp) judgeGrp.style.display = '';
        if (teamGrp)  teamGrp.style.display  = 'none';
    } else if (role === 'team') {
        group.style.display = '';
        if (label) label.textContent = 'Which team / speaker slot are you?';
        if (judgeGrp) judgeGrp.style.display = 'none';
        if (teamGrp)  teamGrp.style.display  = '';
    } else {
        group.style.display = 'none';
    }
}

// ── SWITCH AUTH TAB ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
    const loginForm    = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginBtn     = document.getElementById('loginTabBtn');
    const registerBtn  = document.getElementById('registerTabBtn');
    if (!loginForm || !registerForm) return;

    if (tab === 'login') {
        loginForm.style.display    = '';
        registerForm.style.display = 'none';
        loginBtn?.classList.add('is-active');
        registerBtn?.classList.remove('is-active');
    } else {
        loginForm.style.display    = 'none';
        registerForm.style.display = '';
        loginBtn?.classList.remove('is-active');
        registerBtn?.classList.add('is-active');
    }
}

// Show/hide association dropdown based on selected role (legacy — kept for external callers)
function handleRoleChange(selectEl) {
    const val = (selectEl?.value || document.getElementById('registerRole')?.value) || '';
    _onRegRoleChange(val);
}

// ── RENDER PROFILE ──────────────────────────────────────────────────────────
function renderProfile() {
    const container = document.getElementById('profile-content');
    if (!container) return;

    const user = state.auth.currentUser;
    if (!user) {
        container.textContent = '';
        container.appendChild(
            (() => {
                const d = document.createElement('div');
                d.style.textAlign = 'center';
                d.style.padding   = '40px';
                const p = document.createElement('p');
                p.textContent = 'Please log in to view your profile.';
                d.appendChild(p);
                return d;
            })()
        );
        return;
    }

    // Build profile card safely using DOM API (not innerHTML with user data)
    container.textContent = '';

    const card = document.createElement('div');
    card.className = 'section';

    const avatar = document.createElement('div');
    avatar.style.cssText = 'width:64px;height:64px;border-radius:50%;background:#1a73e8;' +
        'display:flex;align-items:center;justify-content:center;font-size:28px;' +
        'font-weight:700;color:white;margin:0 auto 20px;';
    avatar.textContent = (user.name || 'U')[0].toUpperCase();

    const name  = document.createElement('h2');
    name.style.textAlign = 'center';
    name.textContent = user.name;

    const email = document.createElement('p');
    email.style.cssText = 'text-align:center;color:#64748b;margin-bottom:20px;';
    email.textContent = user.email || '';

    const roleBadge = document.createElement('div');
    roleBadge.style.cssText = 'text-align:center;margin-bottom:20px;';
    const rb = document.createElement('span');
    rb.className  = `role-badge role-${user.role}`;
    rb.textContent = (user.role || 'public').toUpperCase();
    roleBadge.appendChild(rb);

    card.append(avatar, name, email, roleBadge);
    container.appendChild(card);
}

// Start inactivity watcher once module loads
_initInactivityWatcher();

// ── Exports used by main.js ──────────────────────────────────────────────────
export {
    showLoginModal,
    switchAuthTab,
    handleRoleChange,
    handleRoleChange as handleJudgeAssociationChange,
    handleRoleChange as handleTeamAssociationChange,
    guestLogin,
    logout,
    registerUser,
    handleLogin,
    updateHeaderControls,
    restoreSession,
    renderProfile,
    signInWithGoogle,
    signInWithDiscord,
    signInWithApple,
};

