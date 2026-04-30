// ============================================================
// tests/break.test.js — Unit tests for break computation
// Run with: node --test tests/break.test.js
// ============================================================

import { describe, it }  from 'node:test';
import assert             from 'node:assert/strict';

// ── Inline the pure functions (no Supabase dependency) ────────────────────────
function computeBreak(teams, breakSize) {
    const eligible = teams
        .filter(t => !t.break_ineligible)
        .sort((a, b) => ((b.wins || 0) - (a.wins || 0)) || ((b.total_points || 0) - (a.total_points || 0)));

    const cutoff   = Math.min(breakSize, eligible.length);
    const breaking = eligible.slice(0, cutoff).map((t, i) => ({ ...t, seed: i + 1 }));
    const bubble   = eligible.slice(cutoff, cutoff + 3);
    const ineligible = teams.filter(t => t.break_ineligible);

    return { breaking, bubble, ineligible };
}

function powerPair(teams) {
    const sorted = [...teams].sort((a, b) => ((b.wins || 0) - (a.wins || 0)) || ((b.total_points || 0) - (a.total_points || 0)));
    const pairs  = [];
    for (let i = 0; i < sorted.length - 1; i += 2) {
        pairs.push({ gov: sorted[i], opp: sorted[i + 1] });
    }
    return pairs;
}

function foldPair(teams) {
    const sorted = [...teams].sort((a, b) => ((b.wins || 0) - (a.wins || 0)) || ((b.total_points || 0) - (a.total_points || 0)));
    const half   = Math.floor(sorted.length / 2);
    const pairs  = [];
    for (let i = 0; i < half; i++) {
        pairs.push({ gov: sorted[i], opp: sorted[i + half] });
    }
    return pairs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeBreak', () => {
    it('ranks by wins then total_points as tiebreak', () => {
        const teams = [
            { id: 'a', wins: 4, total_points: 320, break_ineligible: false },
            { id: 'b', wins: 4, total_points: 315, break_ineligible: false },
            { id: 'c', wins: 3, total_points: 330, break_ineligible: false },
        ];
        const { breaking, bubble } = computeBreak(teams, 2);
        assert.equal(breaking.length, 2);
        assert.equal(breaking[0].id, 'a');   // 4 wins, higher points wins tiebreak
        assert.equal(breaking[1].id, 'b');
        assert.equal(bubble[0].id,   'c');
        assert.equal(breaking[0].seed, 1);
        assert.equal(breaking[1].seed, 2);
    });

    it('excludes ineligible teams from the break', () => {
        const teams = [
            { id: 'a', wins: 5, total_points: 400, break_ineligible: true  },
            { id: 'b', wins: 4, total_points: 320, break_ineligible: false },
            { id: 'c', wins: 3, total_points: 280, break_ineligible: false },
        ];
        const { breaking, ineligible } = computeBreak(teams, 2);
        assert.equal(breaking[0].id, 'b');
        assert.equal(ineligible[0].id, 'a');
    });

    it('returns correct bubble teams (next 3 after break line)', () => {
        const teams = Array.from({ length: 10 }, (_, i) => ({
            id: `t${i}`, wins: 10 - i, total_points: (10 - i) * 80, break_ineligible: false
        }));
        const { breaking, bubble } = computeBreak(teams, 4);
        assert.equal(breaking.length, 4);
        assert.equal(bubble.length, 3);
        assert.equal(bubble[0].id, 't4');   // 5th team = first bubble
    });

    it('handles all teams ineligible', () => {
        const teams = [
            { id: 'a', wins: 3, total_points: 200, break_ineligible: true },
            { id: 'b', wins: 2, total_points: 180, break_ineligible: true },
        ];
        const { breaking } = computeBreak(teams, 2);
        assert.equal(breaking.length, 0);
    });

    it('does not break more teams than exist', () => {
        const teams = [
            { id: 'a', wins: 3, total_points: 200, break_ineligible: false },
        ];
        const { breaking } = computeBreak(teams, 8);
        assert.equal(breaking.length, 1);
    });
});

describe('powerPair', () => {
    it('pairs 1st vs 2nd, 3rd vs 4th', () => {
        const teams = [
            { id: 'a', wins: 4, total_points: 320 },
            { id: 'b', wins: 4, total_points: 310 },
            { id: 'c', wins: 3, total_points: 290 },
            { id: 'd', wins: 3, total_points: 280 },
        ];
        const pairs = powerPair(teams);
        assert.equal(pairs.length, 2);
        assert.equal(pairs[0].gov.id, 'a');
        assert.equal(pairs[0].opp.id, 'b');
        assert.equal(pairs[1].gov.id, 'c');
        assert.equal(pairs[1].opp.id, 'd');
    });

    it('handles 2 teams', () => {
        const teams = [
            { id: 'a', wins: 2, total_points: 160 },
            { id: 'b', wins: 1, total_points: 120 },
        ];
        const pairs = powerPair(teams);
        assert.equal(pairs.length, 1);
        assert.equal(pairs[0].gov.id, 'a');
        assert.equal(pairs[0].opp.id, 'b');
    });

    it('handles odd number of teams (last team gets no pair)', () => {
        const teams = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, wins: 5 - i, total_points: (5 - i) * 80 }));
        const pairs = powerPair(teams);
        assert.equal(pairs.length, 2);   // 5 teams → 2 pairs, 1 bye
    });
});

describe('foldPair', () => {
    it('pairs 1st vs 5th, 2nd vs 6th for 10-team field', () => {
        const teams = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, wins: 10 - i, total_points: (10 - i) * 80 }));
        const pairs = foldPair(teams);
        assert.equal(pairs.length, 5);
        assert.equal(pairs[0].gov.id, 't0');
        assert.equal(pairs[0].opp.id, 't5');
        assert.equal(pairs[1].gov.id, 't1');
        assert.equal(pairs[1].opp.id, 't6');
    });
});
