import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS: restrict origins and allow credentials
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://oriontabulation.com,https://www.oriontabulation.com').split(',').map(s => s.trim()).filter(Boolean);
function corsHeaders(origin?: string | null) {
  const originToUse = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '';
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
  if (originToUse) h['Access-Control-Allow-Origin'] = originToUse;
  return h;
}

serve(async (req: Request) => {
    const origin = req.headers.get('Origin');
    const headers = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response('ok', { headers });
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

    try {
        const auth = req.headers.get('Authorization');
        if (!auth) return json({ error: 'Missing Authorization' }, 401);

        const callerSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
        const { data: { user: caller } } = await callerSb.auth.getUser();
        if (!caller || caller.app_metadata?.role !== 'admin') return json({ error: 'Forbidden' }, 403);

        const { teamId, tournamentId } = await req.json();
        if (!teamId || !tournamentId) return json({ error: 'teamId and tournamentId required' }, 400);

        const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const { data: team } = await adminSb.from('teams').select('id').eq('id', teamId).eq('tournament_id', tournamentId).single();
        if (!team) return json({ error: 'Team not found in this tournament' }, 404);

        // Revoke existing tokens for this team/tournament before issuing new one
        await adminSb.from('team_tokens').update({ revoked: true }).eq('team_id', teamId).eq('tournament_id', tournamentId);

        const { data: token, error: tokenErr } = await adminSb
            .from('team_tokens')
            .insert({ team_id: teamId, tournament_id: tournamentId })
            .select('id, token')
            .single();

        if (tokenErr || !token) return json({ error: tokenErr?.message || 'Token creation failed' }, 500);

        const siteUrl = Deno.env.get('SITE_URL') || '';
        return json({ url: `${siteUrl}?team=${token.token}`, tokenId: token.id });

    } catch (err) {
        console.error('[generate-team-token]', err);
        return json({ error: 'Internal error' }, 500);
    }
});
