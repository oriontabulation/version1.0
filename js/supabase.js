import { createClient } from '@supabase/supabase-js';

// Safe access to environment variables, falling back to an empty object if not using a bundler
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (window.ENV || {});

const SUPABASE_URL  = env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON = env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';
export { SUPABASE_URL };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});

console.log('[supabase] Initialized with URL:', SUPABASE_URL);
