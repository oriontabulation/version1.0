// ============================================
// KNOCKOUT.JS - Break and elimination rounds
// BP + WSDC knockout, team-position swapping
// ============================================

import { state, save, activeTournament } from './state.js';
import { showNotification, escapeHTML, closeAllModals, teamCode, getPreviousMeetings } from './utils.js';
import { renderStandings } from './tab.js';
import { buildConflictMap, buildTeamMap, hasConflict } from './maps.js';
import { renderRoundCard, renderActiveOutroundDraw } from './draw.js';

// ── Constants ────────────────────────────────────────────────────────────────
const BP_TEAMS_PER_ROOM = 4;
const WSDC_TEAMS_PER_ROOM = 2;
const CHAR_CODE_A = 65;
const MAX_BREAK_SIZE = 100;

// Module-level O(1) team lookup — rebuild at start of each render entry point
let _teamById = null;
const _getTeam = id => { if (!_teamById) _teamById = buildTeamMap(state.teams || []); return _teamById.get(String(id)) ?? null; };
function _refreshTeamCache() {
    _teamById = buildTeamMap(state.teams || []);
}

function _teamDisplayName(team) {
    if (!team) return '';
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch (_) { /* ignore */ }
    return prefs.display === 'codes' ? teamCode(team) : (team.name || '');
}

function _teamDisplayHtml(team) {
    return escapeHTML(_teamDisplayName(team));
}

function _pairingTeamIds(pairing, bp) {
    return bp
        ? [pairing.og, pairing.oo, pairing.cg, pairing.co].filter(Boolean)
        : [pairing.gov, pairing.opp].filter(Boolean);
}

function _allocateOutroundPanels(stages, bp) {
    const judges = [...(state.judges || [])].filter(j => j.available !== false);
    if (!judges.length) return;
    const conflictMap = buildConflictMap(judges);
    const previous = {};
    (state.rounds || []).forEach(round => {
        (round.debates || []).forEach(debate => {
            (debate.panel || []).forEach(p => {
                previous[p.id] = (previous[p.id] || 0) + 1;
            });
        });
    });
    const ordered = judges.sort((a, b) =>
        (b.rating || 5) - (a.rating || 5) ||
        (previous[a.id] || 0) - (previous[b.id] || 0)
    );

    stages.forEach(stage => {
        const used = new Set();
        (stage.pairings || []).forEach(pairing => {
            const teams = _pairingTeamIds(pairing, bp);
            const panelSize = bp ? 5 : 3;
            pairing.panel = [];
            while (pairing.panel.length < panelSize) {
                const judge = ordered.find(j =>
                    !used.has(j.id) &&
                    !pairing.panel.some(p => String(p.id) === String(j.id)) &&
                    teams.every(teamId => !hasConflict(conflictMap, j.id, teamId))
                ) || ordered.find(j =>
                    !used.has(j.id) &&
                    !pairing.panel.some(p => String(p.id) === String(j.id))
                );
                if (!judge) break;
                pairing.panel.push({ id: judge.id, name: judge.name, role: pairing.panel.length === 0 ? 'chair' : 'wing' });
                used.add(judge.id);
            }
        });
    });
}

function _getJudge(judgeId) {
    return (state.judges || []).find(j => String(j.id) === String(judgeId)) || null;
}

function _normalizePanelRoles(pairing) {
    if (!Array.isArray(pairing?.panel)) {
        if (pairing) pairing.panel = [];
        return;
    }
    pairing.panel.forEach((entry, index) => {
        entry.role = index === 0 ? 'chair' : (entry.role === 'trainee' ? 'trainee' : 'wing');
    });
}

function _panelLabel(entry) {
    const judge = _getJudge(entry.id);
    return judge?.name || entry.name || 'Unknown judge';
}

function _currentJudgeId() {
    const user = state.auth?.currentUser;
    return user?.role === 'judge' && user.associatedId != null ? String(user.associatedId) : null;
}

function _isPanelJudge(pairing) {
    const judgeId = _currentJudgeId();
    if (!judgeId) return false;
    return (pairing?.panel || []).some(p => String(p.id || p.judge_id) === judgeId);
}

function _canSubmitPairing(pairing) {
    const user = state.auth?.currentUser;
    const isAdmin = user?.role === 'admin';
    const isLocalSession = !state.auth?.isAuthenticated || !user;
    return isAdmin || isLocalSession || _isPanelJudge(pairing);
}

function validateBreakSize(teamCount, bp) {
    const warnings = [];
    const errors = [];
    const perRoom = bp ? BP_TEAMS_PER_ROOM : WSDC_TEAMS_PER_ROOM;

    if (bp) {
        if (teamCount < 4) errors.push(`BP requires at least 4 teams to break`);
        if (teamCount % perRoom !== 0) errors.push(`BP break must be in multiples of 4 (current: ${teamCount})`);
    } else {
        if (teamCount < 2) errors.push(`WSDC requires at least 2 teams to break`);
        if (teamCount % perRoom !== 0) errors.push(`WSDC break must be in multiples of 2 (current: ${teamCount})`);
    }

    return { warnings, errors };
}

function getPartialBreakConfig(breakSize, bp) {
    const configs = bp ? {
        'partial-finals': { reserved: 2, breaking: 4, name: 'Partial Finals (6 teams)' },
        'partial-semis': { reserved: 4, breaking: 8, name: 'Partial Semis (12 teams)' },
        'partial-quarters': { reserved: 8, breaking: 16, name: 'Partial Quarters (24 teams)' },
        'partial-octos': { reserved: 16, breaking: 32, name: 'Partial Octos (48 teams)' },
    } : {
        'partial-finals': { reserved: 1, breaking: 2, name: 'Partial Finals (3 teams)' },
        'partial-semis': { reserved: 2, breaking: 4, name: 'Partial Semis (6 teams)' },
        'partial-quarters': { reserved: 4, breaking: 8, name: 'Partial Quarters (12 teams)' },
        'partial-octos': { reserved: 8, breaking: 16, name: 'Partial Octos (24 teams)' },
    };
    return configs[breakSize] || null;
}

// ── Format detection ───────────────────────────────────────────────────────

function isBP() {
    return activeTournament()?.format === 'bp';
}

