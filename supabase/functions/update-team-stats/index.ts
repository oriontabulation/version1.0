import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    try {
        const { debateId, tournamentId } = await req.json();
        if (!debateId || !tournamentId) return json({ error: 'debateId and tournamentId required' }, 400);

        const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const { data: debate, error: debateErr } = await adminSb
            .from('debates')
            .select('id, gov_team_id, opp_team_id, ballots(id, winner_side, gov_total, opp_total, submitted_at)')
            .eq('id', debateId)
            .single();

        if (debateErr || !debate) return json({ error: 'Debate not found' }, 404);
        if (!debate.ballots?.length) return json({ ok: true, message: 'No ballots yet' });

        const ballot = [...debate.ballots].sort((a: any, b: any) =>
            new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        )[0];

        const govWon = ballot.winner_side === 'gov';

        const { error: govErr } = await adminSb.rpc('increment_team_stats', {
            p_team_id: debate.gov_team_id,
            p_wins: govWon ? 1 : 0,
            p_points: ballot.gov_total
        });
        if (govErr) return json({ error: govErr.message }, 500);

        const { error: oppErr } = await adminSb.rpc('increment_team_stats', {
            p_team_id: debate.opp_team_id,
            p_wins: govWon ? 0 : 1,
            p_points: ballot.opp_total
        });
        if (oppErr) return json({ error: oppErr.message }, 500);

        const { data: speakerScores } = await adminSb
            .from('ballot_speaker_scores')
            .select('speaker_id, score, is_reply')
            .eq('ballot_id', ballot.id);

        if (speakerScores?.length) {
            for (const ss of speakerScores) {
                await adminSb.rpc('increment_speaker_score', {
                    p_speaker_id: ss.speaker_id,
                    p_score: ss.score,
                    p_is_reply: ss.is_reply
                });
            }
        }

        await adminSb.from('debates').update({ entered: true }).eq('id', debateId);

        return json({ ok: true, debateId, govWon });

    } catch (err) {
        console.error('[update-team-stats]', err);
        return json({ error: 'Internal error' }, 500);
    }
});