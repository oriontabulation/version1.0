// js/supabase-auth.js — Secure auth using JWT app_metadata for roles
import { supabase } from './supabase.js';
import { api } from './api.js';
import { state, save } from './state.js';
import { showNotification, closeAllModals, escapeHTML } from './utils.js';
import {
    registerLocalUser, loginLocalUser, getLocalSession, logoutLocalUser,
    isSupabaseReachable, getLocalUsers, deleteLocalUser, updateLocalUserRole
} from './local-auth.js';

let isOfflineMode = false;
let _restoreInProgress = false;
let _explicitLogoutInProgress = false;
let _lastManualSignInAt = 0;
let _authApplyGeneration = 0;
const _profileApplyInFlight = new Map();

function _looksLikeConnectionError(err) {
    const message = String(err?.message || '').toLowerCase();
    return message.includes('timeout')
        || message.includes('network')
        || message.includes('failed to fetch')
        || message.includes('internet')
        || message.includes('connection');
}

function _sessionApplyKey(sessionOrUser) {
    const user = sessionOrUser?.user || sessionOrUser;
    if (!user?.id) return null;
    const token = sessionOrUser?.access_token || '';
    return `${user.id}:${token.slice(-16)}`;
}

function _applySessionUserOnce(sessionOrUser) {
    const user = sessionOrUser?.user || sessionOrUser;
    const key = _sessionApplyKey(sessionOrUser) || user?.id;
    if (!user) return Promise.resolve(false);
    if (key && _profileApplyInFlight.has(key)) return _profileApplyInFlight.get(key);

    const task = _applyProfileToState(user)
        .catch(err => {
            console.warn('[auth] Failed to apply auth session:', err?.message || err);
            return false;
        })
        .finally(() => {
            if (key) _profileApplyInFlight.delete(key);
        });

    if (key) _profileApplyInFlight.set(key, task);
    return task;
}

function _refreshAuthDependentUI() {
    updateHeaderControls();
    updateAdminNavVisibility();
    if (typeof window.updateTabsForRole === 'function') window.updateTabsForRole();
    if (typeof window.updateAdminDropdownVisibility === 'function') {
        window.updateAdminDropdownVisibility();
    }
    const role = state.auth?.currentUser?.role;
    if (role !== 'admin') {
        document.body.classList.remove('admin-mode');
        document.querySelectorAll('.adm-topbar,.adm-layout,.adm-sidebar,.adm-backdrop').forEach(el => {
            el.style.display = 'none';
        });
        const activeTab = document.querySelector('.tab-content.active')?.id;
        if (activeTab === 'admin-dashboard' && typeof window.switchTab === 'function') {
            window.switchTab(role === 'team' ? 'portal' : 'public');
        }
    }
}

// ── Internal: apply verified profile to in-memory state ───────────────────
async function _applyProfileToState(supabaseUser) {
    const applyGeneration = _authApplyGeneration;
    if (!supabaseUser) return false;
    const user = supabaseUser;

    const role = user.app_metadata?.role || 'public';

    const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .select('id, username, name, associated_id, status')
        .eq('id', user.id)
        .single();

    if (profileErr || !profile) {
        if (applyGeneration !== _authApplyGeneration) return false;
        // For OAuth sign-ins the profile row may not exist yet — create a minimal one
        const displayName = user.user_metadata?.full_name || user.user_metadata?.name
            || user.email?.split('@')[0] || 'User';
        const username = (user.email?.split('@')[0] || user.id.slice(0, 8))
            .toLowerCase().replace(/[^a-z0-9_]/g, '_');
        try {
            await supabase.from('user_profiles').upsert({
                id: user.id,
                username,
                name: displayName,
                status: 'active',
            }, { onConflict: 'id' });
        } catch (_) {
            // Profile creation is best-effort; minimal in-memory auth state is enough to proceed.
        }
        // Proceed with minimal state, then prompt to complete profile
        state.auth.currentUser = { id: user.id, username, role, name: displayName, email: user.email, associatedId: null };
        state.auth.isAuthenticated = true;
        _resetActivity();
        // Show role-completion dialog for brand-new OAuth accounts
        setTimeout(() => _showProfileCompletion(user), 600);
        return true;
    }

    if (profile.status === 'suspended') {
        await supabase.auth.signOut({ scope: 'local' });
        showNotification('Your account has been suspended. Contact the tournament admin.', 'error');
        return false;
    }

    if (applyGeneration !== _authApplyGeneration) return false;

    state.auth.currentUser = {
        id: profile.id,
        username: profile.username,
        role,
        name: profile.name,
        email: user.email,
        associatedId: profile.associated_id,
    };
    state.auth.isAuthenticated = true;
    _resetActivity();

    api.updateLastLogin(user.id).catch(() => { });
    return true;
}