function tournamentIsBP() {
    if (state.tournament?.active && state.tournament?.format) {
        return state.tournament.format === 'bp';
    }
    return isBP();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getRoundName(teamCount, bp) {
    if (bp) {
        const names = { 4: 'Grand Final', 8: 'Semi-finals', 16: 'Quarter-finals', 32: 'Octo-finals', 64: 'Pre-octo-finals', 96: 'Round of 96' };
        return names[teamCount] || `Round of ${teamCount}`;
    }
    const names = { 2: 'Grand Final', 4: 'Semi-finals', 8: 'Quarter-finals', 16: 'Octo-finals', 32: 'Pre-octo-finals', 64: 'Round of 64', 96: 'Round of 96' };
    return names[teamCount] || `Round of ${teamCount}`;
}

function _isPowerOfTwo(n) { return n > 1 && (n & (n - 1)) === 0; }

function needsPartialBreak(actualBreakSize, bp) {
    const minFull = bp ? 4 : 2;
    if (actualBreakSize <= minFull) return false;
    let power = minFull;
    while (power < actualBreakSize) power *= 2;
    return actualBreakSize !== power;
}

function suggestPartialConfig(actualBreakSize, bp) {
    const perRoom = bp ? BP_TEAMS_PER_ROOM : WSDC_TEAMS_PER_ROOM;
    const minFull = bp ? 4 : 2;
    const maxReserved = Math.floor(actualBreakSize / 2);

    for (let R = maxReserved; R >= 0; R--) {
        const NR = actualBreakSize - R;
        if (NR < minFull) continue;
        if (!_isPowerOfTwo(NR)) continue;
        if (NR % perRoom !== 0) continue;

        // Number of teams advancing from first round = NR / 2 (because 2 advance per room in BP, 1 in WSDC)
        const advancers = NR / 2;
        const round2Size = advancers + R;
        if (round2Size >= minFull && _isPowerOfTwo(round2Size) && round2Size % perRoom === 0) {
            return { reserved: R, breaking: NR };
        }
    }
    return null;
}

// ── Blank pairing factories ────────────────────────────────────────────────

function _blankBPPairing(idx) {
    return {
        id: idx + 1,
        og: null, oo: null, cg: null, co: null,
        ogSeed: null, ooSeed: null, cgSeed: null, coSeed: null,
        first: null, second: null, third: null, fourth: null,
        entered: false,
        room: `Room ${String.fromCharCode(CHAR_CODE_A + idx)}`,
    };
}

function _blankWSDCPairing(idx) {
    return {
        id: idx + 1,
        gov: null, opp: null,
        govSeed: null, oppSeed: null,
        winner: null, loser: null, entered: false,
        room: `Knockout ${String.fromCharCode(CHAR_CODE_A + idx)}`,
    };
}

function _hasTeamId(id) {
    return id !== null && id !== undefined && id !== '';
}

function _pairingReady(pairing, bp) {
    return bp
        ? _BP_POSITIONS.every(pos => _hasTeamId(pairing[pos.key]))
        : _hasTeamId(pairing.gov) && _hasTeamId(pairing.opp);
}

function _pairingComplete(pairing, bp, isLastRound = false) {
    if (!pairing?.entered) return false;
    if (bp) {
        return _hasTeamId(pairing.first) && (isLastRound || _hasTeamId(pairing.second));
    }
    return _hasTeamId(pairing.winner);
}

function _roundComplete(round, bp, isLastRound = false) {
    const pairings = round?.pairings || [];
    return pairings.length > 0 && pairings.every(p => _pairingComplete(p, bp, isLastRound));
}

function _syncTournamentProgress(tournament = state.tournament) {
    const bracket = tournament?.bracket || [];
    if (!bracket.length) return 0;

    const bp = tournament.format === 'bp' || tournamentIsBP();
    let firstIncomplete = bracket.length - 1;

    bracket.forEach((round, idx) => {
        round.completed = _roundComplete(round, bp, idx === bracket.length - 1);
        if (!round.completed && firstIncomplete === bracket.length - 1) {
            firstIncomplete = idx;
        }
    });

    const finalRound = bracket[bracket.length - 1];
    const finalPairing = finalRound?.pairings?.[0];
    if (finalRound?.completed && finalPairing) {
        tournament.champion = bp ? finalPairing.first : finalPairing.winner;
    } else {
        tournament.champion = null;
    }

    tournament.currentRound = firstIncomplete;
    return firstIncomplete;
}

function _repairWSDCProgression(tournament = state.tournament) {
    const bracket = tournament?.bracket || [];
    if (tournament?.format === 'bp') return;
    for (let roundIdx = 0; roundIdx < bracket.length - 1; roundIdx++) {
        const round = bracket[roundIdx];
        const nextRound = bracket[roundIdx + 1];
        (round?.pairings || []).forEach((pairing, pairingIdx) => {
            if (!pairing?.entered || !_hasTeamId(pairing.winner)) return;
            let nextSlotIndex, side;
            if (tournament.isPartial && roundIdx === 0) {
                nextSlotIndex = pairingIdx;
                side = 'opp';
            } else {
                nextSlotIndex = Math.floor(pairingIdx / 2);
                side = pairingIdx % 2 === 0 ? 'gov' : 'opp';
            }
            if (!nextRound.pairings[nextSlotIndex]) nextRound.pairings[nextSlotIndex] = _blankWSDCPairing(nextSlotIndex);
            const target = nextRound.pairings[nextSlotIndex];
            if (target.entered) return;
            const otherSide = side === 'gov' ? 'opp' : 'gov';
            if (String(target[otherSide]) === String(pairing.winner)) {
                target[otherSide] = null;
                target[`${otherSide}Seed`] = null;
            }
            target[side] = pairing.winner;
            target[`${side}Seed`] = _getTeam(pairing.winner)?.seed ?? null;
        });
    }
}

// ── Render break tab ───────────────────────────────────────────────────────
function renderBreak() {
    const container = document.getElementById('break');
    if (!container) return;

    const breakingTeams = state.teams.filter(t => t.broke);
    const isAdmin = state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin';
    const bp = isBP();

    container.innerHTML = `
        ${isAdmin ? `
        <div class="section">
            <h2>⚙️ Break Settings</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:20px;">
                <div>
                    <label style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;display:block;">
                        Break Size
                    </label>
                    <select id="break-size-select" style="padding:12px;width:100%;box-sizing:border-box;" onchange="window._handleBreakSizeSelect()">
                        ${bp ? `
                            <option value="direct:4">Grand Final (4 teams)</option>
                            <option value="direct:8">Semi-Finals (8 teams)</option>
                            <option value="direct:16" selected>Quarter-Finals (16 teams)</option>
                            <option value="direct:32">Octo-Finals (32 teams)</option>
                            <option value="direct:64">Round of 64 (64 teams)</option>
                            <option value="partial:2:4">Partial Finals (6 total: 2 bye + 4 play)</option>
                            <option value="partial:4:8">Partial Semi-Finals (12 total: 4 bye + 8 play)</option>
                            <option value="partial:8:16">Partial Quarter-Finals (24 total: 8 bye + 16 play)</option>
                            <option value="partial:16:32">Partial Octo-Finals (48 total: 16 bye + 32 play)</option>
                        ` : `
                            <option value="direct:2">Grand Final (2 teams)</option>
                            <option value="direct:4">Semi-Finals (4 teams)</option>
                            <option value="direct:8" selected>Quarter-Finals (8 teams)</option>
                            <option value="direct:16">Octo-Finals (16 teams)</option>
                            <option value="direct:32">Round of 32 (32 teams)</option>
                            <option value="direct:64">Round of 64 (64 teams)</option>
                            <option value="partial:1:2">Partial Finals (3 total: 1 bye + 2 play)</option>
                            <option value="partial:2:4">Partial Semi-Finals (6 total: 2 bye + 4 play)</option>
                            <option value="partial:4:8">Partial Quarter-Finals (12 total: 4 bye + 8 play)</option>
                            <option value="partial:8:16">Partial Octo-Finals (24 total: 8 bye + 16 play)</option>
                        `}
                        <option value="custom">Custom break size...</option>
                    </select>
                    <input type="number" id="break-size-input" min="2" max="${MAX_BREAK_SIZE}"
                           style="padding:12px;width:100%;box-sizing:border-box;margin-top:8px;display:none;"
                           placeholder="${bp ? 'e.g. 8, 16, 40' : 'e.g. 4, 8, 40'}"
                           oninput="window._handleBreakTotalChange()">
                </div>
                <div>
                    <label style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;display:block;">
                        Break Criteria
                    </label>
                    <select id="break-criteria" style="padding:12px;width:100%;box-sizing:border-box;">
                        <option value="wins">Wins + Points</option>
                        <option value="points">Total Points + Wins</option>
                        <option value="speaker">Speaker Avg + Wins</option>
                        <option value="adjusted">Adjusted Points (Drop Lowest)</option>
                    </select>
                </div>
                <label style="display:flex;align-items:center;gap:8px;padding:12px;background:#f8fafc;border-radius:8px;cursor:pointer;align-self:end;">
                    <input type="checkbox" id="include-eliminated"> Include Eliminated Teams
                </label>
            </div>

            <div style="margin-bottom:16px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px;">Break Type</div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f8fafc;border-radius:8px;cursor:pointer;border:2px solid #e2e8f0;flex:1;min-width:180px;">
                        <input type="radio" name="break-type" value="direct" checked onchange="window._handleBreakTypeChange()">
                        <div>
                            <div style="font-weight:600;font-size:14px;">Direct Break</div>
                            <div style="font-size:12px;color:#64748b;">All teams go straight to bracket</div>
                        </div>
                    </label>
                    <label style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f8fafc;border-radius:8px;cursor:pointer;border:2px solid #e2e8f0;flex:1;min-width:180px;">
                        <input type="radio" name="break-type" value="partial" onchange="window._handleBreakTypeChange()">
                        <div>
                            <div style="font-weight:600;font-size:14px;">Partial Break</div>
                            <div style="font-size:12px;color:#64748b;">Top seeds get byes; rest play a prelim round</div>
                        </div>
                    </label>
                </div>
            </div>

            <div id="partial-break-config" style="display:none;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div style="font-weight:600;font-size:14px;color:#92400e;">Partial Break Configuration</div>
                    <button onclick="window._autoSuggestPartial()"
                        style="font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid #f59e0b;background:white;cursor:pointer;color:#92400e;font-weight:600;">
                        ✨ Auto-suggest
                    </button>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                    <div>
                        <label style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;display:block;">Seeded Teams (get byes)</label>
                        <input type="number" id="break-seeded" min="0" max="${MAX_BREAK_SIZE - 2}"
                               style="padding:12px;width:100%;box-sizing:border-box;" placeholder="e.g. 8"
                               oninput="window._updatePartialSummary()">
                        <div style="font-size:11px;color:#64748b;margin-top:3px;">Skip the preliminary round</div>
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;display:block;">Playoff Teams (play prelim)</label>
                        <input type="number" id="break-playoff" min="2" max="${MAX_BREAK_SIZE - 1}"
                               style="padding:12px;width:100%;box-sizing:border-box;" placeholder="e.g. 16"
                               oninput="window._updatePartialSummary()">
                        <div style="font-size:11px;color:#64748b;margin-top:3px;">Play in preliminary elimination round</div>
                    </div>
                </div>
                <div id="partial-summary" style="font-size:13px;color:#92400e;min-height:20px;"></div>
            </div>

            <div id="break-validation-msg" style="margin-bottom:12px;"></div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button onclick="window.calculateBreak()" class="primary" style="padding:12px;">📊 Calculate Break</button>
                ${breakingTeams.length > 0 ? `
                <button onclick="window.generateKnockout()" class="primary" style="padding:12px;">
                    ⚔️ Start Knockout (${breakingTeams.length} teams)
                </button>` : ''}
            </div>
        </div>` : `
        <div class="section">
            <h2>🏆 Break</h2>
            ${breakingTeams.length === 0 ? `
                <div style="text-align:center;padding:40px 20px;color:#64748b;">
                    <div style="font-size:48px;margin-bottom:15px;">⏳</div>
                    <p>Break has not been calculated yet. Check back soon.</p>
                </div>` : ''}
        </div>`}

        <div class="section" id="break-results" ${breakingTeams.length === 0 ? 'style="display:none"' : ''}>
            <h2>Breaking Teams</h2>
            <div id="breaking-teams-list"></div>
        </div>
    `;

    window._handleBreakSizeSelect();

    // Restore previously saved custom break size
    const saved = localStorage.getItem('orion_break_size_custom');
    if (saved) {
        const selector = document.getElementById('break-size-select');
        const input = document.getElementById('break-size-input');
        const matchingDirect = `direct:${saved}`;
        if (selector && [...selector.options].some(o => o.value === matchingDirect)) {
            selector.value = matchingDirect;
            window._handleBreakSizeSelect();
        } else {
            if (selector) selector.value = 'custom';
            if (input) input.value = saved;
            window._handleBreakSizeSelect();
        }
    }

    // Restore partial break state from saved tournament data
    if (state.tournament?.isPartial && state.tournament?.reservedCount > 0) {
        const partialRadio = document.querySelector('input[name="break-type"][value="partial"]');
        if (partialRadio) {
            partialRadio.checked = true;
            const configDiv = document.getElementById('partial-break-config');
            if (configDiv) configDiv.style.display = '';
            const totalBreaking = state.tournament.breakingTeams?.length || 0;
            const seededInput = document.getElementById('break-seeded');
            const playoffInput = document.getElementById('break-playoff');
            if (seededInput) seededInput.value = state.tournament.reservedCount;
            if (playoffInput && totalBreaking) playoffInput.value = totalBreaking - state.tournament.reservedCount;
            window._updatePartialSummary();
        }
    }

    if (breakingTeams.length > 0) displayBreakingTeams();
}

window._handleBreakTypeChange = function () {
    const selected = document.getElementById('break-size-select')?.value || 'custom';
    const isPartial = selected.startsWith('partial:') ||
        (selected === 'custom' && document.querySelector('input[name="break-type"][value="partial"]')?.checked);
    const configDiv = document.getElementById('partial-break-config');
    if (!configDiv) return;
    configDiv.style.display = isPartial ? '' : 'none';
    if (isPartial && selected === 'custom') {
        const total = parseInt(document.getElementById('break-size-input')?.value || '0', 10);
        const seeded = parseInt(document.getElementById('break-seeded')?.value || '0', 10) || 0;
        const playoff = parseInt(document.getElementById('break-playoff')?.value || '0', 10) || 0;
        if (total && seeded + playoff !== total) {
            const config = suggestPartialConfig(total, isBP());
            if (config) {
                const seededInput = document.getElementById('break-seeded');
                const playoffInput = document.getElementById('break-playoff');
                if (seededInput) seededInput.value = config.reserved;
                if (playoffInput) playoffInput.value = config.breaking;
            }
        }
    }
    if (isPartial) window._updatePartialSummary();
};

function _isStandardBreakSize(total, bp) {
    const perRoom = bp ? BP_TEAMS_PER_ROOM : WSDC_TEAMS_PER_ROOM;
    const minFull = bp ? 4 : 2;
    return total >= minFull && _isPowerOfTwo(total) && total % perRoom === 0;
}

window._handleBreakTotalChange = function () {
    const selector = document.getElementById('break-size-select');
    if (selector && selector.value !== 'custom') selector.value = 'custom';

    const total = parseInt(document.getElementById('break-size-input')?.value || '0', 10);
    const bp = isBP();
    const directRadio = document.querySelector('input[name="break-type"][value="direct"]');
    const partialRadio = document.querySelector('input[name="break-type"][value="partial"]');

    if (total && !_isStandardBreakSize(total, bp)) {
        const config = suggestPartialConfig(total, bp);
        if (config) {
            if (partialRadio) partialRadio.checked = true;
            const seededInput = document.getElementById('break-seeded');
            const playoffInput = document.getElementById('break-playoff');
            if (seededInput) seededInput.value = config.reserved;
            if (playoffInput) playoffInput.value = config.breaking;
        }
    } else if (total && directRadio && partialRadio) {
        directRadio.checked = true;
    }

    window._handleBreakTypeChange();
};

window._handleBreakSizeSelect = function () {
    const selected = document.getElementById('break-size-select')?.value || 'custom';
    const customInput = document.getElementById('break-size-input');
    const directRadio = document.querySelector('input[name="break-type"][value="direct"]');
    const partialRadio = document.querySelector('input[name="break-type"][value="partial"]');
    const seededInput = document.getElementById('break-seeded');
    const playoffInput = document.getElementById('break-playoff');

    if (customInput) customInput.style.display = selected === 'custom' ? '' : 'none';

    if (selected.startsWith('direct:')) {
        if (customInput) customInput.value = selected.split(':')[1];
        if (directRadio) directRadio.checked = true;
    } else if (selected.startsWith('partial:')) {
        const [, seeded, playoff] = selected.split(':');
        if (customInput) customInput.value = (parseInt(seeded, 10) || 0) + (parseInt(playoff, 10) || 0);
        if (partialRadio) partialRadio.checked = true;
        if (seededInput) seededInput.value = seeded;
        if (playoffInput) playoffInput.value = playoff;
    }
    window._handleBreakTypeChange();
};

window._updatePartialSummary = function () {
    const total = parseInt(document.getElementById('break-size-input')?.value || '0', 10);
    const seeded = parseInt(document.getElementById('break-seeded')?.value ?? '', 10);
    const playoff = parseInt(document.getElementById('break-playoff')?.value ?? '', 10);
    const summary = document.getElementById('partial-summary');
    if (!summary) return;
    if (!total || isNaN(seeded) || isNaN(playoff)) { summary.innerHTML = ''; return; }

    const sum = seeded + playoff;
    const ok = sum === total;
    const bp = isBP();
    const advancers = playoff > 0 ? Math.floor(playoff / 2) : 0;
    const round2Size = advancers + seeded;

    summary.innerHTML =
        `<span style="color:${ok ? '#16a34a' : '#dc2626'};">${ok ? '✓' : '⚠️'} ${seeded} seeded + ${playoff} playoff = ${sum}${ok ? '' : ` (need ${total})`}</span>` +
        (ok && playoff > 0 ? ` <span style="color:#64748b;">· ${playoff} playoff → ${advancers} advance + ${seeded} seeded = ${round2Size} in ${getRoundName(round2Size, bp)}</span>` : '');
};

window._autoSuggestPartial = function () {
    const selector = document.getElementById('break-size-select');
    if (selector) selector.value = 'custom';
    window._handleBreakSizeSelect();
    const partialRadio = document.querySelector('input[name="break-type"][value="partial"]');
    if (partialRadio) partialRadio.checked = true;
    const total = parseInt(document.getElementById('break-size-input')?.value || '0', 10);
    if (isNaN(total) || total < 3) { showNotification('Enter a total break size of at least 3 first', 'warning'); return; }
    const bp = isBP();
    const config = suggestPartialConfig(total, bp);
    if (!config) { showNotification(`No valid partial break config found for ${total} teams`, 'error'); return; }
    const seededInput = document.getElementById('break-seeded');
    const playoffInput = document.getElementById('break-playoff');
    if (seededInput) seededInput.value = config.reserved;
    if (playoffInput) playoffInput.value = config.breaking;
    window._handleBreakTypeChange();
    window._updatePartialSummary();
    showNotification(`Suggested: ${config.reserved} seeded + ${config.breaking} playoff`, 'info');
};

function displayBreakingTeams() {
    const list = document.getElementById('breaking-teams-list');
    if (!list) return;

    const isPartial = state.tournament?.isPartial;
    const firstRoundDone = !isPartial || state.tournament?.bracket?.[0]?.completed === true;

    let sorted = [...state.teams.filter(t => t.broke)].sort((a, b) => (a.seed || 999) - (b.seed || 999));

    // Hide bye (reserved) teams until the preliminary elimination round completes
    const byeTeams = (!firstRoundDone) ? sorted.filter(t => t.reserved) : [];
    if (byeTeams.length > 0) sorted = sorted.filter(t => !t.reserved);

    list.innerHTML = `
        ${byeTeams.length > 0 ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 16px;margin-bottom:14px;font-size:13px;color:#92400e;display:flex;align-items:center;gap:10px;">
            🔒 <span><strong>${byeTeams.length} bye team${byeTeams.length !== 1 ? 's' : ''}</strong> will be revealed once the Preliminary Elimination Round is complete.</span>
        </div>` : ''}
        <table style="width:100%;border-collapse:collapse;">
            <thead>
                <tr style="background:#f8fafc;">
                    <th style="padding:12px;text-align:left;">Seed</th>
                    <th style="padding:12px;text-align:left;">Team</th>
                    <th style="padding:12px;text-align:left;">Code</th>
                    <th style="padding:12px;text-align:center;">Wins</th>
                    <th style="padding:12px;text-align:center;">Points</th>
                    <th style="padding:12px;text-align:center;">Spk Avg</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map(team => {
        const spkrs = team.speakers.filter(s => s.substantiveCount > 0);
        const avg = spkrs.length
            ? (spkrs.reduce((s, x) => s + x.substantiveTotal / x.substantiveCount, 0) / spkrs.length).toFixed(2)
            : '—';
        return `<tr>
                        <td style="padding:12px;"><strong style="background:#f59e0b;color:white;padding:4px 12px;border-radius:40px;">#${team.seed}</strong></td>
                        <td style="padding:12px;"><strong>${_teamDisplayHtml(team)}</strong></td>
                        <td style="padding:12px;">${escapeHTML(team.code || '')}</td>
                        <td style="padding:12px;text-align:center;">${team.wins || 0}</td>
                        <td style="padding:12px;text-align:center;">${(team.total || 0).toFixed(1)}</td>
                        <td style="padding:12px;text-align:center;">${avg}</td>
                    </tr>`;
    }).join('')}
            </tbody>
        </table>
    `;
}

// ── Calculate break ────────────────────────────────────────────────────────

function calculateBreak(breakSizeArg, criteriaArg, includeEliminatedArg) {
    const bp = isBP();
    const validationEl = document.getElementById('break-validation-msg');
    if (validationEl) validationEl.innerHTML = '';

    // Read total break size from preset/custom UI or fallback arg
    let actualBreakSize;
    if (breakSizeArg !== undefined) {
        actualBreakSize = typeof breakSizeArg === 'number' ? breakSizeArg : parseInt(breakSizeArg, 10);
    } else {
        const selected = document.getElementById('break-size-select')?.value || 'custom';
        if (selected.startsWith('direct:')) {
            actualBreakSize = parseInt(selected.split(':')[1], 10);
        } else if (selected.startsWith('partial:')) {
            const [, seeded, playoff] = selected.split(':');
            actualBreakSize = (parseInt(seeded, 10) || 0) + (parseInt(playoff, 10) || 0);
        } else {
            actualBreakSize = parseInt(document.getElementById('break-size-input')?.value ?? '', 10);
        }
    }

    if (isNaN(actualBreakSize) || actualBreakSize < 2) {
        showNotification('Please enter a valid break size (minimum 2)', 'error');
        return;
    }
    if (actualBreakSize > MAX_BREAK_SIZE) {
        showNotification(`Break size cannot exceed ${MAX_BREAK_SIZE} teams`, 'error');
        return;
    }

    const criteria = criteriaArg ?? document.getElementById('break-criteria')?.value ?? 'wins';
    const includeEliminated = includeEliminatedArg ?? document.getElementById('include-eliminated')?.checked ?? false;

    // Determine break type from radio selection
    const selectedBreak = document.getElementById('break-size-select')?.value || 'custom';
    const isPartial = selectedBreak.startsWith('partial:') ||
        (selectedBreak === 'custom' && (document.querySelector('input[name="break-type"][value="partial"]')?.checked ?? false));
    let reservedCount = 0;

    if (isPartial) {
        let seededCount;
        let playoffCount;
        if (selectedBreak.startsWith('partial:')) {
            const [, seeded, playoff] = selectedBreak.split(':');
            seededCount = parseInt(seeded, 10);
            playoffCount = parseInt(playoff, 10);
        } else {
            seededCount = parseInt(document.getElementById('break-seeded')?.value ?? '', 10);
            playoffCount = parseInt(document.getElementById('break-playoff')?.value ?? '', 10);
        }

        if (isNaN(seededCount) || isNaN(playoffCount)) {
            showNotification('Enter valid seeded and playoff team counts', 'error');
            return;
        }
        if (seededCount < 0 || playoffCount < 2) {
            showNotification('Seeded teams cannot be negative; playoff teams must be at least 2', 'error');
            return;
        }
        if (seededCount + playoffCount !== actualBreakSize) {
            showNotification(`Seeded (${seededCount}) + Playoff (${playoffCount}) must equal total break size (${actualBreakSize})`, 'error');
            return;
        }

        const perRoom = bp ? BP_TEAMS_PER_ROOM : WSDC_TEAMS_PER_ROOM;
        const minFull = bp ? 4 : 2;

        if (playoffCount < minFull) {
            showNotification(`Playoff teams must be at least ${minFull}`, 'error');
            return;
        }
        if (!_isPowerOfTwo(playoffCount)) {
            showNotification(`Playoff teams (${playoffCount}) must be a power of 2 (2, 4, 8, 16…)`, 'error');
            return;
        }
        if (playoffCount % perRoom !== 0) {
            showNotification(`Playoff teams (${playoffCount}) must be divisible by ${perRoom}`, 'error');
            return;
        }

        const advancers = playoffCount / 2;
        const round2Size = advancers + seededCount;
        if (round2Size < minFull || !_isPowerOfTwo(round2Size) || round2Size % perRoom !== 0) {
            showNotification(`Invalid config: ${playoffCount} playoff → ${advancers} advance + ${seededCount} seeded = ${round2Size} in round 2 (must be a valid bracket size)`, 'error');
            return;
        }

        reservedCount = seededCount;
    } else {
        if (needsPartialBreak(actualBreakSize, bp)) {
            showNotification(`${actualBreakSize} is not a power of 2 — use Partial Break instead`, 'error');
            return;
        }
        const validation = validateBreakSize(actualBreakSize, bp);
        if (validation.errors.length > 0) {
            if (validationEl) {
                validationEl.innerHTML = validation.errors.map(e =>
                    `<div style="color:#dc2626;padding:8px 12px;background:#fef2f2;border-radius:6px;margin-bottom:6px;">⚠️ ${e}</div>`
                ).join('');
            }
            return;
        }
    }

    localStorage.setItem('orion_break_size_custom', actualBreakSize);

    let eligible = includeEliminated ? state.teams : state.teams.filter(t => !t.eliminated);
    if (eligible.length < actualBreakSize) {
        showNotification(`Only ${eligible.length} teams available. Cannot break to ${actualBreakSize}.`, 'error');
        return;
    }

    const teamMetrics = eligible.map(team => {
        const spkrs = team.speakers.filter(s => s.substantiveCount > 0);
        const speakerAvg = spkrs.length
            ? spkrs.reduce((s, x) => s + x.substantiveTotal / x.substantiveCount, 0) / spkrs.length
            : 0;

        let adjustedTotal = team.total || 0;
        if (criteria === 'adjusted' && team.roundScores) {
            const scores = Object.values(team.roundScores);
            if (scores.length > 1) adjustedTotal = scores.reduce((a, b) => a + b, 0) - Math.min(...scores);
        }

        return { team, wins: team.wins || 0, total: team.total || 0, adjustedTotal, speakerAvg };
    });

    const sorters = {
        wins: (a, b) => b.wins - a.wins || b.total - a.total || b.speakerAvg - a.speakerAvg,
        points: (a, b) => b.total - a.total || b.wins - a.wins || b.speakerAvg - a.speakerAvg,
        speaker: (a, b) => b.speakerAvg - a.speakerAvg || b.wins - a.wins || b.total - a.total,
        adjusted: (a, b) => b.adjustedTotal - a.adjustedTotal || b.wins - a.wins,
    };

    const sorted = teamMetrics.sort(sorters[criteria] || sorters.wins);

    state.teams.forEach(t => { t.broke = false; t.seed = null; t.reserved = false; });

    if (isPartial && reservedCount > 0) {
        // Seeds are globally sequential: 1..R for seeded (reserved byes), R+1..total for playoff teams.
        // This ensures breaking.sort(seed) places reserved teams first, so breaking.slice(R) reliably
        // yields only the playoff teams when generateKnockout() builds the preliminary round.
        sorted.slice(0, reservedCount).forEach((m, i) => {
            m.team.broke = true;
            m.team.reserved = true;
            m.team.seed = i + 1;
        });
        sorted.slice(reservedCount, actualBreakSize).forEach((m, i) => {
            m.team.broke = true;
            m.team.seed = reservedCount + i + 1;
        });
    } else {
        sorted.slice(0, actualBreakSize).forEach((m, i) => {
            m.team.broke = true;
            m.team.seed = i + 1;
        });
    }

    const fmt = isBP() ? 'bp' : 'wsdc';
    if (!state.tournament) state.tournament = { active: false, bracket: [], currentRound: 0, champion: null, breakingTeams: [], format: fmt };
    state.tournament.breakingTeams = sorted.slice(0, actualBreakSize).map(m => m.team.id);
    state.tournament.format = fmt;
    state.tournament.isPartial = isPartial;
    state.tournament.reservedCount = reservedCount;

    save();
    renderBreak();

    let msg;
    if (isPartial) {
        const playoffCount = actualBreakSize - reservedCount;
        msg = `Partial break: ${reservedCount} seeded (byes) + ${playoffCount} playoff → ${actualBreakSize} total`;
    } else {
        msg = `Top ${actualBreakSize} teams break to ${getRoundName(actualBreakSize, bp)}`;
    }
    showNotification(msg, 'success');
}

// ── Generate knockout bracket ──────────────────────────────────────────────

function generateKnockout() {
    const bp = isBP();
    const breaking = state.teams.filter(t => t.broke).sort((a, b) => a.seed - b.seed);
    const reserved = state.teams.filter(t => t.reserved).sort((a, b) => a.seed - b.seed);
    const minSize = bp ? 4 : 2;
    const isPartial = state.tournament?.isPartial;
    const R = reserved.length;
    const N = breaking.length;
    const NR = isPartial && R > 0 ? N - R : N;

    if (isPartial && R > 0) {
        if (NR < minSize) {
            showNotification(`Need at least ${minSize} teams in first round`, 'error');
            return;
        }
        if (!_isPowerOfTwo(NR)) {
            showNotification(`Non-reserved breaking teams (${NR}) must be a power of 2`, 'error');
            return;
        }
    } else {
        if (N < minSize) {
            showNotification(`Need at least ${minSize} breaking teams`, 'error');
            return;
        }
        if (!_isPowerOfTwo(N)) {
            showNotification(`Breaking teams (${N}) must be a power of 2 (${bp ? '4,8,16…' : '2,4,8,16…'})`, 'error');
            return;
        }
    }

    const roundSizes = [];
    let current = isPartial && R > 0 ? NR : N;
    let added = false;
    while (current > 0) {
        roundSizes.push(current);
        const isFinalSize = bp ? current === 4 : current === 2;
        if (isFinalSize && (!isPartial || added)) break;
        // Both formats advance current/2 teams each round:
        //   BP:   2 advance per room of 4  →  (current/4) rooms × 2 = current/2
        //   WSDC: 1 advances per match of 2 →  current/2
        let nxt = Math.floor(current / 2);
        if (isPartial && R > 0 && !added) {
            nxt += R;
            added = true;
        }
        current = nxt;
    }

    const perRoom = bp ? BP_TEAMS_PER_ROOM : WSDC_TEAMS_PER_ROOM;
    for (const size of roundSizes) {
        if (size % perRoom !== 0) {
            showNotification(`Invalid break configuration: round size ${size} is not divisible by ${perRoom}`, 'error');
            return;
        }
    }

    const stages = roundSizes.map((size, idx) => ({
        name: (isPartial && R > 0 && idx === 0) ? 'Preliminary Elimination Round' : getRoundName(size, bp),
        size,
        pairings: [],
        completed: false
    }));

    const firstRoundTeams = isPartial && R > 0 ? breaking.slice(R) : breaking;
    if (bp) {
        _seedBPFirstRound(stages, firstRoundTeams);
    } else {
        _seedWSDCFirstRound(stages, firstRoundTeams);
    }

    for (let s = 1; s < stages.length; s++) {
        const pairCount = stages[s].size / perRoom;
        for (let p = 0; p < pairCount; p++) {
            stages[s].pairings.push(bp ? _blankBPPairing(p) : _blankWSDCPairing(p));
        }
    }

    if (R > 0) {
        _placeReservedTeams(stages, reserved, bp);
    }
    _allocateOutroundPanels(stages, bp);

    state.teams.forEach(t => {
        if (t.tournamentWins === undefined) t.tournamentWins = 0;
        if (t.tournamentLosses === undefined) t.tournamentLosses = 0;
        if (!t.broke) t.eliminated = false;
    });

    state.tournament = {
        active: true,
        bracket: stages,
        currentRound: 0,
        champion: null,
        breakingTeams: breaking.map(t => t.id),
        format: bp ? 'bp' : 'wsdc',
        isPartial: isPartial,
        reservedCount: R,
    };

    save();
    if (typeof window.switchTab === 'function') {
        window.switchTab('draw');
        setTimeout(() => {
            window.renderDraw?.();
            document.getElementById('round-card-ko-0')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
    } else {
        renderKnockout();
    }
    const roomWord = bp ? 'rooms' : 'matches';
    showNotification(`${stages[0].name} bracket generated — ${stages[0].pairings.length} ${roomWord}`, 'success');
}

function _seedBPFirstRound(stages, breaking) {
    const n = breaking.length;
    const roomCount = n / BP_TEAMS_PER_ROOM;
    for (let i = 0; i < roomCount; i++) {
        const og = breaking[i];
        const oo = breaking[n / 2 - 1 - i];
        const cg = breaking[n / 2 + i];
        const co = breaking[n - 1 - i];
        stages[0].pairings.push({
            id: i + 1,
            og: og.id, oo: oo.id, cg: cg.id, co: co.id,
            ogSeed: og.seed, ooSeed: oo.seed, cgSeed: cg.seed, coSeed: co.seed,
            first: null, second: null, third: null, fourth: null,
            entered: false,
            room: `Room ${String.fromCharCode(CHAR_CODE_A + i)}`,
        });
    }
}

function _seedWSDCFirstRound(stages, breaking) {
    const n = breaking.length;
    for (let i = 0; i < n / WSDC_TEAMS_PER_ROOM; i++) {
        stages[0].pairings.push({
            id: i + 1,
            gov: breaking[i].id,
            opp: breaking[n - 1 - i].id,
            govSeed: breaking[i].seed,
            oppSeed: breaking[n - 1 - i].seed,
            winner: null, loser: null, entered: false,
            room: `Knockout ${String.fromCharCode(CHAR_CODE_A + i)}`,
        });
    }
}

function _placeReservedTeams(stages, reserved, bp) {
    const roundIdx = 1;
    if (roundIdx >= stages.length) return;
    const pairings = stages[roundIdx].pairings;
    if (!pairings || pairings.length === 0) return;

    if (bp) {
        // Fold: room p gets reserved[p] in OO and reserved[R-1-p] in CO.
        // OG and CG are left null so prelim advancers fill them correctly.
        // Ensures top seeds are split across rooms (R=4, M=2 → room0: 1+4, room1: 2+3).
        const R = reserved.length;
        for (let p = 0; p < pairings.length; p++) {
            const hi = reserved[p];
            const lo = reserved[R - 1 - p];
            if (hi) {
                pairings[p].oo = hi.id;
                pairings[p].ooSeed = hi.seed;
            }
            if (lo && lo !== hi) {
                pairings[p].co = lo.id;
                pairings[p].coSeed = lo.seed;
            }
        }
    } else {
        for (let i = 0; i < reserved.length && i < pairings.length; i++) {
            pairings[i].gov = reserved[i].id;
            pairings[i].govSeed = reserved[i].seed;
        }
    }
}

// ── Render knockout tab ────────────────────────────────────────────────────

function renderKnockout() {
    const container = document.getElementById('knockout-container');
    if (!container) return;

    const knockoutRounds = (state.rounds || []).filter(r => r.type === 'knockout');
    const hasLegacyBracket = !!state.tournament?.active;

    if (!knockoutRounds.length && !hasLegacyBracket) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b">
                <div style="font-size:48px;margin-bottom:12px">⚔️</div>
                <h3 style="margin:0 0 8px;color:#1e293b">No Outround Draw Yet</h3>
                <p style="margin:0 0 16px">Generate a bracket from the Break tab, then draw outround rooms here.</p>
            </div>`;
        return;
    }

    const previousMeetings = getPreviousMeetings();
    let html = '';

    if (knockoutRounds.length) {
        html += `<div style="display:grid;gap:14px">
            ${knockoutRounds.slice().reverse().map(round =>
            renderRoundCard(round, state.rounds.findIndex(r => r.id === round.id), previousMeetings)
        ).join('')}
        </div>`;
    }

    if (hasLegacyBracket) {
        html += renderActiveOutroundDraw(false);
    }

    container.innerHTML = html;
}
const _BP_POSITIONS = [
    { key: 'og', label: 'OG', fullLabel: 'Opening Government', govSide: true },
    { key: 'oo', label: 'OO', fullLabel: 'Opening Opposition', govSide: false },
    { key: 'cg', label: 'CG', fullLabel: 'Closing Government', govSide: true },
    { key: 'co', label: 'CO', fullLabel: 'Closing Opposition', govSide: false },
];

