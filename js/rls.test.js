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

/* global process */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!ANON_KEY || !SVC_KEY) {
    throw new Error('RLS tests require SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.');
}

// Service role client for test setup — bypasses RLS
const adminSb = createClient(URL, SVC_KEY);

// ── Test fixtures ─────────────────────────────────────────────────────────────
let tournamentId, judgeA_id, judgeB_id, teamGov_id, teamOpp_id;
let debateForJudgeA, debateUnassigned;
const owner_email = `owner_${Date.now()}@test.local`;
const judgeA_email = `judge_a_${Date.now()}@test.local`;
const judgeB_email = `judge_b_${Date.now()}@test.local`;
let ownerUserId, judgeAUserId, judgeBUserId;
const TEST_PW = 'TestPassword123!';

function must(result, label) {
    assert.equal(result.error, null, `${label} failed: ${result.error?.message}`);
    assert.ok(result.data, `${label} returned no data`);
    return result.data;
}

before(async () => {
    const owner = must(
        await adminSb.auth.admin.createUser({ email: owner_email, password: TEST_PW, email_confirm: true }),
        'Create owner auth user'
    );
    ownerUserId = owner.user.id;

    // Create test tournament
    const tour = must(
        await adminSb.from('tournaments')
            .insert({ name: 'RLS Test Tournament', format: 'standard', owner_id: ownerUserId })
            .select().single(),
        'Create tournament'
    );
    tournamentId = tour.id;

    // Create teams
    const teamGov = must(
        await adminSb.from('teams')
            .insert({ tournament_id: tournamentId, name: 'Gov Team' }).select().single(),
        'Create gov team'
    );
    const teamOpp = must(
        await adminSb.from('teams')
            .insert({ tournament_id: tournamentId, name: 'Opp Team' }).select().single(),
        'Create opp team'
    );
    teamGov_id = teamGov.id;
    teamOpp_id = teamOpp.id;

    // Create auth users
    const userA = must(
        await adminSb.auth.admin.createUser({ email: judgeA_email, password: TEST_PW, email_confirm: true, app_metadata: { role: 'judge' } }),
        'Create Judge A auth user'
    );
    const userB = must(
        await adminSb.auth.admin.createUser({ email: judgeB_email, password: TEST_PW, email_confirm: true, app_metadata: { role: 'judge' } }),
        'Create Judge B auth user'
    );
    judgeAUserId = userA.user.id;
    judgeBUserId = userB.user.id;

    // Create judge records
    const jA = must(
        await adminSb.from('judges')
            .insert({ tournament_id: tournamentId, name: 'Judge A', role: 'chair', user_id: userA.user.id }).select().single(),
        'Create Judge A record'
    );
    const jB = must(
        await adminSb.from('judges')
            .insert({ tournament_id: tournamentId, name: 'Judge B', role: 'panellist', user_id: userB.user.id }).select().single(),
        'Create Judge B record'
    );
    judgeA_id = jA.id;
    judgeB_id = jB.id;

    // Create round
    const round = must(
        await adminSb.from('rounds')
            .insert({ tournament_id: tournamentId, round_number: 1, motion: 'THBT test' }).select().single(),
        'Create round'
    );

    // Create debate assigned to judgeA
    const debate = must(
        await adminSb.from('debates')
            .insert({ round_id: round.id, tournament_id: tournamentId, gov_team_id: teamGov_id, opp_team_id: teamOpp_id }).select().single(),
        'Create assigned debate'
    );
    debateForJudgeA   = debate.id;
    debateUnassigned  = debate.id;   // will create a separate one for unassigned test

    // Assign judgeA
    must(
        await adminSb.from('debate_judges').insert({ debate_id: debateForJudgeA, judge_id: judgeA_id, role: 'chair' }).select().single(),
        'Assign Judge A to debate'
    );

    // Create a second debate with NO judge assigned (for the "unassigned" test)
    const debate2 = must(
        await adminSb.from('debates')
            .insert({ round_id: round.id, tournament_id: tournamentId, gov_team_id: teamGov_id, opp_team_id: teamOpp_id }).select().single(),
        'Create unassigned debate'
    );
    debateUnassigned = debate2.id;
});

after(async () => {
    // Clean up — cascade handles child rows
    if (tournamentId) await adminSb.from('tournaments').delete().eq('id', tournamentId);
    try { if (ownerUserId) await adminSb.auth.admin.deleteUser(ownerUserId); } catch { /* ignore cleanup failures */ }
    try { if (judgeAUserId) await adminSb.auth.admin.deleteUser(judgeAUserId); } catch { /* ignore cleanup failures */ }
    try { if (judgeBUserId) await adminSb.auth.admin.deleteUser(judgeBUserId); } catch { /* ignore cleanup failures */ }
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
        await adminSb.from('tournament_publish')
            .upsert({ tournament_id: tournamentId, draw: true }, { onConflict: 'tournament_id' });

        const sb = createClient(URL, ANON_KEY);
        const { data } = await sb.from('teams').select('id').eq('tournament_id', tournamentId);
        assert.ok((data || []).length >= 2, 'Teams should be visible when draw is published');

        // Clean up
        await adminSb.from('tournament_publish')
            .update({ draw: false }).eq('tournament_id', tournamentId);
    });

    it('teams become visible when standings or speakers are published', async () => {
        await adminSb.from('tournament_publish')
            .upsert({
                tournament_id: tournamentId,
                draw: false,
                standings: true,
                speakers: false
            }, { onConflict: 'tournament_id' });

        const sb = createClient(URL, ANON_KEY);
        const standingsVisible = await sb.from('teams').select('id').eq('tournament_id', tournamentId);
        assert.ok((standingsVisible.data || []).length >= 2, 'Teams should be visible when standings are published');

        await adminSb.from('tournament_publish')
            .upsert({
                tournament_id: tournamentId,
                draw: false,
                standings: false,
                speakers: true
            }, { onConflict: 'tournament_id' });

        const speakersVisible = await sb.from('teams').select('id').eq('tournament_id', tournamentId);
        assert.ok((speakersVisible.data || []).length >= 2, 'Teams should be visible when speakers are published');

        await adminSb.from('tournament_publish')
            .update({ draw: false, standings: false, speakers: false }).eq('tournament_id', tournamentId);
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