// ── LOGIN ──────────────────────────────────────────────────────────────────
async function handleLogin() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const errorEl = document.getElementById('loginError');
    const loginBtn = document.getElementById('modalLoginBtn');

    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }

    if (!email || !password) {
        const msg = 'Email and password are required.';
        if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
        showNotification(msg, 'error');
        return;
    }

    if (loginBtn) { loginBtn.textContent = 'Logging in…'; loginBtn.disabled = true; }

    // Clear stale sessions before replacing the current user on shared devices.
    _authApplyGeneration++;
    state.auth.currentUser = null;
    state.auth.isAuthenticated = false;
    updateHeaderControls();
    updateAdminNavVisibility();
    logoutLocalUser();
    try { await supabase.auth.signOut({ scope: 'local' }); } catch (_) { /* ignore stale session cleanup */ }

    try {
        _authApplyGeneration++;
        const data = await api.signIn(email, password);
        const user = data?.user || data?.session?.user;
        if (user) {
            const ok = await _applySessionUserOnce(data?.session || user);
            if (ok) {
                isOfflineMode = false;
                _refreshAuthDependentUI();
                _lastManualSignInAt = Date.now();
                if (state.auth.currentUser?.role === 'admin' && typeof window.ensureDefaultTournamentForAdmin === 'function') {
                    await window.ensureDefaultTournamentForAdmin().catch(() => null);
                }
                closeAllModals();
                const role = state.auth.currentUser?.role;
                if (typeof window.switchTab === 'function') {
                    window.switchTab(role === 'admin' ? 'admin-dashboard' : role === 'team' ? 'portal' : 'public');
                }
                showNotification(`Welcome back, ${state.auth.currentUser?.name || 'User'}!`, 'success');
                return;
            }
        }

        closeAllModals();
    } catch (err) {
        console.error('[auth] Login error:', err);

        // Fall back to local auth only for connectivity failures, not wrong passwords.
        if (_looksLikeConnectionError(err) || !(await isSupabaseReachable())) {
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
                _refreshAuthDependentUI();
                closeAllModals();
                showNotification('Logged in (offline mode)', 'info');
                return;
            } catch (_) {
                // Local fallback is optional; keep the original Supabase error visible.
            }
        }

        if (errorEl) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
        showNotification('Login failed: ' + err.message, 'error');
        if (loginBtn) { loginBtn.textContent = 'Sign In'; loginBtn.disabled = false; }
    }
}