function swapTeamPositions(roundIdx, pIdx) {
    const pairing = state.tournament.bracket[roundIdx].pairings[pIdx];
    if (pairing.entered) {
        showNotification('Cannot swap positions after a result has been entered', 'error');
        return;
    }

    if (tournamentIsBP()) {
        _openBPSwapModal(roundIdx, pIdx);
    } else {
        [pairing.gov, pairing.opp] = [pairing.opp, pairing.gov];
        [pairing.govSeed, pairing.oppSeed] = [pairing.oppSeed, pairing.govSeed];
        save();
        renderKnockout();
        showNotification('GOV / OPP positions swapped', 'success');
    }
}

function _openBPSwapModal(roundIdx, pIdx) {
    const pairing = state.tournament.bracket[roundIdx].pairings[pIdx];
    const teamOptions = _BP_POSITIONS
        .map(pos => ({ id: pairing[pos.key], seed: pairing[`${pos.key}Seed`], name: _getTeam(pairing[pos.key])?.name }))
        .filter(t => t.id != null);

    closeAllModals();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ko-result-overlay';
    overlay.onclick = e => { if (e.target === overlay) closeAllModals(); };

    const modal = document.createElement('div');
    modal.className = 'modal ko-result-modal';
    modal.style.maxWidth = '480px';
    modal.innerHTML = `
        <h2 style="margin-top:0;">⇄ Rearrange BP Positions</h2>
        <p style="color:#64748b;font-size:14px;">Reassign which team occupies each position.</p>
        <div style="display:grid;gap:12px;margin:16px 0;">
            ${_BP_POSITIONS.map(pos => `
            <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:190px;flex-shrink:0;">
                    <span style="font-size:10px;font-weight:900;letter-spacing:.6px;color:${pos.govSide ? '#1d4ed8' : '#b91c1c'};">${pos.label}</span>
                    <div style="font-size:12px;color:#64748b;">${pos.fullLabel}</div>
                </div>
                <select id="swap-${pos.key}" style="flex:1;padding:8px;border-radius:6px;border:1px solid #e2e8f0;font-size:13px;">
                    ${teamOptions.map(t => `
                    <option value="${t.id}" ${t.id == pairing[pos.key] ? 'selected' : ''}>
                        ${escapeHTML(t.name || '?')}${t.seed ? ` (#${t.seed})` : ''}
                    </option>`).join('')}
                </select>
            </div>`).join('')}
        </div>
        <div id="swap-error" style="color:#dc2626;margin-bottom:10px;display:none;font-size:13px;"></div>
        <div style="display:flex;gap:10px;">
            <button onclick="window.applyBPSwap(${roundIdx},${pIdx})" class="primary" style="flex:2;padding:12px;">✅ Apply</button>
            <button onclick="window.closeAllModals()" class="secondary" style="flex:1;padding:12px;">Cancel</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function applyBPSwap(roundIdx, pIdx) {
    const pairing = state.tournament.bracket[roundIdx].pairings[pIdx];
    const newAssign = {};
    for (const pos of _BP_POSITIONS) {
        const el = document.getElementById(`swap-${pos.key}`);
        newAssign[pos.key] = el ? (isNaN(parseInt(el.value)) ? el.value : parseInt(el.value)) : null;
    }

    const vals = Object.values(newAssign).filter(Boolean);
    if (new Set(vals).size !== _BP_POSITIONS.length || vals.length !== _BP_POSITIONS.length) {
        const err = document.getElementById('swap-error');
        if (err) { err.style.display = 'block'; err.textContent = 'Each team must appear in exactly one position'; }
        return;
    }

    const seedOf = {};
    _BP_POSITIONS.forEach(pos => { if (pairing[pos.key] != null) seedOf[pairing[pos.key]] = pairing[`${pos.key}Seed`]; });

    _BP_POSITIONS.forEach(pos => {
        pairing[pos.key] = newAssign[pos.key];
        pairing[`${pos.key}Seed`] = seedOf[newAssign[pos.key]] ?? null;
    });

    save();
    closeAllModals();
    renderKnockout();
    showNotification('Positions updated', 'success');
}

// ── Enter / submit knockout result ─────────────────────────────────────────

function enterKnockoutResult(roundIndex, pairingIndex) {
    _syncTournamentProgress(state.tournament);
    const pairing = state.tournament?.bracket?.[roundIndex]?.pairings?.[pairingIndex];
    if (!pairing) return;
    if (!_canSubmitPairing(pairing)) {
        showNotification('You are not assigned to this room', 'error');
        return;
    }
    if (roundIndex !== state.tournament.currentRound) {
        showNotification('This knockout round is not open for ballots yet', 'error');
        return;
    }
    if (tournamentIsBP()) {
        _enterBPResult(roundIndex, pairingIndex);
    } else {
        _enterWSDCResult(roundIndex, pairingIndex);
    }
}

let _bpAdvancing = [];
let _bpAdvancingMax = 2;
window._bpAdvancing = _bpAdvancing;
window._bpAdvancingMax = _bpAdvancingMax;

function _enterBPResult(roundIndex, pairingIndex) {
    const round = state.tournament.bracket[roundIndex];
    const pairing = round.pairings[pairingIndex];

    const slots = _BP_POSITIONS.map(pos => ({
        key: pos.key,
        label: pos.label,
        gov: pos.govSide,
        team: _getTeam(pairing[pos.key]),
        seed: pairing[`${pos.key}Seed`],
    })).filter(s => s.team);

    if (slots.length < 4) {
        showNotification('All 4 team positions must be filled before entering results', 'error');
        return;
    }

    const isLastRound = roundIndex === state.tournament.bracket.length - 1;
    const maxPicks = isLastRound ? 1 : 2;
    _bpAdvancing = [];
    _bpAdvancingMax = maxPicks;
    window._bpAdvancing = _bpAdvancing;
    window._bpAdvancingMax = _bpAdvancingMax;
    window._koActiveResultArgs = { roundIndex, pairingIndex };

    closeAllModals();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ko-result-overlay';
    overlay.onclick = e => { if (e.target === overlay) { _bpAdvancing = []; window._bpAdvancing = []; closeAllModals(); } };

    const modal = document.createElement('div');
    modal.className = 'modal ko-result-modal';
    modal.style.maxWidth = '520px';
    modal.innerHTML = `
        <h2 style="margin-top:0;">${isLastRound ? '🏆 Grand Final' : '✏️ Enter Results'}</h2>
        <p style="color:#64748b;font-size:14px;">${escapeHTML(round.name)} — ${escapeHTML(pairing.room)}</p>
        <p style="font-size:13px;color:#64748b;margin-top:0;">${isLastRound
            ? 'Select the <strong>winning team</strong>.'
            : 'Select the <strong>2 teams that advance</strong>. The rest are eliminated.'}</p>
        <div id="bp-team-cards" style="margin:16px 0;display:grid;gap:10px;">
            ${slots.map(s => `
            <div id="bp-card-${s.key}" role="button" tabindex="0"
                data-bp-advancer-card="${escapeHTML(String(s.key))}"
                data-bp-team-id="${escapeHTML(String(s.team.id))}"
                onpointerdown="event.preventDefault();event.stopPropagation();window._bpToggleAdvancing('${escapeHTML(String(s.key))}', '${escapeHTML(String(s.team.id))}')"
                ontouchstart="event.preventDefault();event.stopPropagation();window._bpToggleAdvancing('${escapeHTML(String(s.key))}', '${escapeHTML(String(s.team.id))}')"
                onclick="event.preventDefault();event.stopPropagation()"
                style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8fafc;border-radius:10px;border:2px solid #e2e8f0;cursor:pointer;transition:all 0.15s;user-select:none;gap:12px;">
                <div style="min-width:0;flex:1;">
                    <div style="font-size:9px;font-weight:900;letter-spacing:.6px;color:${s.gov ? '#1d4ed8' : '#b91c1c'};">${s.label}</div>
                    <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_teamDisplayHtml(s.team)}</div>
                    <div style="font-size:11px;color:#94a3b8;">Seed #${s.seed || '?'}</div>
                </div>
                <div id="bp-badge-${s.key}" style="font-size:22px;opacity:.25;">${isLastRound ? '🏆' : '✅'}</div>
            </div>`).join('')}
        </div>
        <div id="bp-counter" style="text-align:center;font-size:13px;color:#64748b;margin-bottom:12px;">
            ${isLastRound ? 'No winner selected' : '0 / 2 advancing selected'}
        </div>
        <div id="bp-error" style="color:#dc2626;margin-bottom:10px;display:none;font-size:13px;"></div>
        <div style="display:flex;gap:10px;">
            <button type="button" data-ko-submit-bp onclick="event.preventDefault();event.stopPropagation();window.submitKnockoutResult(${roundIndex},${pairingIndex})" class="primary" style="flex:2;padding:12px;">Submit</button>
            <button type="button" onclick="event.preventDefault();event.stopPropagation();window._bpAdvancing=[];window.closeAllModals()" class="secondary" style="flex:1;padding:12px;">Cancel</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    modal.querySelectorAll('[data-bp-advancer-card]').forEach(card => {
        const toggle = event => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            window._bpToggleAdvancing(card.dataset.bpAdvancerCard, card.dataset.bpTeamId);
        };
        card.addEventListener('pointerdown', toggle);
        card.addEventListener('touchstart', toggle, { passive: false });
        card.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
        });
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') toggle(event);
        });
    });
}

window._bpToggleAdvancing = function (posKey, teamId) {
    teamId = String(teamId);
    const maxPicks = window._bpAdvancingMax;
    const isFinal = maxPicks === 1;
    const idx = window._bpAdvancing.indexOf(teamId);
    const card = document.getElementById(`bp-card-${posKey}`);
    const badge = document.getElementById(`bp-badge-${posKey}`);

    if (idx !== -1) {
        window._bpAdvancing.splice(idx, 1);
        card.style.borderColor = '#e2e8f0';
        card.style.background = '#f8fafc';
        badge.style.opacity = '.25';
        card.setAttribute('aria-pressed', 'false');
    } else {
        if (window._bpAdvancing.length >= maxPicks) {
            const err = document.getElementById('bp-error');
            if (err) {
                err.style.display = 'block';
                err.textContent = isFinal
                    ? 'Only 1 winner can be selected — deselect the current choice first.'
                    : 'Only 2 teams can advance — deselect one first.';
            }
            return;
        }
        window._bpAdvancing.push(teamId);
        card.style.borderColor = isFinal ? '#f59e0b' : '#22c55e';
        card.style.background = isFinal ? '#fef9e7' : '#f0fdf4';
        badge.style.opacity = '1';
        card.setAttribute('aria-pressed', 'true');
    }

    const err = document.getElementById('bp-error');
    if (err) err.style.display = 'none';

    const counter = document.getElementById('bp-counter');
    if (counter) {
        counter.textContent = isFinal
            ? (window._bpAdvancing.length === 1 ? '🏆 Winner selected' : 'No winner selected')
            : `${window._bpAdvancing.length} / 2 advancing selected`;
    }
};

function _enterWSDCResult(roundIndex, pairingIndex) {
    const round = state.tournament.bracket[roundIndex];
    const pairing = round.pairings[pairingIndex];
    const gov = _getTeam(pairing.gov);
    const opp = _getTeam(pairing.opp);

    if (!gov || !opp) { showNotification('Both teams must be set before entering a result', 'error'); return; }
    window._koWinnerSelection = null;
    window._koActiveResultArgs = { roundIndex, pairingIndex };

    const entries = [
        { side: 'gov', label: 'GOV', color: '#1d4ed8', team: gov, seed: pairing.govSeed },
        { side: 'opp', label: 'OPP', color: '#b91c1c', team: opp, seed: pairing.oppSeed },
    ];

    closeAllModals();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ko-result-overlay';
    overlay.onclick = e => { if (e.target === overlay) closeAllModals(); };

    const modal = document.createElement('div');
    modal.className = 'modal ko-result-modal';
    modal.style.maxWidth = '460px';
    modal.innerHTML = `
        <h2 style="margin-top:0;">Select Winner</h2>
        <p style="color:#64748b;">${escapeHTML(round.name)} - ${escapeHTML(pairing.room)}</p>
        <div style="margin:20px 0;display:flex;flex-direction:column;gap:10px;">
            ${entries.map(entry => `
            <div role="button" tabindex="0"
                data-wsdc-winner-card="${escapeHTML(String(entry.team.id))}"
                onpointerdown="event.preventDefault();event.stopPropagation();window._koSelectWSDCWinner('${escapeHTML(String(entry.team.id))}')"
                ontouchstart="event.preventDefault();event.stopPropagation();window._koSelectWSDCWinner('${escapeHTML(String(entry.team.id))}')"
                onclick="event.preventDefault();event.stopPropagation();window._koSelectWSDCWinner('${escapeHTML(String(entry.team.id))}')"
                style="width:100%;text-align:left;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;background:#f8fafc;border-radius:8px;cursor:pointer;border:2px solid #e2e8f0;color:inherit;">
                <div style="min-width:0;">
                    <div style="font-size:9px;font-weight:900;color:${entry.color};letter-spacing:.6px;">${entry.label}</div>
                    <strong>${_teamDisplayHtml(entry.team)}</strong>
                    <span style="color:#64748b;">Seed #${entry.seed || '?'}</span>
                </div>
                <span data-wsdc-winner-badge="${escapeHTML(String(entry.team.id))}" style="font-size:12px;font-weight:800;color:#16a34a;opacity:0;">Winner</span>
            </div>`).join('')}
        </div>
        <div id="ko-error" style="color:#dc2626;margin-bottom:10px;display:none;"></div>
        <div id="ko-status" style="color:#64748b;margin-bottom:10px;font-size:12px;min-height:16px;">Select a team to continue.</div>
        <div style="display:flex;gap:10px;">
            <button type="button" data-ko-submit-wsdc onclick="event.preventDefault();event.stopPropagation();window.submitKnockoutResult(${roundIndex},${pairingIndex})" class="primary" style="flex:2;padding:12px;">Submit</button>
            <button type="button" onclick="window.closeAllModals()" class="secondary" style="flex:1;padding:12px;">Cancel</button>
        </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    modal.querySelectorAll('[data-wsdc-winner-card]').forEach(card => {
        const select = event => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            window._koSelectWSDCWinner(card.dataset.wsdcWinnerCard);
        };
        card.addEventListener('pointerdown', select);
        card.addEventListener('click', select);
        card.addEventListener('touchstart', select, { passive: false });
        card.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select();
            }
        });
    });
}

