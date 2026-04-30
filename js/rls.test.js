// ============================================================
// tests/rls.test.js — RLS policy integration tests
//
// Prerequisites:
//   npx supabase start   (local Supabase instance)
//   npx supabase db reset (loads schema.sql)
//
// Run: node --test tests/rls.test.js
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const URL      = process.env.SUPABASE_URL      || 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SVC_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Service role client for test setup — bypasses RLS
const adminSb = createClient(URL, SVC_KEY);

// ── Test fixtures ─────────────────────────────────────────────────────────────
let tournamentId, judgeA_id, judgeB_id, teamGov_id, teamOpp_id;
let debateForJudgeA, debateUnassigned;
let judgeA_email = `judge_a_${Date.now()}@test.local`;
let judgeB_email = `judge_b_${Date.now()}@test.local`;
const TEST_PW = 'TestPassword123!';

before(async () => {
    // Create test tournament
    const { data: tour } = await adminSb.from('tournaments')
        .insert({ name: 'RLS Test Tournament', format: 'standard', owner_id: '00000000-0000-0000-0000-000000000000' })
        .select().single();
    tournamentId = tour.id;

    // Create teams
    const { data: teamGov } = await adminSb.from('teams')
        .insert({ tournament_id: tournamentId, name: 'Gov Team' }).select().single();
    const { data: teamOpp } = await adminSb.from('teams')
        .insert({ tournament_id: tournamentId, name: 'Opp Team' }).select().single();
    teamGov_id = teamGov.id;
    teamOpp_id = teamOpp.id;

    // Create auth users
    const { data: userA } = await adminSb.auth.admin.createUser({ email: judgeA_email, password: TEST_PW, app_metadata: { role: 'judge' } });
    const { data: userB } = await adminSb.auth.admin.createUser({ email: judgeB_email, password: TEST_PW, app_metadata: { role: 'judge' } });

    // Create judge records
    const { data: jA } = await adminSb.from('judges')
        .insert({ tournament_id: tournamentId, name: 'Judge A', role: 'chair', user_id: userA.user.id }).select().single();
    const { data: jB } = await adminSb.from('judges')
        .insert({ tournament_id: tournamentId, name: 'Judge B', role: 'panellist', user_id: userB.user.id }).select().single();
    judgeA_id = jA.id;
    judgeB_id = jB.id;

    // Create round
    const { data: round } = await adminSb.from('rounds')
        .insert({ tournament_id: tournamentId, round_number: 1, motion: 'THBT test' }).select().single();

    // Create debate assigned to judgeA
    const { data: debate } = await adminSb.from('debates')
        .insert({ round_id: round.id, tournament_id: tournamentId, gov_team_id: teamGov_id, opp_team_id: teamOpp_id }).select().single();
    debateForJudgeA   = debate.id;
    debateUnassigned  = debate.id;   // will create a separate one for unassigned test

    // Assign judgeA
    await adminSb.from('debate_judges').insert({ debate_id: debateForJudgeA, judge_id: judgeA_id, role: 'chair' });

    // Create a second debate with NO judge assigned (for the "unassigned" test)
    const { data: debate2 } = await adminSb.from('debates')
        .insert({ round_id: round.id, tournament_id: tournamentId, gov_team_id: teamGov_id, opp_team_id: teamOpp_id }).select().single();
    debateUnassigned = debate2.id;
});

after(async () => {
    // Clean up — cascade handles child rows
    if (tournamentId) await adminSb.from('tournaments').delete().eq('id', tournamentId);
    try { await adminSb.auth.admin.deleteUser(judgeA_id); } catch {}
    try { await adminSb.auth.admin.deleteUser(judgeB_id); } catch {}
});

// ── RLS Tests ─────────────────────────────────────────────────────────────────

