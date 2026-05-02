// js/api.js — The ONLY file that imports from supabase.js
import { supabase, SUPABASE_URL } from './supabase.js';

function _ok({ data, error }, ctx) {
    if (error) {
        console.error(`[api:${ctx}]`, error.message);
        throw Object.assign(new Error(error.message), { code: error.code, ctx });
    }
    return data;
}

function _withoutEmail(row) {
    const copy = { ...row };
    delete copy.email;
    return copy;
}

async function _insertSpeakersResilient(rows, ctx) {
    if (!rows.length) return null;
    const inserted = await supabase.from('speakers').insert(rows);
    if (!inserted.error) return null;

    const fallback = await supabase.from('speakers').insert(rows.map(_withoutEmail));
    if (fallback.error) {
        return `${ctx}: ${fallback.error.message || inserted.error.message}`;
    }
    return `${ctx}: some speaker emails could not be stored`;
}

export const api = {

    // ── Auth ──────────────────────────────────────────────────────────────
    async getCurrentUser() {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) return null;
        return user;
    },
    async signIn(email, password) {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection timed out. Check your internet or try again.')), 10000)
        );
        const request = supabase.auth.signInWithPassword({ email, password });
        const result = await Promise.race([request, timeout]);
        const { data, error } = result;
        if (error) throw new Error(error.message);
        return data;
    },
    async signOut() {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw new Error(error.message);
    },
    async signUp(email, password, metadata = {}) {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: metadata } });
        if (error) throw new Error(error.message);
        return data;
    },
    async getUserProfile(userId) {
        const r = await supabase.from('user_profiles')
            .select('id, username, name, associated_id, status')
            .eq('id', userId).single();
        return _ok(r, 'getUserProfile');
    },
    async upsertProfile(profile) {
        const r = await supabase.from('user_profiles')
            .upsert(profile, { onConflict: 'id' }).select().single();
        return _ok(r, 'upsertProfile');
    },
    async updateLastLogin(userId) {
        await supabase.from('user_profiles')
            .update({ last_login: new Date().toISOString() }).eq('id', userId);
    },
    async setUserRole(targetUserId, newRole) {
        const { data, error } = await supabase.functions.invoke('set-user-role',
            { body: { targetUserId, newRole } });
        if (error || data?.error) throw new Error(error?.message || data.error);
        return data;
    },

    // ── Tournaments ───────────────────────────────────────────────────────
    async getTournaments() {
        return _ok(await supabase.from('tournaments').select('*').order('created_at'), 'getTournaments');
    },
    async createTournament(name, format = 'standard') {
        const user = await api.getCurrentUser();
        const dbFormat = format === 'speech' ? 'standard' : format;
        const t = _ok(await supabase.from('tournaments')
            .insert({ name: name.trim(), format: dbFormat, owner_id: user.id })
            .select().single(), 'createTournament');
        await supabase.from('tournament_publish').insert({ tournament_id: t.id });
        return t;
    },
    async renameTournament(id, name) {
        return _ok(await supabase.from('tournaments').update({ name: name.trim() })
            .eq('id', id).select().single(), 'renameTournament');
    },
    async updateTournament(id, fields) {
        const patch = { ...fields };
        if (patch.name) patch.name = patch.name.trim();
        return _ok(await supabase.from('tournaments').update(patch)
            .eq('id', id).select().single(), 'updateTournament');
    },
    async deleteTournament(id) {
        await supabase.from('rounds').delete().eq('tournament_id', id);
        await supabase.from('teams').delete().eq('tournament_id', id);
        await supabase.from('judges').delete().eq('tournament_id', id);
        await supabase.from('judge_tokens').delete().eq('tournament_id', id);
        await supabase.from('team_tokens').delete().eq('tournament_id', id);
        await supabase.from('feedback').delete().eq('tournament_id', id);
        await supabase.from('categories').delete().eq('tournament_id', id);
        await supabase.from('tournament_publish').delete().eq('tournament_id', id);
        _ok(await supabase.from('tournaments').delete().eq('id', id), 'deleteTournament');
    },
    async getPublishState(tournamentId) {
        const r = await supabase.from('tournament_publish').select('*')
            .eq('tournament_id', tournamentId).single();
        if (r.error?.code === 'PGRST116') {
            return { tournament_id: tournamentId, draw:false, standings:false,
                     speakers:false, break:false, knockout:false, motions:false, results:false };
        }
        return _ok(r, 'getPublishState');
    },
    async setPublish(tournamentId, tab, value) {
        _ok(await supabase.from('tournament_publish')
            .upsert({ tournament_id: tournamentId, [tab]: value }, { onConflict: 'tournament_id' }),
            'setPublish');
    },
    async publishAll(tournamentId) {
        _ok(await supabase.from('tournament_publish').upsert({
            tournament_id: tournamentId,
            draw:true, standings:true, speakers:true, break:true, knockout:true, motions:true, results:true
        }, { onConflict: 'tournament_id' }), 'publishAll');
    },
    async hideAll(tournamentId) {
        _ok(await supabase.from('tournament_publish').upsert({
            tournament_id: tournamentId,
            draw:false, standings:false, speakers:false, break:false, knockout:false, motions:false, results:false
        }, { onConflict: 'tournament_id' }), 'hideAll');
    },

    // ── Teams ─────────────────────────────────────────────────────────────
    async getTeams(tournamentId) {
        // Fetch teams and their sub-data separately
        const teamsReq = supabase.from('teams').select('*').eq('tournament_id', tournamentId)
            .order('wins', { ascending: false }).order('total_points', { ascending: false });
        const speakersReq = supabase.from('speakers').select('*').eq('tournament_id', tournamentId);
        
        // Use a more resilient fetch for categories — don't crash if table is missing
        const catsReq = supabase.from('team_categories').select('*');

        const [teamsRes, speakersRes, catsRes] = await Promise.all([teamsReq, speakersReq, catsReq]);
        
        const teams = _ok(teamsRes, 'getTeams.teams');
        const speakers = _ok(speakersRes, 'getTeams.speakers');
        
        // RESILIENCE: If categories table is missing or errors, just return empty list
        const teamCats = catsRes.error ? [] : (catsRes.data || []);

        return teams.map(t => ({
            ...t,
            speakers: speakers.filter(s => s.team_id === t.id),
            team_categories: teamCats.filter(tc => tc.team_id === t.id)
        }));
    },
    async createTeam({ id, tournamentId, name, code, institution, email, speakers = [], categories = [] }) {
        // Back to simple insert — duplicates are now handled in bulkCreateTeams
        const team = _ok(await supabase.from('teams')
            .insert({ 
                id: id || undefined,
                tournament_id: tournamentId, 
                name: name.trim(),
                code: code?.trim() || null, 
                institution: institution?.trim() || null,
                email: email?.trim() || null 
            })
            .select().single(), 'createTeam');

        if (speakers.length > 0) {
            const rows = speakers.map((s, i) => ({
                team_id: team.id, tournament_id: tournamentId,
                name: (typeof s === 'string' ? s : s.name || '').trim(),
                email: typeof s === 'string' ? null : (s.email || null),
                position: i + 1
            })).filter(s => s.name);
            // RESILIENCE: Swallow speaker errors
            if (rows.length) {
                const inserted = await supabase.from('speakers').insert(rows);
                if (inserted.error) {
                    await supabase.from('speakers').insert(rows.map(_withoutEmail));
                }
            }
        }
        if (categories.length > 0) {
            // RESILIENCE: Swallow category errors
            await supabase.from('team_categories')
                .insert(categories.map(cid => ({ team_id: team.id, category_id: cid })));
        }
        return team;
    },
    async updateTeam(id, fields) {
        const { speakers, categories, ...teamFields } = fields || {};
        const team = _ok(await supabase.from('teams').update(teamFields).eq('id', id).select().single(), 'updateTeam');

        if (Array.isArray(speakers)) {
            await api.updateSpeakers(id, speakers);
        }
        if (Array.isArray(categories)) {
            await supabase.from('team_categories').delete().eq('team_id', id);
            if (categories.length > 0) {
                await supabase.from('team_categories')
                    .insert(categories.map(categoryId => ({ team_id: id, category_id: categoryId })));
            }
        }
        return { ...team, speakers: Array.isArray(speakers) ? speakers : undefined };
    },
    async deleteTeam(id) {
        await Promise.all([
            supabase.from('judge_conflicts').delete().eq('team_id', id),
            supabase.from('team_categories').delete().eq('team_id', id),
            supabase.from('speakers').delete().eq('team_id', id),
        ]);
        _ok(await supabase.from('teams').delete().eq('id', id), 'deleteTeam');
    },
    async updateSpeakers(teamId, speakers) {
        await supabase.from('speakers').delete().eq('team_id', teamId);
        if (speakers.length > 0) {
            const { data: t } = await supabase.from('teams').select('tournament_id').eq('id', teamId).single();
            const rows = speakers.map((s, i) => ({
                team_id: teamId, tournament_id: t.tournament_id,
                name: (typeof s === 'string' ? s : s.name || '').trim(),
                email: typeof s === 'string' ? null : (s.email || null),
                position: i + 1
            })).filter(s => s.name);
            if (rows.length) {
                const inserted = await supabase.from('speakers').insert(rows);
                if (inserted.error) {
                    _ok(await supabase.from('speakers').insert(rows.map(_withoutEmail)), 'updateSpeakers');
                } else {
                    _ok(inserted, 'updateSpeakers');
                }
            }
        }
    },
    async bulkCreateTeams(tournamentId, teamsData) {
        const { data: existing } = await supabase.from('teams').select('name').eq('tournament_id', tournamentId);
        const existingNames = new Set((existing || []).map(t => t.name.toLowerCase()));

        const toInsert = teamsData.filter(t => !existingNames.has(t.name.toLowerCase()));
        const skipped = teamsData.length - toInsert.length;
        if (!toInsert.length) return { imported: 0, skipped, errors: [] };

        const teamRows = toInsert.map(t => ({
            tournament_id: tournamentId,
            name: t.name.trim(),
            code: t.code?.trim() || null,
            institution: t.institution?.trim() || null,
            email: t.email?.trim() || null,
        }));
        const { data: insertedTeams, error: teamsErr } = await supabase.from('teams').insert(teamRows).select();
        if (teamsErr) return { imported: 0, skipped, errors: [{ name: 'batch', error: teamsErr.message }] };

        const speakerRows = [], categoryRows = [];
        insertedTeams.forEach((team, i) => {
            (toInsert[i].speakers || []).forEach((s, pos) => {
                const name = (typeof s === 'string' ? s : s.name || '').trim();
                if (name) speakerRows.push({ team_id: team.id, tournament_id: tournamentId, name, email: typeof s === 'string' ? null : (s.email || null), position: pos + 1 });
            });
            (toInsert[i].categories || []).forEach(cid => categoryRows.push({ team_id: team.id, category_id: cid }));
        });

        const errors = [];
        const speakerError = await _insertSpeakersResilient(speakerRows, 'speakers');
        if (speakerError) errors.push({ name: 'speakers', error: speakerError });

        if (categoryRows.length) {
            const categoryInsert = await supabase.from('team_categories').insert(categoryRows);
            if (categoryInsert.error) {
                errors.push({ name: 'categories', error: categoryInsert.error.message });
            }
        }

        return { imported: insertedTeams.length, skipped, errors };
    },

    // ── Judges ────────────────────────────────────────────────────────────
    async getJudges(tournamentId) {
        const judgesReq = supabase.from('judges').select('*').eq('tournament_id', tournamentId).order('name');
        const conflictsReq = supabase.from('judge_conflicts').select('*');

        const [judgesRes, conflictsRes] = await Promise.all([judgesReq, conflictsReq]);
        
        const judges = _ok(judgesRes, 'getJudges.judges');
        
        // RESILIENCE: Swallow conflict errors
        const conflicts = conflictsRes.error ? [] : (conflictsRes.data || []);

        return judges.map(j => ({
            ...j,
            judge_conflicts: conflicts.filter(c => c.judge_id === j.id)
        }));
    },
    async createJudge({ id, tournamentId, name, role = 'panellist', institution, email, affiliations = [] }) {
        // Revert to insert — duplicates handled in bulkCreateJudges
        let inserted = await supabase.from('judges')
            .insert({ 
                id: id || undefined,
                tournament_id: tournamentId, 
                name: name.trim(), 
                role,
                institution: institution?.trim() || null, 
                email: email?.trim() || null 
            })
            .select().single();
        if (inserted.error && email) {
            inserted = await supabase.from('judges')
                .insert({
                    id: id || undefined,
                    tournament_id: tournamentId,
                    name: name.trim(),
                    role,
                    institution: institution?.trim() || null
                })
                .select().single();
        }
        const judge = _ok(inserted, 'createJudge');

        if (affiliations.length > 0) {
            // RESILIENCE: Swallow conflict errors
            await supabase.from('judge_conflicts')
                .insert(affiliations.map(tid => ({ judge_id: judge.id, team_id: tid })));
        }
        return judge;
    },
    async updateJudge(id, fields) {
        const { affiliations, ...judgeFields } = fields || {};
        const judge = _ok(await supabase.from('judges').update(judgeFields).eq('id', id).select().single(), 'updateJudge');
        if (Array.isArray(affiliations)) {
            await api.setJudgeConflicts(id, affiliations);
        }
        return judge;
    },
    async deleteJudge(id) {
        await Promise.all([
            supabase.from('judge_conflicts').delete().eq('judge_id', id),
            supabase.from('debate_judges').delete().eq('judge_id', id),
            supabase.from('judge_tokens').delete().eq('judge_id', id),
        ]);
        _ok(await supabase.from('judges').delete().eq('id', id), 'deleteJudge');
    },
    async setJudgeConflicts(judgeId, teamIds) {
        await supabase.from('judge_conflicts').delete().eq('judge_id', judgeId);
        if (teamIds.length > 0) {
            _ok(await supabase.from('judge_conflicts')
                .insert(teamIds.map(tid => ({ judge_id: judgeId, team_id: tid }))),
                'setJudgeConflicts');
        }
    },
    async bulkCreateJudges(tournamentId, judgesData, teamByNameMap = {}) {
        const { data: existing } = await supabase.from('judges').select('name').eq('tournament_id', tournamentId);
        const existingNames = new Set((existing || []).map(j => j.name.toLowerCase()));

        const toInsert = judgesData.filter(j => !existingNames.has(j.name.toLowerCase()));
        const skipped = judgesData.length - toInsert.length;
        if (!toInsert.length) return { imported: 0, skipped, errors: [] };

        const judgeRows = toInsert.map(j => ({
            tournament_id: tournamentId,
            name: j.name.trim(),
            role: j.role || 'panellist',
            institution: j.institution?.trim() || null,
            email: j.email?.trim() || null,
        }));
        const { data: insertedJudges, error: judgesErr } = await supabase.from('judges').insert(judgeRows).select();
        if (judgesErr) return { imported: 0, skipped, errors: [{ name: 'batch', error: judgesErr.message }] };

        const conflictRows = [];
        insertedJudges.forEach((judge, i) => {
            ((toInsert[i].affiliations || toInsert[i].conflicts || []))
                .map(name => teamByNameMap[name]?.id)
                .filter(Boolean)
                .forEach(tid => conflictRows.push({ judge_id: judge.id, team_id: tid }));
        });
        if (conflictRows.length) await supabase.from('judge_conflicts').insert(conflictRows);

        return { imported: insertedJudges.length, skipped, errors: [] };
    },

    // ── Rounds & Debates ──────────────────────────────────────────────────
    async getRounds(tournamentId) {
        const roundsRes = await supabase.from('rounds').select('*').eq('tournament_id', tournamentId).order('round_number');
        const rounds = _ok(roundsRes, 'getRounds.rounds');
        if (!rounds.length) return [];

        const roundIds = rounds.map(r => r.id);
        const debatesRes = await supabase.from('debates').select('*').in('round_id', roundIds);
        const allDebates = _ok(debatesRes, 'getRounds.debates');

        if (!allDebates.length) return rounds.map(r => ({ ...r, debates: [] }));

        const debateIds = allDebates.map(d => d.id);
        const djRes = await supabase.from('debate_judges').select('*, judges(id,name,role)').in('debate_id', debateIds);
        const allJudges = _ok(djRes, 'getRounds.judges');
        const [teamsRes, speakersRes, ballotsRes] = await Promise.all([
            supabase.from('teams').select('id,name').eq('tournament_id', tournamentId),
            supabase.from('speakers').select('id,name,team_id,position').eq('tournament_id', tournamentId),
            supabase.from('ballots')
                .select('id, debate_id, winner_side, gov_total, opp_total, submitted_at, ballot_speaker_scores(speaker_id, score, is_reply)')
                .in('debate_id', debateIds)
        ]);
        const teams = _ok(teamsRes, 'getRounds.teams');
        const speakers = _ok(speakersRes, 'getRounds.speakers');
        const ballots = _ok(ballotsRes, 'getRounds.ballots');
        const teamById = new Map(teams.map(team => [String(team.id), team]));
        const speakerById = new Map(speakers.map(speaker => [String(speaker.id), speaker]));
        const latestBallotByDebate = new Map();
        for (const ballot of ballots) {
            const key = String(ballot.debate_id);
            const prev = latestBallotByDebate.get(key);
            if (!prev || new Date(ballot.submitted_at).getTime() > new Date(prev.submitted_at).getTime()) {
                latestBallotByDebate.set(key, ballot);
            }
        }

        return rounds.map(r => {
            const debates = allDebates.filter(d => d.round_id === r.id).map(d => {
                const ballot = latestBallotByDebate.get(String(d.id));
                const govTeamId = d.gov_team_id;
                const oppTeamId = d.opp_team_id;
                const govScores = [];
                const oppScores = [];
                let govReply = null;
                let oppReply = null;

                if (ballot) {
                    for (const row of ballot.ballot_speaker_scores || []) {
                        const speaker = speakerById.get(String(row.speaker_id));
                        if (!speaker) continue;
                        const scoreRow = { speaker: speaker.name, score: row.score };
                        if (String(speaker.team_id) === String(govTeamId)) {
                            if (row.is_reply) govReply = scoreRow;
                            else govScores.push({ ...scoreRow, position: speaker.position ?? 99 });
                        } else if (String(speaker.team_id) === String(oppTeamId)) {
                            if (row.is_reply) oppReply = scoreRow;
                            else oppScores.push({ ...scoreRow, position: speaker.position ?? 99 });
                        }
                    }
                }

                govScores.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
                oppScores.sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

                return {
                    ...d,
                    gov: govTeamId,
                    opp: oppTeamId,
                    entered: Boolean(d.entered || ballot),
                    winner_side: ballot?.winner_side ?? null,
                    gov_total: ballot?.gov_total ?? null,
                    opp_total: ballot?.opp_total ?? null,
                    govResults: ballot ? {
                        teamName: teamById.get(String(govTeamId))?.name || 'Government',
                        substantive: govScores.map(({ speaker, score }) => ({ speaker, score })),
                        reply: govReply,
                        total: ballot.gov_total
                    } : null,
                    oppResults: ballot ? {
                        teamName: teamById.get(String(oppTeamId))?.name || 'Opposition',
                        substantive: oppScores.map(({ speaker, score }) => ({ speaker, score })),
                        reply: oppReply,
                        total: ballot.opp_total
                    } : null,
                    panel: allJudges.filter(j => j.debate_id === d.id).map(j => ({
                        id: j.judge_id,
                        role: j.role,
                        name: j.judges?.name
                    }))
                };
            });
            return { ...r, debates };
        });
    },
    async createRound({ tournamentId, roundNumber, motion, infoslide, type = 'prelim', blinded = false }) {
        return _ok(await supabase.from('rounds')
            .insert({ tournament_id: tournamentId, round_number: roundNumber,
                      motion, infoslide, type, blinded }).select().single(), 'createRound');
    },
    async updateRound(id, fields) {
        return _ok(await supabase.from('rounds').update(fields).eq('id', id).select().single(), 'updateRound');
    },
    async deleteRound(id) {
        _ok(await supabase.from('rounds').delete().eq('id', id), 'deleteRound');
    },
    async createDebates(debates) {
        return _ok(await supabase.from('debates').insert(
            debates.map(d => ({
                round_id: d.roundId, tournament_id: d.tournamentId,
                gov_team_id: d.govTeamId, opp_team_id: d.oppTeamId,
                room_name: d.roomName || null
            }))
        ).select(), 'createDebates');
    },
    async updateDebate(id, fields) {
        return _ok(await supabase.from('debates').update(fields).eq('id', id).select().single(), 'updateDebate');
    },
    async deleteDebate(id) {
        await supabase.from('debate_judges').delete().eq('debate_id', id);
        _ok(await supabase.from('debates').delete().eq('id', id), 'deleteDebate');
    },
    async assignJudgesToDebate(debateId, judgeAssignments) {
        await supabase.from('debate_judges').delete().eq('debate_id', debateId);
        if (judgeAssignments.length > 0) {
            _ok(await supabase.from('debate_judges').insert(
                judgeAssignments.map(ja => ({ debate_id: debateId, judge_id: ja.judgeId, role: ja.role || 'panellist' }))
            ), 'assignJudgesToDebate');
        }
    },
    async replaceRoundDebates(roundId, tournamentId, debates) {
        const existing = await supabase.from('debates').select('id').eq('round_id', roundId);
        const existingIds = (existing.data || []).map(d => d.id);
        if (existingIds.length) {
            await supabase.from('debate_judges').delete().in('debate_id', existingIds);
        }
        _ok(await supabase.from('debates').delete().eq('round_id', roundId), 'replaceRoundDebates.delete');
        return await api.createDebates(
            debates.map(d => ({
                roundId,
                tournamentId,
                govTeamId: d.gov ?? null,
                oppTeamId: d.opp ?? null,
                roomName: d.roomName || null
            }))
        );
    },

    // ── Ballots ───────────────────────────────────────────────────────────
    async submitBallot({ debateId, tournamentId, winnerSide, govTotal, oppTotal, speakerScores = [] }) {
        const user = await api.getCurrentUser();
        if (!user) throw new Error('Must be authenticated to submit a ballot');

        const ballot = _ok(await supabase.from('ballots').insert({
            debate_id: debateId, tournament_id: tournamentId, submitted_by: user.id,
            winner_side: winnerSide, gov_total: govTotal, opp_total: oppTotal
        }).select().single(), 'submitBallot');

        if (speakerScores.length > 0) {
            _ok(await supabase.from('ballot_speaker_scores').insert(
                speakerScores.map(s => ({ ballot_id: ballot.id, speaker_id: s.speakerId,
                                          score: s.score, is_reply: s.isReply || false }))
            ), 'submitBallot.scores');
        }

        const { error: fnErr } = await supabase.functions.invoke('update-team-stats',
            { body: { debateId, tournamentId, ballotId: ballot.id } });
        if (fnErr) console.error('[api:submitBallot] Stats fn error:', fnErr.message);

        return ballot;
    },
    async replaceBallotAsAdmin({ debateId, tournamentId, winnerSide, govTotal, oppTotal, speakerScores = [] }) {
        const { data, error } = await supabase.functions.invoke('admin-replace-ballot', {
            body: { debateId, tournamentId, winnerSide, govTotal, oppTotal, speakerScores }
        });
        if (error || data?.error) throw new Error(error?.message || data.error);
        return data;
    },
    async getBallots(debateId) {
        return _ok(await supabase.from('ballots').select('*, ballot_speaker_scores(*)')
            .eq('debate_id', debateId), 'getBallots');
    },

    // ── Judge Tokens ──────────────────────────────────────────────────────
    async generateJudgeToken(judgeId, tournamentId) {
        // Revoke existing active tokens first
        await supabase.from('judge_tokens').update({ revoked: true })
            .eq('judge_id', judgeId).eq('tournament_id', tournamentId);
        // Generate token client-side (32 random bytes as hex)
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const row = _ok(await supabase.from('judge_tokens')
            .insert({ judge_id: judgeId, tournament_id: tournamentId, token })
            .select('id, token').single(), 'generateJudgeToken');
        const url = `${window.location.origin}${window.location.pathname}?judge=${row.token}`;
        return { url, tokenId: row.id };
    },
    async validateJudgeToken(token, email) {
        const { data, error } = await supabase.functions.invoke('validate-judge-token',
            { body: { token, email: email || undefined } });
        if (error) throw new Error(error.message);
        return data;
    },
    async revokeJudgeToken(judgeId, tournamentId) {
        _ok(await supabase.from('judge_tokens').update({ revoked: true })
            .eq('judge_id', judgeId).eq('tournament_id', tournamentId), 'revokeJudgeToken');
    },
    async revokeAllTokens(tournamentId) {
        _ok(await supabase.from('judge_tokens').update({ revoked: true })
            .eq('tournament_id', tournamentId), 'revokeAllTokens');
    },
    async getJudgeTokenStatus(tournamentId) {
        return _ok(await supabase.from('judge_tokens')
            .select('judge_id, token, created_at, last_used_at, revoked')
            .eq('tournament_id', tournamentId).eq('revoked', false), 'getJudgeTokenStatus');
    },

    // ── Team Tokens ───────────────────────────────────────────────────────
    async generateTeamToken(teamId, tournamentId) {
        // Revoke existing active tokens first
        await supabase.from('team_tokens').update({ revoked: true })
            .eq('team_id', teamId).eq('tournament_id', tournamentId);
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const row = _ok(await supabase.from('team_tokens')
            .insert({ team_id: teamId, tournament_id: tournamentId, token })
            .select('id, token').single(), 'generateTeamToken');
        const url = `${window.location.origin}/portal.html?team=${row.token}`;
        return { url, tokenId: row.id };
    },
    async validateTeamToken(token, email) {
        const { data, error } = await supabase.functions.invoke('validate-team-token',
            { body: { token, email: email || undefined } });
        if (error) throw new Error(error.message);
        return data;
    },
    async revokeTeamToken(teamId, tournamentId) {
        _ok(await supabase.from('team_tokens').update({ revoked: true })
            .eq('team_id', teamId).eq('tournament_id', tournamentId), 'revokeTeamToken');
    },
    async revokeAllTeamTokens(tournamentId) {
        _ok(await supabase.from('team_tokens').update({ revoked: true })
            .eq('tournament_id', tournamentId), 'revokeAllTeamTokens');
    },
    async getTeamTokenStatus(tournamentId) {
        return _ok(await supabase.from('team_tokens')
            .select('team_id, token, created_at, last_used_at, revoked')
            .eq('tournament_id', tournamentId).eq('revoked', false), 'getTeamTokenStatus');
    },

    // ── Categories ────────────────────────────────────────────────────────
    async getCategories(tournamentId) {
        return _ok(await supabase.from('categories').select('*')
            .eq('tournament_id', tournamentId).order('name'), 'getCategories');
    },
    async createCategory({ tournamentId, name, icon = '🏷️', color = '#3b82f6' }) {
        return _ok(await supabase.from('categories')
            .insert({ tournament_id: tournamentId, name: name.trim(), icon, color })
            .select().single(), 'createCategory');
    },
    async deleteCategory(id) {
        _ok(await supabase.from('categories').delete().eq('id', id), 'deleteCategory');
    },

    // ── Check-in ──────────────────────────────────────────────────────────
    async checkInJudge(judgeId, isCheckedIn) {
        return _ok(await supabase.from('judges')
            .update({ checked_in: isCheckedIn })
            .eq('id', judgeId).select().single(), 'checkInJudge');
    },

    // ── Feedback ──────────────────────────────────────────────────────────
    async submitFeedback({ tournamentId, debateId, fromJudgeId, toJudgeId, rating, agreeWithCall, comment }) {
        return _ok(await supabase.from('feedback').insert({
            tournament_id: tournamentId, debate_id: debateId,
            from_judge_id: fromJudgeId, to_judge_id: toJudgeId,
            rating: parseFloat(rating) || rating,
            agree_with_call: agreeWithCall || null,
            source_type: 'judge_peer',
            comment: comment?.trim() || null
        }).select().single(), 'submitFeedback');
    },
    async submitTeamFeedback({ tournamentId, debateId, fromTeamId, toJudgeId, rating, agreeWithCall, comment }) {
        return _ok(await supabase.from('feedback').insert({
            tournament_id: tournamentId, debate_id: debateId,
            from_team_id: fromTeamId, to_judge_id: toJudgeId,
            rating: parseFloat(rating) || rating,
            agree_with_call: agreeWithCall || null,
            source_type: 'team',
            comment: comment?.trim() || null
        }).select().single(), 'submitTeamFeedback');
    },
    async getFeedback(tournamentId) {
        return _ok(await supabase.from('feedback').select('*')
            .eq('tournament_id', tournamentId).order('created_at', { ascending: false }), 'getFeedback');
    },
    async getJudgeRatings(tournamentId) {
        const rows = await api.getFeedback(tournamentId);
        const map = {};
        for (const fb of rows) {
            const jid = String(fb.to_judge_id);
            if (!map[jid]) map[jid] = { judgeId: jid, reviews: [], peerReviews: [], teamReviews: [] };
            map[jid].reviews.push(fb);
            if (fb.source_type === 'team')       map[jid].teamReviews.push(fb);
            else                                  map[jid].peerReviews.push(fb);
        }
        return Object.values(map).map(j => {
            const avg  = r => r.length ? r.reduce((s,f) => s + parseFloat(f.rating||0), 0) / r.length : null;
            return { ...j, avgRating: avg(j.reviews), peerAvg: avg(j.peerReviews), teamAvg: avg(j.teamReviews) };
        });
    },

    // ── Danger Zone ───────────────────────────────────────────────────────
    async resetDrawOnly(tournamentId) {
        await supabase.from('rounds').delete().eq('tournament_id', tournamentId);
        await supabase.from('teams').update({
            wins:0, total_points:0, broke:false, seed:null, eliminated:false,
            break_ineligible:false, break_ineligible_reason:null, category_breaks:{}
        }).eq('tournament_id', tournamentId);
        await supabase.from('speakers').update({
            substantive_total:0, substantive_count:0, reply_total:0, reply_count:0
        }).eq('tournament_id', tournamentId);
    },
    async fullWipe(tournamentId) {
        await supabase.from('rounds').delete().eq('tournament_id', tournamentId);
        await supabase.from('teams').delete().eq('tournament_id', tournamentId);
        await supabase.from('judges').delete().eq('tournament_id', tournamentId);
        await supabase.from('judge_tokens').delete().eq('tournament_id', tournamentId);
        await supabase.from('feedback').delete().eq('tournament_id', tournamentId);
        await supabase.from('categories').delete().eq('tournament_id', tournamentId);
    },

    // ── Realtime ──────────────────────────────────────────────────────────
    subscribeToDebates(tournamentId, callback) {
        return supabase.channel(`debates:${tournamentId}`)
            .on('postgres_changes', { event:'*', schema:'public', table:'debates',
                filter:`tournament_id=eq.${tournamentId}` }, callback)
            .subscribe();
    },
    subscribeToBallots(tournamentId, callback) {
        return supabase.channel(`ballots:${tournamentId}`)
            .on('postgres_changes', { event:'INSERT', schema:'public', table:'ballots',
                filter:`tournament_id=eq.${tournamentId}` }, callback)
            .subscribe();
    },
    unsubscribe(channel) { supabase.removeChannel(channel); },
};
