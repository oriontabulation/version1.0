// js/local-auth.js — Local authentication when Supabase is unreachable
// Stores credentials in localStorage for offline fallback

const LOCAL_AUTH_KEY = 'orion_local_users';
const LOCAL_SESSION_KEY = 'orion_local_session';

async function _hash(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'orion_salt_2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function _getUsers() {
    try {
        const data = localStorage.getItem(LOCAL_AUTH_KEY);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
}

function _saveUsers(users) {
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(users));
}

export async function registerLocalUser({ username, password, name, role = 'public' }) {
    const users = _getUsers();
    const lower = username.toLowerCase().trim();
    
    if (users[lower]) {
        throw new Error('Username already exists');
    }
    
    const hash = await _hash(password);
    const id = crypto.randomUUID();
    
    users[lower] = {
        id,
        username: lower,
        name: name.trim(),
        passwordHash: hash,
        role,
        createdAt: new Date().toISOString()
    };
    
    _saveUsers(users);
    return { id, username: lower, name, role };
}

export async function loginLocalUser(username, password) {
    const users = _getUsers();
    const lower = username.toLowerCase().trim();
    const user = users[lower];
    
    if (!user) {
        throw new Error('Invalid username or password');
    }
    
    const hash = await _hash(password);
    if (hash !== user.passwordHash) {
        throw new Error('Invalid username or password');
    }
    
    const session = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        isLocal: true,
        loggedInAt: Date.now()
    };
    
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
    return session;
}

export function getLocalSession() {
    try {
        const data = localStorage.getItem(LOCAL_SESSION_KEY);
        return data ? JSON.parse(data) : null;
    } catch {
        return null;
    }
}

export function logoutLocalUser() {
    localStorage.removeItem(LOCAL_SESSION_KEY);
}

export function getLocalUsers() {
    const users = _getUsers();
    return Object.values(users).map(u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt
    }));
}

export async function deleteLocalUser(username) {
    const users = _getUsers();
    const lower = username.toLowerCase().trim();
    delete users[lower];
    _saveUsers(users);
}

export async function updateLocalUserRole(username, newRole) {
    const users = _getUsers();
    const lower = username.toLowerCase().trim();
    if (users[lower]) {
        users[lower].role = newRole;
        _saveUsers(users);
        
        const session = getLocalSession();
        if (session && session.username === lower) {
            session.role = newRole;
            localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        }
    }
}

export function isSupabaseReachable() {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        fetch('https://chnebizoecbarzadmcqo.supabase.co/rest/v1/', { method: 'HEAD' })
            .then(resp => {
                clearTimeout(timeout);
                // 200 = accessible, 401 = needs auth (server is up)
                resolve(resp.ok || resp.status === 401);
            })
            .catch(() => { clearTimeout(timeout); resolve(false); });
    });
}