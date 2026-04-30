import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ROLES = ['admin', 'judge', 'team', 'public'];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

    try {
        const auth = req.headers.get('Authorization');
        if (!auth) return new Response(JSON.stringify({ error: 'Missing Authorization' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

        const callerSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
        const { data: { user: caller }, error: callerErr } = await callerSb.auth.getUser();
        if (callerErr || !caller) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

        if (caller.app_metadata?.role !== 'admin') return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });

        const { targetUserId, newRole } = await req.json();
        if (!targetUserId) return new Response(JSON.stringify({ error: 'targetUserId required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
        if (!ALLOWED_ROLES.includes(newRole)) return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
        if (targetUserId === caller.id && newRole !== 'admin') return new Response(JSON.stringify({ error: 'Cannot demote yourself' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

        const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { error: updateErr } = await adminSb.auth.admin.updateUserById(targetUserId, { app_metadata: { role: newRole } });
        if (updateErr) return new Response(JSON.stringify({ error: updateErr.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

        await adminSb.from('token_audit_log').insert({ action: `role_change:${newRole}`, ip_address: req.headers.get('cf-connecting-ip'), user_agent: req.headers.get('user-agent') });

        return new Response(JSON.stringify({ ok: true, targetUserId, newRole }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

    } catch (err) {
        console.error('[set-user-role]', err);
        return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
});