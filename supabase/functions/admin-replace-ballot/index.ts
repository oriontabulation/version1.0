import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://oriontabulation.com,https://www.oriontabulation.com')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

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
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Unauthorized' }, 401);

    const callerSb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: { user: caller } } = await callerSb.auth.getUser();
    if (!caller || (caller.app_metadata as any)?.role !== 'admin') return json({ error: 'Forbidden' }, 403);

    const { debateId, tournamentId, winnerSide, govTotal, oppTotal, speakerScores = [] } = await req.json();
    if (!debateId || !tournamentId || !winnerSide) {
      return json({ error: 'debateId, tournamentId, and winnerSide are required' }, 400);
    }

    const adminSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: debate, error: debateErr } = await adminSb
      .from('debates')
      .select('id, tournament_id')
      .eq('id', debateId)
      .eq('tournament_id', tournamentId)
      .single();
    if (debateErr || !debate) return json({ error: 'Debate not found' }, 404);

    const { data: oldBallots } = await adminSb.from('ballots').select('id').eq('debate_id', debateId);
    const oldBallotIds = (oldBallots || []).map(b => b.id);
    if (oldBallotIds.length) {
      await adminSb.from('ballot_speaker_scores').delete().in('ballot_id', oldBallotIds);
      await adminSb.from('ballots').delete().in('id', oldBallotIds);
    }

    const { data: ballot, error: ballotErr } = await adminSb.from('ballots').insert({
      debate_id: debateId,
      tournament_id: tournamentId,
      submitted_by: caller.id,
      winner_side: winnerSide,
      gov_total: govTotal,
      opp_total: oppTotal
    }).select().single();
    if (ballotErr || !ballot) return json({ error: ballotErr?.message || 'Ballot insert failed' }, 500);

    if (speakerScores.length) {
      const scoreRows = speakerScores.map((s: any) => ({
        ballot_id: ballot.id,
        speaker_id: s.speakerId,
        score: s.score,
        is_reply: !!s.isReply
      }));
      const { error: scoresErr } = await adminSb.from('ballot_speaker_scores').insert(scoreRows);
      if (scoresErr) return json({ error: scoresErr.message }, 500);
    }

    await recomputeTournamentStats(adminSb, tournamentId);
    return json({ ok: true, ballotId: ballot.id });
  } catch (err) {
    console.error('[admin-replace-ballot]', err);
    return json({ error: 'Internal error' }, 500);
  }
});

async function recomputeTournamentStats(adminSb: any, tournamentId: string) {
  const { data: teams } = await adminSb.from('teams').select('id').eq('tournament_id', tournamentId);
  const { data: speakers } = await adminSb.from('speakers').select('id').eq('tournament_id', tournamentId);

  await adminSb.from('teams').update({ wins: 0, total_points: 0 }).eq('tournament_id', tournamentId);
  await adminSb.from('speakers').update({
    substantive_total: 0,
    substantive_count: 0,
    reply_total: 0,
    reply_count: 0
  }).eq('tournament_id', tournamentId);
  await adminSb.from('debates').update({ entered: false }).eq('tournament_id', tournamentId);

  const { data: debates, error: debatesErr } = await adminSb
    .from('debates')
    .select('id, gov_team_id, opp_team_id, ballots(id, winner_side, gov_total, opp_total, submitted_at, ballot_speaker_scores(speaker_id, score, is_reply))')
    .eq('tournament_id', tournamentId);
  if (debatesErr) throw debatesErr;

  const teamStats = new Map<string, { wins: number; total_points: number }>();
  for (const team of teams || []) {
    teamStats.set(String(team.id), { wins: 0, total_points: 0 });
  }
  const speakerStats = new Map<string, { substantive_total: number; substantive_count: number; reply_total: number; reply_count: number }>();
  for (const speaker of speakers || []) {
    speakerStats.set(String(speaker.id), { substantive_total: 0, substantive_count: 0, reply_total: 0, reply_count: 0 });
  }

  const enteredDebateIds: string[] = [];
  for (const debate of debates || []) {
    const ballots = Array.isArray(debate.ballots) ? debate.ballots : [];
    if (!ballots.length) continue;
    const ballot = [...ballots].sort((a: any, b: any) =>
      new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
    )[0];
    enteredDebateIds.push(debate.id);

    const govStats = teamStats.get(String(debate.gov_team_id));
    const oppStats = teamStats.get(String(debate.opp_team_id));
    if (govStats) {
      govStats.total_points += Number(ballot.gov_total || 0);
      if (ballot.winner_side === 'gov') govStats.wins += 1;
    }
    if (oppStats) {
      oppStats.total_points += Number(ballot.opp_total || 0);
      if (ballot.winner_side === 'opp') oppStats.wins += 1;
    }

    for (const score of ballot.ballot_speaker_scores || []) {
      const stat = speakerStats.get(String(score.speaker_id));
      if (!stat) continue;
      if (score.is_reply) {
        stat.reply_total += Number(score.score || 0);
        stat.reply_count += 1;
      } else {
        stat.substantive_total += Number(score.score || 0);
        stat.substantive_count += 1;
      }
    }
  }

  for (const [teamId, stat] of teamStats.entries()) {
    await adminSb.from('teams').update(stat).eq('id', teamId);
  }
  for (const [speakerId, stat] of speakerStats.entries()) {
    await adminSb.from('speakers').update(stat).eq('id', speakerId);
  }
  if (enteredDebateIds.length) {
    await adminSb.from('debates').update({ entered: true }).in('id', enteredDebateIds);
  }
}