document.addEventListener('pointerdown', event => {
    const bpCard = event.target.closest?.('[data-bp-advancer-card]');
    if (bpCard) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        window._bpToggleAdvancing(bpCard.dataset.bpAdvancerCard, bpCard.dataset.bpTeamId);
        return;
    }
    const card = event.target.closest?.('[data-wsdc-winner-card]');
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    window._koSelectWSDCWinner(card.dataset.wsdcWinnerCard);
}, true);

document.addEventListener('click', event => {
    const submit = event.target.closest?.('[data-ko-submit-wsdc], [data-ko-submit-bp]');
    if (submit) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const active = window._koActiveResultArgs;
        if (active) window.submitKnockoutResult(active.roundIndex, active.pairingIndex);
        return;
    }
    const bpCard = event.target.closest?.('[data-bp-advancer-card]');
    if (bpCard) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
    }
    const card = event.target.closest?.('[data-wsdc-winner-card]');
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    window._koSelectWSDCWinner(card.dataset.wsdcWinnerCard);
}, true);

window._koSelectWSDCWinner = function (teamId) {
    window._koWinnerSelection = String(teamId);
    document.querySelectorAll('[data-wsdc-winner-card]').forEach(card => {
        const selected = card.dataset.wsdcWinnerCard === String(teamId);
        card.style.borderColor = selected ? '#22c55e' : '#e2e8f0';
        card.style.background = selected ? '#f0fdf4' : '#f8fafc';
        card.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    document.querySelectorAll('[data-wsdc-winner-badge]').forEach(badge => {
        badge.style.opacity = badge.dataset.wsdcWinnerBadge === String(teamId) ? '1' : '0';
    });
    const err = document.getElementById('ko-error');
    if (err) err.style.display = 'none';
    const status = document.getElementById('ko-status');
    const team = _getTeam(teamId);
    if (status) status.textContent = `${team?.name || 'Team'} selected.`;
};
function _refreshKnockoutDisplay() {
    renderKnockout();
    if (typeof window.displayRounds === 'function' && document.getElementById('rounds-list')) {
        window.displayRounds();
    }
}

function submitKnockoutResult(roundIndex, pairingIndex) {
    const showSubmitError = message => {
        closeAllModals();
        _forceUnlockPageScroll();
        showNotification(message, 'error');
    };

    _refreshTeamCache();

    const pairing = state.tournament?.bracket?.[roundIndex]?.pairings?.[pairingIndex];
    if (!pairing) {
        showSubmitError('Could not find this outround room. Refresh the draw and try again.');
        return;
    }
    const submitKey = `${roundIndex}:${pairingIndex}`;
    if (window._koSubmitting === submitKey) {
        showSubmitError('Submission is already in progress. Please wait a moment.');
        return;
    }

    window._koSubmitting = submitKey;
    try {
        _syncTournamentProgress(state.tournament);
        if (!_canSubmitPairing(pairing)) {
            showSubmitError('You are not assigned to this room');
            return;
        }
        if (roundIndex !== state.tournament.currentRound) {
            showSubmitError('This knockout round is not open for ballots yet');
            return;
        }
        if (tournamentIsBP()) {
            _submitBPResult(roundIndex, pairingIndex);
        } else {
            _submitWSDCResult(roundIndex, pairingIndex);
        }
    } catch (error) {
        console.error('[knockout] submit failed:', error);
        showSubmitError(`Outround ballot failed: ${error?.message || error}`);
    } finally {
        if (window._koSubmitting === submitKey) window._koSubmitting = null;
    }
}

function _submitBPResult(roundIndex, pairingIndex) {
    const tournament = state.tournament;
    const bracket = tournament.bracket;
    const previousCurrentRound = tournament.currentRound ?? 0;
    const round = bracket[roundIndex];
    const pairing = round.pairings[pairingIndex];

    const advancing = (window._bpAdvancing || []).map(id => String(id));
    const isLastRound = roundIndex === bracket.length - 1;
    const required = isLastRound ? 1 : 2;

    if (advancing.length !== required) {
        _showModalError('bp-error', isLastRound ? 'Select the winning team' : 'Select exactly 2 advancing teams');
        return;
    }

    const allIds = _BP_POSITIONS.map(pos => pairing[pos.key]).filter(id => id != null).map(id => String(id));
    const remaining = allIds.filter(id => !advancing.includes(String(id)));

    const placeToId = {
        1: advancing[0],
        2: advancing[1] ?? remaining[0] ?? null,
        3: advancing[1] != null ? remaining[0] ?? null : remaining[1] ?? null,
        4: advancing[1] != null ? remaining[1] ?? null : remaining[2] ?? null,
    };

    if (pairing.entered) {
        [pairing.first, pairing.second].forEach(tid => {
            const t = _getTeam(tid);
            if (t) { if (t.tournamentWins > 0) t.tournamentWins -= 1; t.eliminated = false; }
        });
        [pairing.third, pairing.fourth].forEach(tid => {
            const t = _getTeam(tid);
            if (t) { if (t.tournamentLosses > 0) t.tournamentLosses -= 1; t.eliminated = false; }
        });
    }

    pairing.first = placeToId[1];
    pairing.second = placeToId[2];
    pairing.third = placeToId[3];
    pairing.fourth = placeToId[4];
    pairing.entered = true;

    [pairing.first, pairing.second].forEach(tid => {
        const t = _getTeam(tid);
        if (t) { t.tournamentWins = (t.tournamentWins || 0) + 1; t.eliminated = false; }
    });
    [pairing.third, pairing.fourth].forEach(tid => {
        const t = _getTeam(tid);
        if (t) { t.tournamentLosses = (t.tournamentLosses || 0) + 1; t.eliminated = true; }
    });

    if (!isLastRound) {
        const nextRound = bracket[roundIndex + 1];
        let nextSlot, isEven;
        if (state.tournament.isPartial && roundIndex === 0) {
            // Reserved teams are pre-placed in OO/CO slots by _placeReservedTeams.
            // Advancers from the partial round must always fill the remaining OG/CG slots,
            // regardless of which room (pairingIndex) they came from.
            nextSlot = pairingIndex;
            isEven = true;
        } else {
            nextSlot = Math.floor(pairingIndex / 2);
            isEven = pairingIndex % 2 === 0;
        }
        const firstTeam = _getTeam(pairing.first);
        const secondTeam = _getTeam(pairing.second);

        if (!nextRound.pairings[nextSlot]) nextRound.pairings[nextSlot] = _blankBPPairing(nextSlot);
        const target = nextRound.pairings[nextSlot];

        if (isEven) {
            if (target.og === null) {
                target.og = pairing.first;
                target.ogSeed = firstTeam?.seed ?? null;
            } else if (target.cg === null) {
                target.cg = pairing.first;
                target.cgSeed = firstTeam?.seed ?? null;
            } else {
                target.og = pairing.first;
                target.ogSeed = firstTeam?.seed ?? null;
            }

            if (target.cg === null && pairing.second !== null) {
                target.cg = pairing.second;
                target.cgSeed = secondTeam?.seed ?? null;
            } else if (target.og === null && pairing.second !== null) {
                target.og = pairing.second;
                target.ogSeed = secondTeam?.seed ?? null;
            } else if (pairing.second !== null) {
                target.cg = pairing.second;
                target.cgSeed = secondTeam?.seed ?? null;
            }
        } else {
            if (target.oo === null) {
                target.oo = pairing.first;
                target.ooSeed = firstTeam?.seed ?? null;
            } else if (target.co === null) {
                target.co = pairing.first;
                target.coSeed = firstTeam?.seed ?? null;
            } else {
                target.oo = pairing.first;
                target.ooSeed = firstTeam?.seed ?? null;
            }

            if (target.co === null && pairing.second !== null) {
                target.co = pairing.second;
                target.coSeed = secondTeam?.seed ?? null;
            } else if (target.oo === null && pairing.second !== null) {
                target.oo = pairing.second;
                target.ooSeed = secondTeam?.seed ?? null;
            } else if (pairing.second !== null) {
                target.co = pairing.second;
                target.coSeed = secondTeam?.seed ?? null;
            }
        }
    } else {
        tournament.champion = pairing.first;
    }

    _repairWSDCProgression(tournament);
    const nextCurrentRound = _syncTournamentProgress(tournament);
    const advancedRound = nextCurrentRound > previousCurrentRound;

    save();
    window._bpAdvancing = [];
    closeAllModals();
    _forceUnlockPageScroll();
    _refreshKnockoutDisplay();
    if (advancedRound) _scrollToCurrentRound();
    if (typeof renderStandings === 'function') renderStandings();

    const first = _getTeam(pairing.first);
    const second = _getTeam(pairing.second);
    const msg = isLastRound
        ? `🏆 ${first?.name} is the Champion!`
        : `${first?.name} (1st) & ${second?.name} (2nd) advance!`;
    showNotification(msg, 'success');
}

function _submitWSDCResult(roundIndex, pairingIndex) {
    const status = document.getElementById('ko-status');
    if (status) status.textContent = 'Submitting result...';
    const tournament = state.tournament;
    const bracket = tournament.bracket;
    const previousCurrentRound = tournament.currentRound ?? 0;
    const round = bracket[roundIndex];
    const pairing = round.pairings[pairingIndex];

    const winnerId = window._koWinnerSelection;
    if (!winnerId) { _showModalError('ko-error', 'Please select a winner'); return; }
    const roomTeamIds = [pairing.gov, pairing.opp].filter(_hasTeamId).map(id => String(id));
    if (!roomTeamIds.includes(String(winnerId))) {
        _showModalError('ko-error', 'Selected winner is not in this room. Reopen the ballot and try again.');
        return;
    }

    const previousWinnerId = pairing.entered ? pairing.winner : null;
    if (pairing.entered) {
        const prevWinner = _getTeam(previousWinnerId);
        const prevLoser = _getTeam(pairing.loser);
        if (prevWinner && prevWinner.tournamentWins > 0) prevWinner.tournamentWins -= 1;
        if (prevLoser && prevLoser.tournamentLosses > 0) prevLoser.tournamentLosses -= 1;
        if (prevLoser) prevLoser.eliminated = false;
    }

    const loserId = String(pairing.gov) === String(winnerId) ? pairing.opp : pairing.gov;

    const winner = _getTeam(winnerId);
    const loser = _getTeam(loserId);
    if (!winner) {
        _showModalError('ko-error', 'Selected winner could not be found. Refresh the draw and try again.');
        return;
    }

    pairing.winner = winnerId;
    pairing.loser = loserId;
    pairing.entered = true;

    if (winner) { winner.tournamentWins = (winner.tournamentWins || 0) + 1; winner.eliminated = false; }
    if (loser) { loser.tournamentLosses = (loser.tournamentLosses || 0) + 1; loser.eliminated = true; }

    const isLastRound = roundIndex === bracket.length - 1;
    if (!isLastRound) {
        const nextRound = bracket[roundIndex + 1];
        if (!nextRound) throw new Error('Next outround is missing from the bracket');
        let nextSlotIndex, side;
        if (state.tournament.isPartial && roundIndex === 0) {
            nextSlotIndex = pairingIndex;
            side = 'opp';
        } else {
            nextSlotIndex = Math.floor(pairingIndex / 2);
            side = pairingIndex % 2 === 0 ? 'gov' : 'opp';
        }

        if (!nextRound.pairings[nextSlotIndex]) nextRound.pairings[nextSlotIndex] = _blankWSDCPairing(nextSlotIndex);
        const target = nextRound.pairings[nextSlotIndex];
        const otherSide = side === 'gov' ? 'opp' : 'gov';

        if (previousWinnerId && String(target[side]) === String(previousWinnerId)) {
            target[side] = null;
            target[`${side}Seed`] = null;
        }
        if (String(target[otherSide]) === String(winnerId)) {
            target[otherSide] = null;
            target[`${otherSide}Seed`] = null;
        }

        target[side] = winnerId;
        target[`${side}Seed`] = winner?.seed ?? null;

        target.entered = false;
        target.winner = null;
        target.loser = null;
    } else {
        tournament.champion = winnerId;
    }

    _repairWSDCProgression(tournament);
    const nextCurrentRound = _syncTournamentProgress(tournament);
    const advancedRound = nextCurrentRound > previousCurrentRound;

    save();
    closeAllModals();
    _forceUnlockPageScroll();
    _refreshKnockoutDisplay();
    if (advancedRound) _scrollToCurrentRound();
    if (typeof renderStandings === 'function') renderStandings();

    const msg = isLastRound
        ? `🏆 ${winner?.name} is the Champion!`
        : `${winner?.name} advances! ${loser?.name} eliminated.`;
    showNotification(msg, 'success');
}

function _showModalError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'block'; el.textContent = msg; }
}

