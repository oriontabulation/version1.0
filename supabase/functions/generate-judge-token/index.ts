import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    try {
        const auth = req.headers.get('Authorization');
        if (!auth) return json({ error: 'Missing Authorization' }, 401);

        const callerSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
        const { data: { user: caller } } = await callerSb.auth.getUser();
        if (!caller || caller.app_metadata?.role !== 'admin') return json({ error: 'Forbidden' }, 403);

        const { judgeId, tournamentId } = await req.json();
        if (!judgeId || !tournamentId) return json({ error: 'judgeId and tournamentId required' }, 400);

        const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const { data: judge } = await adminSb.from('judges').select('id').eq('id', judgeId).eq('tournament_id', tournamentId).single();
        if (!judge) return json({ error: 'Judge not found in this tournament' }, 404);

        await adminSb.from('judge_tokens').delete().eq('judge_id', judgeId).eq('tournament_id', tournamentId);

        const { data: token, error: tokenErr } = await adminSb
            .from('judge_tokens')
            .insert({ judge_id: judgeId, tournament_id: tournamentId })
            .select('id, token')
            .single();

        if (tokenErr || !token) return json({ error: tokenErr?.message || 'Token creation failed' }, 500);

        await adminSb.from('token_audit_log').insert({
            token_id: token.id,
            judge_id: judgeId,
            action: 'generate',
            ip_address: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for'),
            user_agent: req.headers.get('user-agent'),
        });

        const siteUrl = Deno.env.get('SITE_URL') || '';
        return json({ url: `${siteUrl}?judge=${token.token}`, tokenId: token.id });

    } catch (err) {
        console.error('[generate-judge-token]', err);
        return json({ error: 'Internal error' }, 500);
    }
});