// ── REGISTER ───────────────────────────────────────────────────────────────
async function registerUser() {
    const name = document.getElementById('registerName')?.value.trim();
    const email = document.getElementById('registerEmail')?.value.trim();
    const password = document.getElementById('registerPassword')?.value;
    const confirm = document.getElementById('registerConfirmPassword')?.value;
    // Support both new radio cards and legacy select
    const roleRadio = document.querySelector('input[name="regRole"]:checked');
    const role = roleRadio?.value || document.getElementById('registerRole')?.value || 'public';
    const assocId = document.getElementById('registerAssociation')?.value || null;
    // Derive username from email prefix
    const username = (email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'user';
    const errorEl = document.getElementById('registerError');

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
            _refreshAuthDependentUI();
            showNotification('Account created! (offline mode)', 'success');
            closeAllModals();
            return;
        }

        // Only observers can self-register; judges/speakers are added by admins
        const safeRole = 'public';

        const { user } = await api.signUp(email, password, { name });

        // Create the profile row
        if (user) {
            await api.upsertProfile({
                id: user.id,
                username: username.toLowerCase().trim(),
                name: name,
                email: email.toLowerCase().trim(),
                associated_id: assocId || null,
                status: 'active',
            });

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
            _refreshAuthDependentUI();
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
    _explicitLogoutInProgress = true;
    _authApplyGeneration++;

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
    state.auth.currentUser = null;
    state.auth.isAuthenticated = false;
    state.auth.lastActivity = Date.now();
    isOfflineMode = false;

    _refreshAuthDependentUI();
    if (typeof window.switchTab === 'function') window.switchTab('public');
    showNotification('Logged out successfully', 'info');
    setTimeout(() => { _explicitLogoutInProgress = false; }, 1000);
}

// ── GUEST LOGIN ─────────────────────────────────────────────────────────────
function guestLogin() {
    _authApplyGeneration++;
    state.auth.currentUser = { role: 'public', name: 'Guest' };
    state.auth.isAuthenticated = false;
    _refreshAuthDependentUI();
    closeAllModals();
    if (typeof window.switchTab === 'function') window.switchTab('public');
    showNotification('Browsing as guest', 'info');
}

// ── RESTORE SESSION ─────────────────────────────────────────────────────────
async function restoreSession() {
    _restoreInProgress = true;
    try {
        // Prefer online Supabase session when available.
        // Stale offline sessions can block normal logins on shared browsers.
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!error && session?.user) {
            logoutLocalUser();
            isOfflineMode = false;
            _authApplyGeneration++;
            return _applySessionUserOnce(session);
        }

        const localSession = getLocalSession();

        if (localSession) {
            // Enforce configured inactivity on local sessions
            if (localSession.loggedInAt && Date.now() - localSession.loggedInAt > _getInactivityLimitMs()) {
                logoutLocalUser();
            } else {
                const reachable = await isSupabaseReachable();
                if (!reachable) {
                    isOfflineMode = true;
                    state.auth.currentUser = {
                        id: localSession.id,
                        username: localSession.username,
                        role: localSession.role,
                        name: localSession.name,
                        isLocal: true
                    };
                    state.auth.isAuthenticated = true;
                    _resetActivity();
                    _refreshAuthDependentUI();
                    return true;
                }
                // Supabase is reachable and there's no online session: clear stale local login
                logoutLocalUser();
            }
        }

        if (error) {
            console.warn('[auth] Session restore failed:', error.message);
        }
        return false;
    } finally {
        setTimeout(() => { _restoreInProgress = false; }, 750);
    }
}

async function _handleAuthStateChange(event, session) {
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
        const ok = await _applySessionUserOnce(session);
        if (ok) {
            _refreshAuthDependentUI();
            const justHandledByLogin = Date.now() - _lastManualSignInAt < 1500;
            if (event === 'SIGNED_IN' && !_restoreInProgress && !justHandledByLogin) {
                closeAllModals();
                showNotification(`Welcome back, ${state.auth.currentUser?.name || 'User'}!`, 'success');
            }
        }
    }

    if (event === 'SIGNED_OUT') {
        if (!_explicitLogoutInProgress || _restoreInProgress) return;
        if (state.auth?.isAuthenticated && state.auth.currentUser) {
            state.auth.currentUser = null;
            state.auth.isAuthenticated = false;
            _refreshAuthDependentUI();
        }
    }

    // Handle token refresh
    if (event === 'TOKEN_REFRESHED' && session?.user) {
        if (state.auth.isAuthenticated) {
            // Update role from app_metadata
            const newRole = session.user.app_metadata?.role || state.auth.currentUser?.role || 'public';
            if (state.auth.currentUser) {
                state.auth.currentUser.role = newRole;
            }
            _refreshAuthDependentUI();
        }
    }
}