function _forceUnlockPageScroll() {
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    document.documentElement.style.overflow = '';
}

function _scrollToCurrentRound() {
    const roundIdx = state.tournament?.currentRound ?? 0;
    requestAnimationFrame(() => {
        document.getElementById(`ko-round-${roundIdx}`)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
}

// ── Reset tournament ───────────────────────────────────────────────────────

function resetTournament() {
    if (!confirm('Reset tournament? Clears all knockout results but keeps preliminary data.')) return;

    state.teams.forEach(t => {
        t.broke = false;
        t.seed = null;
        t.reserved = false;
        t.tournamentWins = 0;
        t.tournamentLosses = 0;
        t.eliminated = false;
    });

    state.tournament = { active: false, bracket: [], currentRound: 0, champion: null, breakingTeams: [] };

    save();
    renderBreak();
    renderKnockout();
    renderStandings();
    showNotification('Tournament reset', 'info');
}

// ── Exports ────────────────────────────────────────────────────────────────

export {
    renderBreak,
    displayBreakingTeams,
    calculateBreak,
    generateKnockout,
    renderKnockout,
    enterKnockoutResult,
    submitKnockoutResult,
    swapTeamPositions,
    applyBPSwap,
    resetTournament,
    suggestPartialConfig,
};

window.calculateBreak = calculateBreak;
window.generateKnockout = generateKnockout;
window.enterKnockoutResult = enterKnockoutResult;
window.submitKnockoutResult = submitKnockoutResult;
window.repairOutroundProgression = function () {
    _repairWSDCProgression(state.tournament);
    _syncTournamentProgress(state.tournament);
    save();
};
window.swapTeamPositions = swapTeamPositions;
window.applyBPSwap = applyBPSwap;
window.resetTournament = resetTournament;