describe('RLS — ballot submission', () => {
    it('judge can submit ballot for their assigned debate', async () => {
        const sb = createClient(URL, ANON_KEY);
        await sb.auth.signInWithPassword({ email: judgeA_email, password: TEST_PW });

        const { error } = await sb.from('ballots').insert({
            debate_id:     debateForJudgeA,
            tournament_id: tournamentId,
            submitted_by:  (await sb.auth.getUser()).data.user.id,
            winner_side:   'gov',
            gov_total:     180,
            opp_total:     175
        });
        assert.equal(error, null, `Judge A should be able to ballot their assigned debate. Error: ${error?.message}`);
        await sb.auth.signOut();
    });

    it('judge cannot submit ballot for a debate they are NOT assigned to', async () => {
        const sb = createClient(URL, ANON_KEY);
        await sb.auth.signInWithPassword({ email: judgeB_email, password: TEST_PW });

        const { error } = await sb.from('ballots').insert({
            debate_id:     debateForJudgeA,   // judgeB is NOT assigned here
            tournament_id: tournamentId,
            submitted_by:  (await sb.auth.getUser()).data.user.id,
            winner_side:   'gov',
            gov_total:     180,
            opp_total:     175
        });
        assert.notEqual(error, null, 'RLS should block unassigned judge from submitting ballot');
        assert.ok(
            error.code === '42501' || error.message?.toLowerCase().includes('row-level security'),
            `Expected RLS error, got: ${error.message}`
        );
        await sb.auth.signOut();
    });

    it('judge cannot submit the same ballot twice', async () => {
        const sb = createClient(URL, ANON_KEY);
        await sb.auth.signInWithPassword({ email: judgeA_email, password: TEST_PW });
        const userId = (await sb.auth.getUser()).data.user.id;

        // First submission (may already exist from previous test)
        // Try a second insert for the same debate+user
        const { error } = await sb.from('ballots').insert({
            debate_id:     debateForJudgeA,
            tournament_id: tournamentId,
            submitted_by:  userId,
            winner_side:   'opp',
            gov_total:     170,
            opp_total:     185
        });
        assert.notEqual(error, null, 'Second ballot from same judge should be rejected');
        await sb.auth.signOut();
    });

    it('unauthenticated user cannot insert a ballot', async () => {
        const sb = createClient(URL, ANON_KEY);
        // Do NOT sign in

        const { error } = await sb.from('ballots').insert({
            debate_id:     debateForJudgeA,
            tournament_id: tournamentId,
            submitted_by:  '00000000-0000-0000-0000-000000000001',
            winner_side:   'gov',
            gov_total:     180,
            opp_total:     175
        });
        assert.notEqual(error, null, 'Unauthenticated ballot insert must be rejected');
    });
});

describe('RLS — team data visibility', () => {
    it('unpublished teams are NOT readable by anonymous users', async () => {
        const sb = createClient(URL, ANON_KEY);
        // draw not published (tournament_publish row has draw=false by default)
        const { data } = await sb.from('teams').select('id').eq('tournament_id', tournamentId);
        assert.equal((data || []).length, 0, 'Teams should not be visible when draw is unpublished');
    });

    it('teams become visible when draw is published', async () => {
        // Publish the draw
        await adminSb.from('tournament_publish')
            .upsert({ tournament_id: tournamentId, draw: true }, { onConflict: 'tournament_id' });

        const sb = createClient(URL, ANON_KEY);
        const { data } = await sb.from('teams').select('id').eq('tournament_id', tournamentId);
        assert.ok((data || []).length >= 2, 'Teams should be visible when draw is published');

        // Clean up
        await adminSb.from('tournament_publish')
            .update({ draw: false }).eq('tournament_id', tournamentId);
    });
});

describe('RLS — judge tokens', () => {
    it('judge cannot read another judge\'s token', async () => {
        // Create a token for judgeA via service role
        await adminSb.from('judge_tokens')
            .insert({ judge_id: judgeA_id, tournament_id: tournamentId });

        // judgeB tries to read judgeA's token
        const sb = createClient(URL, ANON_KEY);
        await sb.auth.signInWithPassword({ email: judgeB_email, password: TEST_PW });

        const { data } = await sb.from('judge_tokens')
            .select('token')
            .eq('judge_id', judgeA_id);

        assert.equal((data || []).length, 0, 'Judge B should not be able to read Judge A\'s token');
        await sb.auth.signOut();
    });
});
