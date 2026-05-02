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
        const { token, email } = await req.json();

        if (!token || typeof token !== 'string' || token.length > 128 || !/^[a-f0-9]+$/i.test(token)) {
            return json({ valid: false, reason: 'invalid_format' }, 400);
        }

        const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const { data: row } = await adminSb
            .from('team_tokens')
            .select('id, team_id, tournament_id, revoked, expires_at, teams(id, name, code, email)')
            .eq('token', token)
            .single();

        if (!row) return json({ valid: false, reason: 'not_found' }, 401);
        if (row.revoked) return json({ valid: false, reason: 'revoked' }, 401);
        if (row.expires_at && new Date(row.expires_at) < new Date()) return json({ valid: false, reason: 'expired' }, 401);

        const team = row.teams as any;

        // Email verification: if team has an email, the caller must supply a matching one
        if (team?.email) {
            if (!email) return json({ valid: false, reason: 'email_required' }, 401);
            if (email.trim().toLowerCase() !== team.email.trim().toLowerCase()) {
                return json({ valid: false, reason: 'email_mismatch' }, 401);
            }
        }

        adminSb.from('team_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => {});

        // Fetch debates this team participated in
        const { data: debates } = await adminSb
            .from('debates')
            .select(`
                id, entered, room_name,
                gov:gov_team_id(id, name, code),
                opp:opp_team_id(id, name, code),
                rounds!inner(id, round_number, motion, blinded, type, tournament_id),
                debate_judges(judge_id, role, judges(id, name))
            `)
            .eq('rounds.tournament_id', row.tournament_id)
            .or(`gov_team_id.eq.${row.team_id},opp_team_id.eq.${row.team_id}`);

        const { data: feedback } = await adminSb
            .from('feedback')
            .select('*')
            .eq('tournament_id', row.tournament_id)
            .eq('from_team_id', row.team_id);

        return json({
            valid: true,
            team,
            tournamentId: row.tournament_id,
            debates: debates || [],
            feedback: feedback || []
        });

    } catch (err) {
        console.error('[validate-team-token]', err);
        return json({ valid: false, reason: 'internal_error' }, 500);
    }
});
