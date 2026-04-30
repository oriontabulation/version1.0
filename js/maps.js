// js/maps.js — O(1) lookup maps, built once per render cycle
// Replace all state.teams.find(t => t.id === x) with maps.teamById.get(String(x))

/**
 * Build all lookup maps from raw arrays.
 * Call buildMaps() once after any data load, then pass the maps object
 * into every render function. Never call .find() inside a loop.
 *
 * @param {Array} teams
 * @param {Array} judges
 * @param {Array} rounds
 * @returns {{ teamById, judgeById, speakerById, debateById, scoreMap, roundById }}
 */
export function buildMaps(teams = [], judges = [], rounds = []) {
    const teamById   = new Map(teams.map(t  => [String(t.id), t]));
    const judgeById  = new Map(judges.map(j => [String(j.id), j]));
    const roundById  = new Map(rounds.map(r => [String(r.id), r]));

    // speakerById: flatten all speakers across all teams
    const speakerById = new Map();
    for (const team of teams) {
        for (const sp of team.speakers || []) {
            speakerById.set(String(sp.id), { ...sp, teamId: team.id, teamName: team.name });
        }
    }

    // debateById: flatten all debates across all rounds
    const debateById = new Map();
    for (const round of rounds) {
        for (const debate of round.debates || []) {
            debateById.set(String(debate.id), { ...debate, roundId: round.id, roundNumber: round.round_number });
        }
    }

    // scoreMap: Map<teamId, Map<roundId, { points, won }>>
    const scoreMap = _buildScoreMap(rounds);

    return { teamById, judgeById, speakerById, debateById, roundById, scoreMap };
}

/**
 * Build a nested map: teamId → roundId → { points, won }
 * Used by standings and speaker ranking without re-scanning rounds.
 */
function _buildScoreMap(rounds) {
    const scoreMap = new Map();

    for (const round of rounds) {
        for (const debate of round.debates || []) {
            if (!debate.entered) continue;

            const govId = String(debate.gov_team_id || debate.gov?.id);
            const oppId = String(debate.opp_team_id || debate.opp?.id);
            const rid   = String(debate.round_id || round.id);

            if (!scoreMap.has(govId)) scoreMap.set(govId, new Map());
            if (!scoreMap.has(oppId)) scoreMap.set(oppId, new Map());

            // Use round_scores if present (from cache table), else derive from ballot totals
            const govPoints = debate.gov_total ?? 0;
            const oppPoints = debate.opp_total ?? 0;
            const govWon    = debate.winner_side === 'gov';

            scoreMap.get(govId).set(rid, { points: govPoints, won: govWon });
            scoreMap.get(oppId).set(rid, { points: oppPoints, won: !govWon });
        }
    }

    return scoreMap;
}

/**
 * Build a simple Map of team id → team object.
 * Useful for O(1) lookups in UI components.
 * @param {Array} teams
 * @returns {Map<string, object>}
 */
export function buildTeamMap(teams) {
    return new Map(teams.map(t => [String(t.id), t]));
}

/**
 * Build a Map of team name (lowercase) → team object.
 * Used by file-manager.js and other components for case-insensitive lookups.
 * @param {Array} teams
 * @returns {Map<string, object>}
 */
export function buildTeamByNameMap(teams) {
    return new Map(teams.map(t => [t.name.toLowerCase(), t]));
}

/**
 * Get all debate assignments for a specific judge.
 * @param {string} judgeId
 * @param {Array} rounds
 * @returns {Array} Array of debate objects with round info.
 */
export function getJudgeAssignments(judgeId, rounds = []) {
    const assignments = [];
    for (const round of rounds) {
        for (const debate of round.debates || []) {
            const assigned = (debate.panel || []).some(p => String(p.id) === String(judgeId));
            if (assigned) {
                assignments.push({
                    ...debate,
                    round,
                    judgeRole: (debate.panel || []).find(p => String(p.id) === String(judgeId))?.role
                });
            }
        }
    }
    return assignments;
}

/**
 * Rank teams by wins then total_points (standard WSDC tiebreak).
 * Returns a new sorted array — does not mutate input.
 *
 * @param {Array} teams
 * @returns {Array}
 */
export function rankTeams(teams) {
    return [...teams].sort((a, b) =>
        ((b.wins || 0) - (a.wins || 0)) ||
        ((b.total_points || b.total || 0) - (a.total_points || a.total || 0))
    );
}

/**
 * Compute per-speaker totals from the scoreMap, returning a flat sorted list.
 * Used by the Speakers tab instead of iterating rounds→debates in a triple loop.
 *
 * @param {Array}  teams
 * @param {Object} maps   – result of buildMaps()
 * @returns {Array<{ name, teamName, substantive_total, substantive_count, reply_total, reply_count, avg }>}
 */
export function rankSpeakers(teams, maps) {
    const speakers = [];

    for (const team of teams) {
        for (const sp of team.speakers || []) {
            const count = sp.substantive_count || 0;
            speakers.push({
                id:                sp.id,
                name:              sp.name,
                teamId:            team.id,
                teamName:          team.name,
                teamCode:          team.code,
                substantive_total: sp.substantive_total || 0,
                substantive_count: count,
                reply_total:       sp.reply_total       || 0,
                reply_count:       sp.reply_count       || 0,
                avg:               count > 0 ? ((sp.substantive_total || 0) / count) : 0,
            });
        }
    }

    return speakers.sort((a, b) =>
        (b.substantive_total - a.substantive_total) ||
        (b.avg - a.avg)
    );
}

/**
 * Check if a judge has a conflict with a team.
 * Uses precomputed conflict sets for O(1) lookup.
 *
 * @param {Map<string, Set<string>>} conflictMap   judgeId → Set<teamId>
 * @param {string}                   judgeId
 * @param {string}                   teamId
 * @returns {boolean}
 */
export function hasConflict(conflictMap, judgeId, teamId) {
    const conflicts = conflictMap.get(String(judgeId));
    return conflicts ? conflicts.has(String(teamId)) : false;
}

/**
 * Build conflict map from judges array.
 * @param {Array} judges
 * @returns {Map<string, Set<string>>}
 */
export function buildConflictMap(judges) {
    const map = new Map();
    if (!Array.isArray(judges)) return map;
    for (const judge of judges) {
        const conflicts = new Set(
            (judge.judge_conflicts || judge.affiliations || [])
                .map(c => String(c.team_id || c))
        );
        map.set(String(judge.id), conflicts);
    }
    return map;
}