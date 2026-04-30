import { createClient } from '@supabase/supabase-js';

// Safe access to environment variables, falling back to an empty object if not using a bundler
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (window.ENV || {});

const SUPABASE_URL  = env.VITE_SUPABASE_URL || 'https://chnebizoecbarzadmcqo.supabase.co';
const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNobmViaXpvZWNiYXJ6YWRtY3FvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzE5MjYsImV4cCI6MjA5MjEwNzkyNn0.qtI3pLM_SZkvSNK7HZs-lsty9uaEkC0C5GHM2rA5H3Q';
export { SUPABASE_URL };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});

console.log('[supabase] Initialized with URL:', SUPABASE_URL);
