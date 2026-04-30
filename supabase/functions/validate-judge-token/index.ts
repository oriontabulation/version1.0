import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    try {
        const { token, email } = await req.json();

        if (!token || typeof token !== 'string' || token.length > 128 || !/^[a-f0-9]+$/i.test(token)) {
            return json({ valid: false, reason: 'invalid_format' }, 400);
        }

        const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const { data: row } = await adminSb
            .from('judge_tokens')
            .select('id, judge_id, tournament_id, revoked, expires_at, judges(id, name, role, user_id, email)')
            .eq('token', token)
            .single();

        if (!row) return json({ valid: false, reason: 'not_found' }, 401);
        if (row.revoked) return json({ valid: false, reason: 'revoked' }, 401);
        if (row.expires_at && new Date(row.expires_at) < new Date()) return json({ valid: false, reason: 'expired' }, 401);

        const judge = row.judges as any;

        // Email verification: if judge has an email on record, caller must supply a matching one
        if (judge?.email) {
            if (!email) return json({ valid: false, reason: 'email_required' }, 401);
            if (email.trim().toLowerCase() !== judge.email.trim().toLowerCase()) {
                return json({ valid: false, reason: 'email_mismatch' }, 401);
            }
        }

        adminSb.from('judge_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(() => {});

        await adminSb.from('token_audit_log').insert({
            token_id: row.id,
            judge_id: row.judge_id,
            action: 'validate',
            ip_address: req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for'),
            user_agent: req.headers.get('user-agent'),
        });

        const { data: assignments } = await adminSb
            .from('debate_judges')
            .select(`
                role,
                debates!inner(
                    id, entered, room_name,
                    gov:gov_team_id(id, name, code),
                    opp:opp_team_id(id, name, code),
                    rounds!inner(id, round_number, motion, blinded, type, tournament_id)
                )
            `)
            .eq('judge_id', row.judge_id)
            .eq('debates.rounds.tournament_id', row.tournament_id);

        return json({
            valid: true,
            judge,
            tournamentId: row.tournament_id,
            assignments: (assignments || []).map((a: any) => ({ ...a.debates, judgeRole: a.role }))
        });

    } catch (err) {
        console.error('[validate-judge-token]', err);
        return json({ valid: false, reason: 'internal_error' }, 500);
    }
});