// ── AUTH STATE CHANGE LISTENER ──────────────────────────────────────────────
supabase.auth.onAuthStateChange((event, session) => {
    // Keep Supabase's auth callback synchronous. Database/profile work is
    // deferred so refresh and sign-in events cannot block the auth client.
    setTimeout(() => {
        _handleAuthStateChange(event, session).catch(err => {
            console.warn('[auth] Auth state handler failed:', err?.message || err);
        });
    }, 0);
});

// ── HEADER CONTROLS ─────────────────────────────────────────────────────────
function updateHeaderControls() {
    const user = state.auth.currentUser;
    const isAuth = state.auth.isAuthenticated;

    // Header
    const headerName = document.getElementById('header-user-name');
    const headerInfo = document.getElementById('header-user-info');
    const headerLogin = document.getElementById('header-login-btn');
    const headerLogout = document.getElementById('header-logout-btn');
    const settingsWrapper = document.getElementById('header-settings-wrapper');
    if (headerName) headerName.textContent = user?.name || 'Guest';
    if (headerInfo) headerInfo.style.display = isAuth ? '' : 'none';
    if (headerLogin) headerLogin.style.display = isAuth ? 'none' : '';
    if (settingsWrapper) settingsWrapper.style.display = '';

    // Settings dropdown: theme/display controls are always visible; account actions are auth-only.
    const settingsDropdown = document.getElementById('header-settings-dropdown');
    if (settingsDropdown) {
        const profileItem = settingsDropdown.querySelector('button[onclick*="profile"]');
        const logoutItem = settingsDropdown.querySelector('[data-action="logout"]');
        if (profileItem) profileItem.style.display = isAuth ? '' : 'none';
        if (logoutItem) logoutItem.style.display = isAuth ? '' : 'none';
    }

    // Admin nav item
    const adminNavItem = document.getElementById('admin-nav-item');
    const isAdmin = user?.role === 'admin';
    if (adminNavItem) adminNavItem.style.display = (isAuth && isAdmin) ? 'block' : 'none';

    // Admin header user name display
    const adminUserDisplay = document.getElementById('header-user-name-display');
    if (adminUserDisplay) adminUserDisplay.textContent = user?.name || '';

    // Drawer
    const drawerName = document.getElementById('drawer-user-name');
    const drawerLogin = document.getElementById('drawer-login-btn');
    const drawerLogout = document.getElementById('drawer-logout-btn');
    if (drawerName) drawerName.textContent = user?.name || 'Guest';
    if (drawerLogin) drawerLogin.style.display = isAuth ? 'none' : '';
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
    const teamOptions = (state.teams || []).map(t =>
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
            <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                <label style="border:2px solid #6366f1;background:#eef2ff;border-radius:10px;padding:12px 6px;text-align:center;cursor:pointer;">
                    <input type="radio" name="pcRole" value="public" checked style="display:none;">
                    <div style="font-size:22px;margin-bottom:4px;">👁️</div>
                    <span style="font-size:11px;font-weight:700;color:#4f46e5;display:block;">Observer</span>
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
            l.style.background = active ? '#eef2ff' : '#fff';
            l.querySelectorAll('span').forEach(s => s.style.color = active ? '#4f46e5' : '#374151');
        });
        const ag = document.getElementById('pcAssocGroup');
        const al = document.getElementById('pcAssocLabel');
        const jg = document.getElementById('pcJudgeGrp');
        const tg = document.getElementById('pcTeamGrp');
        if (role === 'judge') { if (ag) ag.style.display = ''; if (al) al.textContent = 'Which judge are you?'; if (jg) jg.style.display = ''; if (tg) tg.style.display = 'none'; }
        else if (role === 'team') { if (ag) ag.style.display = ''; if (al) al.textContent = 'Which team are you on?'; if (jg) jg.style.display = 'none'; if (tg) tg.style.display = ''; }
        else { if (ag) ag.style.display = 'none'; }
    }
    overlay.querySelectorAll('input[name="pcRole"]').forEach(r =>
        r.addEventListener('change', () => updatePcRole(r.value))
    );
    updatePcRole('team');

    document.getElementById('pcSaveBtn')?.addEventListener('click', async () => {
        const role = overlay.querySelector('input[name="pcRole"]:checked')?.value || 'public';
        const assocId = document.getElementById('pcAssociation')?.value || null;
        const errEl = document.getElementById('pcErr');
        const btn = document.getElementById('pcSaveBtn');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            await supabase.from('user_profiles').update({
                associated_id: assocId || null,
            }).eq('id', supabaseUser.id);
            if (role !== 'public') {
                await api.setUserRole(supabaseUser.id, role).catch(() => { });
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
const INACTIVITY_SETTING_KEY = 'orion_inactivity_timeout_minutes';
const DEFAULT_INACTIVITY_MINUTES = 30;
let _lastActivity = Date.now();
let _inactivityTimer = null;

function _resetActivity() {
    _lastActivity = Date.now();
}

function _getInactivityMinutes() {
    const raw = Number(localStorage.getItem(INACTIVITY_SETTING_KEY) || DEFAULT_INACTIVITY_MINUTES);
    return [15, 30, 60, 120, 240].includes(raw) ? raw : DEFAULT_INACTIVITY_MINUTES;
}

function _getInactivityLimitMs() {
    return _getInactivityMinutes() * 60 * 1000;
}

function setInactivityTimeoutMinutes(minutes) {
    const value = Number(minutes);
    const safe = [15, 30, 60, 120, 240].includes(value) ? value : DEFAULT_INACTIVITY_MINUTES;
    localStorage.setItem(INACTIVITY_SETTING_KEY, String(safe));
    _resetActivity();
    showNotification(`Auto logout set to ${safe} minutes of inactivity.`, 'success');
}

function renderInactivitySettings(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (state.auth?.currentUser?.role !== 'admin') {
        container.innerHTML = '';
        return;
    }
    const current = _getInactivityMinutes();
    const options = [15, 30, 60, 120, 240]
        .map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${v < 60 ? `${v} minutes` : `${v / 60} hour${v === 60 ? '' : 's'}`}</option>`)
        .join('');
    container.innerHTML = `
        <div style="padding:10px 14px;">
            <label style="display:block;font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Auto logout</label>
            <select id="${containerId}-select" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:white;font-size:13px;">
                ${options}
            </select>
        </div>`;
    const select = document.getElementById(`${containerId}-select`);
    if (select) select.onchange = () => setInactivityTimeoutMinutes(select.value);
}

function _initInactivityWatcher() {
    const touch = () => { _lastActivity = Date.now(); };
    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev =>
        window.addEventListener(ev, touch, { passive: true })
    );
    _inactivityTimer = setInterval(() => {
        if (!state.auth?.isAuthenticated) return;
        if (Date.now() - _lastActivity > _getInactivityLimitMs()) {
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

    // Create overlay with explicit inline styles that override everything
    const overlay = document.createElement('div');
    overlay.id = 'auth-modal-overlay';
    overlay.className = 'modal-overlay';
    // Force all styles inline to ensure it works in all browsers
    overlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: #000 !important;
        background-color: rgba(0,0,0,0.75) !important;
        z-index: 99999 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 20px !important;
        box-sizing: border-box !important;
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAllModals(); });

    // Create modal with explicit styles
    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.style.cssText = `
        background: #fff !important;
        border-radius: 20px !important;
        padding: 30px !important;
        width: 100% !important;
        max-width: 420px !important;
        box-shadow: 0 25px 80px rgba(0,0,0,0.4) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
    `;

    const judgeOptions = (state.judges || []).map(j =>
        `<option value="${escapeHTML(String(j.id))}">${escapeHTML(j.name)}</option>`
    ).join('');
    const teamOptions = (state.teams || []).map(t =>
        `<option value="${escapeHTML(String(t.id))}">${escapeHTML(t.name)}</option>`
    ).join('');

    const oauthLinks = '';

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
    <button onclick="closeAllModals()" style="position:absolute;top:12px;right:12px;background:none;border:none;font-size:24px;cursor:pointer;color:#64748b;z-index:10;">&times;</button>
    <div class="auth-inner">
        <div class="auth-logo-wrap">
            <img src="/logo.png" alt="Orion logo" class="auth-logo">
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
                        <input type="radio" name="regRole" value="public" checked>
                        <span class="role-card-icon">👁️</span>
                        <span class="role-card-label">Observer</span>
                    </label>
                </div>
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

    // Force a reflow and ensure visibility
    overlay.offsetHeight; // trigger reflow
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';

    // Wire events
    document.getElementById('loginTabBtn')?.addEventListener('click', () => switchAuthTab('login'));
    document.getElementById('registerTabBtn')?.addEventListener('click', () => switchAuthTab('register'));
    document.getElementById('modalLoginBtn')?.addEventListener('click', handleLogin);
    document.getElementById('modalGuestBtn')?.addEventListener('click', guestLogin);
    document.getElementById('modalRegisterBtn')?.addEventListener('click', registerUser);
    document.getElementById('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('registerConfirmPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') registerUser(); });

    // Role card → show/hide association
    modal.querySelectorAll('input[name="regRole"]').forEach(radio => {
        radio.addEventListener('change', () => _onRegRoleChange(radio.value));
    });
    _onRegRoleChange('team'); // default

    // OAuth — both tabs share the same buttons (duplicated ids avoided via querySelectorAll)
    modal.querySelectorAll('#oauthGoogleBtn').forEach(b => b.addEventListener('click', signInWithGoogle));
    modal.querySelectorAll('#oauthDiscordBtn').forEach(b => b.addEventListener('click', signInWithDiscord));
    modal.querySelectorAll('#oauthAppleBtn').forEach(b => b.addEventListener('click', signInWithApple));
}

function _onRegRoleChange(role) {
    const group = document.getElementById('associationGroup');
    const label = document.getElementById('assocLabel');
    const judgeGrp = document.getElementById('assocJudgeGroup');
    const teamGrp = document.getElementById('assocTeamGroup');
    if (!group) return;
    if (role === 'judge') {
        group.style.display = '';
        if (label) label.textContent = 'Which judge are you?';
        if (judgeGrp) judgeGrp.style.display = '';
        if (teamGrp) teamGrp.style.display = 'none';
    } else if (role === 'team') {
        group.style.display = '';
        if (label) label.textContent = 'Which team / speaker slot are you?';
        if (judgeGrp) judgeGrp.style.display = 'none';
        if (teamGrp) teamGrp.style.display = '';
    } else {
        group.style.display = 'none';
    }
}

// ── SWITCH AUTH TAB ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginBtn = document.getElementById('loginTabBtn');
    const registerBtn = document.getElementById('registerTabBtn');
    if (!loginForm || !registerForm) return;

    if (tab === 'login') {
        loginForm.style.display = '';
        registerForm.style.display = 'none';
        loginBtn?.classList.add('is-active');
        registerBtn?.classList.remove('is-active');
    } else {
        loginForm.style.display = 'none';
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
                d.style.padding = '40px';
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

    const name = document.createElement('h2');
    name.style.textAlign = 'center';
    name.textContent = user.name;

    const email = document.createElement('p');
    email.style.cssText = 'text-align:center;color:#64748b;margin-bottom:20px;';
    email.textContent = user.email || '';

    const roleBadge = document.createElement('div');
    roleBadge.style.cssText = 'text-align:center;margin-bottom:20px;';
    const rb = document.createElement('span');
    rb.className = `role-badge role-${user.role}`;
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
    renderInactivitySettings,
    setInactivityTimeoutMinutes,
    signInWithGoogle,
    signInWithDiscord,
    signInWithApple,
};
