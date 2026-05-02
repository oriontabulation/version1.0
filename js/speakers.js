// ============================================
// Speaker rankings and statistics — with category support
// ============================================

import { state, watch, patchTeam } from './state.js';
import { api } from './api.js';
import { escapeHTML, showNotification, teamCode as getTeamCode } from './utils.js';
import { switchTab } from './tab.js';
import { debounce } from './utils.js';
import { buildTeamMap } from './maps.js';

let showReplies       = false;
let disabledSpeakers  = new Set();
let currentTeamFilter = null;

function _speakerName(value) {
    return String(value ?? '').trim();
}

function _speakerKey(teamId, name) {
    const normalized = _speakerName(name).toLowerCase();
    return normalized ? `${teamId}::${normalized}` : null;
}

function _safeEncodedName(name) {
    return encodeURIComponent(_speakerName(name)).replace(/'/g, '%27');
}

function _speakerRosterPanel() {
    const teams = state.teams || [];
    const teamOptions = teams
        .map(team => `<option value="${team.id}">${escapeHTML(team.name || 'Unnamed team')}</option>`)
        .join('');
    const rows = teams.map(team => {
        const speakers = (team.speakers || []).filter(s => _speakerName(s.name));
        return `
            <div class="spk-roster-team">
                <div class="spk-roster-team__head">
                    <strong>${escapeHTML(team.name || 'Unnamed team')}</strong>
                    <span>${speakers.length} speaker${speakers.length === 1 ? '' : 's'}</span>
                </div>
                <div class="spk-roster-chips">
                    ${speakers.length ? speakers.map((speaker, index) => `
                        <span class="spk-roster-chip">
                            ${escapeHTML(speaker.name)}${speaker.email ? `<small>${escapeHTML(speaker.email)}</small>` : ''}
                            <button type="button" onclick="window.deleteSpeakerFromTeam('${team.id}',${index})" title="Delete speaker">x</button>
                        </span>`).join('') : '<em>No speakers</em>'}
                </div>
            </div>`;
    }).join('');

    return `
        <details class="spk-admin-panel">
            <summary>
                <span>Manage Speakers</span>
                <small>Add or remove speakers from team rosters</small>
            </summary>
            <div class="spk-add-row">
                <select id="spk-add-team">${teamOptions}</select>
                <input id="spk-add-name" type="text" placeholder="Speaker name">
                <input id="spk-add-email" type="email" placeholder="Email optional">
                <button class="btn btn-primary btn-sm" onclick="window.addSpeakerToTeam()">Add</button>
            </div>
            <div class="spk-roster-list">${rows}</div>
        </details>`;
}

// Dropdown toggle with click-outside auto-close
window._toggleDropdown = function(btn) {
    const menu = btn.nextElementSibling;
    const wasOpen = menu.classList.contains('is-open');
    document.querySelectorAll('.dropdown-menu.is-open').forEach(m => m.classList.remove('is-open'));
    if (!wasOpen) {
        menu.classList.add('is-open');
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!btn.closest('.dropdown').contains(e.target)) {
                    menu.classList.remove('is-open');
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }
};

try {
    const saved = localStorage.getItem('orion_disabled_speakers');
    if (saved) disabledSpeakers = new Set(JSON.parse(saved));
} catch(e) { /* ignore corrupt disabled-speakers prefs */ }

function saveDisabledSpeakers() {
    try { localStorage.setItem('orion_disabled_speakers', JSON.stringify([...disabledSpeakers])); } catch(e) { /* ignore storage errors */ }
}

function toggleSpeakerDisabled(key) {
    disabledSpeakers.has(key) ? disabledSpeakers.delete(key) : disabledSpeakers.add(key);
    saveDisabledSpeakers();
    renderSpeakerStandings();
    showNotification(disabledSpeakers.has(key) ? 'Speaker hidden' : 'Speaker visible', 'info');
}

function disableTeamSpeakers(teamId) {
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;
    let count = 0;
    (team.speakers || []).forEach(s => {
        const key = _speakerKey(team.id, s.name);
        if (!key) return;
        if (!disabledSpeakers.has(key)) { disabledSpeakers.add(key); count++; }
    });
    saveDisabledSpeakers(); renderSpeakerStandings();
    showNotification(`Disabled ${count} speakers from ${team.name}`, 'success');
}

function enableTeamSpeakers(teamId) {
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;
    let count = 0;
    (team.speakers || []).forEach(s => {
        const key = _speakerKey(team.id, s.name);
        if (!key) return;
        if (disabledSpeakers.has(key)) { disabledSpeakers.delete(key); count++; }
    });
    saveDisabledSpeakers(); renderSpeakerStandings();
    showNotification(`Enabled ${count} speakers from ${team.name}`, 'success');
}

function clearAllDisabledSpeakers() {
    if (disabledSpeakers.size === 0) { showNotification('No disabled speakers to clear', 'info'); return; }
    if (confirm(`Clear all ${disabledSpeakers.size} disabled speakers?`)) {
        disabledSpeakers.clear(); saveDisabledSpeakers(); renderSpeakerStandings();
        showNotification('All speakers are now visible', 'success');
    }
}

function removeSpeakerCategory(teamId, speakerName, catId) {
    const isAdmin = state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin';
    if (!isAdmin) { showNotification('Admin access required', 'error'); return; }
    const targetName = _speakerName(speakerName).toLowerCase();
    // Replace teams array so state proxy fires correctly (same pattern as deleteTeam)
    state.teams = (state.teams || []).map(team => {
        if (team.id != teamId) return team;
        const speakers = (team.speakers || []).map(spk => {
            if (_speakerName(spk.name).toLowerCase() !== targetName) return spk;
            let newCats;
            if (Array.isArray(spk.categories) && spk.categories.length > 0) {
                newCats = spk.categories.filter(c => c !== catId);
            } else {
                // Was inheriting from team — fork a copy minus this category
                newCats = (team.categories || []).filter(c => c !== catId);
            }
            return { ...spk, categories: newCats };
        });
        return { ...team, speakers };
    });
    renderSpeakerStandings();
}

// ============================================
// MAIN RENDER
// ============================================

// ── Shared stats builder — used by both renderSpeakerStandings and exportSpeakerStandings
// Returns { validSpeakers, speakerStats, allRounds, isBP, anyReplies }
function _buildSpeakerStats(catId) {
    const allRounds = [...(state.rounds || [])].filter(r => r.type === 'prelim').sort((a,b) => a.id - b.id);
    const activeId  = state.activeTournamentId;
    const isBP      = state.tournaments?.[activeId]?.format === 'bp';
    const anyReplies = !isBP && allRounds.some(r => !r.disableReply);
    const teamById   = buildTeamMap(state.teams || []);

    // Build valid-speaker map filtered by category
    const validSpeakers = new Map();
    (state.teams || []).forEach(team => {
        if (catId) {
            const tc = Array.isArray(team.categories) ? team.categories : [];
            if (!tc.includes(catId)) return;
        }
        (team.speakers || []).forEach(speaker => {
            const displayName = _speakerName(speaker.name);
            const key = _speakerKey(team.id, displayName);
            if (!key) return;
            validSpeakers.set(key, { teamId: team.id, teamName: team.name, teamCode: getTeamCode(team), displayName });
        });
    });

    // Accumulate per-round scores from debate results
    const speakerStats = new Map();
    allRounds.forEach(round => {
        (round.debates || []).forEach(debate => {
            if (!debate.entered) return;
            if (debate.format === 'bp') {
                ['og','oo','cg','co'].forEach(pos => {
                    const team = teamById.get(String(debate[pos]));
                    if (!team) return;
                    (debate.bpSpeakers?.[pos] || []).forEach(s => {
                        const key = _speakerKey(team.id, s.speaker);
                        if (!key) return;
                        if (validSpeakers.has(key)) {
                            if (!speakerStats.has(key)) speakerStats.set(key, { roundScores: {}, replyScores: {} });
                            speakerStats.get(key).roundScores[round.id] = s.score;
                        }
                    });
                }); return;
            }
            for (const [side, results] of [['gov', debate.govResults], ['opp', debate.oppResults]]) {
                if (!results) continue;
                const team = teamById.get(String(debate[side]));
                if (!team) continue;
                (results.substantive || []).forEach(s => {
                    const key = _speakerKey(team.id, s.speaker);
                    if (!key) return;
                    if (validSpeakers.has(key)) {
                        if (!speakerStats.has(key)) speakerStats.set(key, { roundScores: {}, replyScores: {} });
                        const st = speakerStats.get(key);
                        const ex = st.roundScores[round.id];
                        st.roundScores[round.id] = ex !== undefined ? Math.max(ex, s.score) : s.score;
                    }
                });
                if (results.reply?.speaker) {
                    const key = _speakerKey(team.id, results.reply.speaker);
                    if (validSpeakers.has(key)) {
                        if (!speakerStats.has(key)) speakerStats.set(key, { roundScores: {}, replyScores: {} });
                        speakerStats.get(key).replyScores[round.id] = results.reply.score;
                    }
                }
            }
        });
    });

    return { validSpeakers, speakerStats, allRounds, isBP, anyReplies };
}

function renderSpeakerStandings() {
    const container = document.getElementById('speaker-rankings');
    if (!container) {
        createSpeakerRankingsTab();
        return renderSpeakerStandings();
    }

    try {
        _renderSpeakerStandings(container);
    } catch (error) {
        console.error('[speakers] render failed:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">!</div>
                <h3 class="empty-state__title">Speaker Tab Could Not Render</h3>
                <p class="empty-state__desc">One speaker or ballot entry has invalid data. The tab is still available; check the console for details.</p>
            </div>`;
    }
}

function _renderSpeakerStandings(container) {

    // ── Category filter ────────────────────────────────────────────────────
    const catFilters = window._orionCatFilter || {};
    const catId      = catFilters.speakers || null;
    const cats       = typeof window.getCategories === 'function' ? window.getCategories() : [];
    const catObj     = catId ? cats.find(c => c.id === catId) : null;

    const { validSpeakers, speakerStats, allRounds, isBP, anyReplies } = _buildSpeakerStats(catId);
    const isAdmin = state.auth?.currentUser?.role === 'admin';

    // ── Build display list ─────────────────────────────────────────────────
    const teamMap    = new Map();
    let   speakers   = [];
    const totalDisabled = disabledSpeakers.size;

    speakerStats.forEach((stats, key) => {
        const info = validSpeakers.get(key);
        if (!info) return;
        if (!teamMap.has(info.teamId)) teamMap.set(info.teamId, { name: info.teamName, code: info.teamCode, speakerCount: 0, disabledCount: 0 });
        const td = teamMap.get(info.teamId);
        td.speakerCount++;
        if (disabledSpeakers.has(key)) { td.disabledCount++; return; }
        if (currentTeamFilter && info.teamId != currentTeamFilter) return;

        const roundScores = [];
        let totalSub = 0, countSub = 0;
        allRounds.forEach(r => {
            const sc = stats.roundScores[r.id];
            if (sc !== undefined) { roundScores.push(sc.toFixed(1)); totalSub += sc; countSub++; }
            else roundScores.push('—');
        });
        if (countSub === 0) return;

        const avg   = totalSub / countSub;
        let   stdev = 0;
        if (countSub > 1) {
            const scores = Object.values(stats.roundScores);
            stdev = Math.sqrt(scores.map(s => Math.pow(s - avg, 2)).reduce((a,b) => a+b, 0) / (countSub - 1));
        }

        const replyScores = [];
        let totalReply = 0, countReply = 0;
        allRounds.forEach(r => {
            const sc = stats.replyScores[r.id];
            if (sc !== undefined) { replyScores.push(sc.toFixed(1)); totalReply += sc; countReply++; }
        });

        speakers.push({
            key, name: info.displayName, team: info.teamName || '—', teamId: info.teamId,
            teamCode: info.teamCode || '', roundScores, avg, stdev, count: countSub, total: totalSub,
            replyScores, replyAvg: countReply > 0 ? totalReply / countReply : 0,
            replyCount: countReply, replyTotal: totalReply
        });
    });

    // Primary: avg (higher = better). Tiebreaker: stdev (lower = better / more consistent).
    speakers.sort((a, b) => b.avg - a.avg || a.stdev - b.stdev);

    // Assign tied ranks — tied speakers share the same rank number and the
    // next position is skipped (e.g. two speakers at 2nd → next is 4th).
    speakers.forEach((s, i) => {
        if (i === 0) {
            s.rank = 1;
        } else {
            const prev = speakers[i - 1];
            s.rank = (s.avg === prev.avg && s.stdev === prev.stdev)
                ? prev.rank          // same rank as the tied speaker above
                : i + 1;             // i+1 naturally skips the tied positions
        }
    });

    // ── Category switcher bar ──────────────────────────────────────────────
    const catBar = cats.length > 0 ? `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:12px;color:#64748b;font-weight:500;">Category:</span>
            <button onclick="window.switchCategoryTab('speakers',null)"
                style="border:1.5px solid ${!catId?'#1a73e8':'#e2e8f0'};border-radius:16px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;background:${!catId?'#1a73e8':'white'};color:${!catId?'white':'#64748b'};">
                🌐 All</button>
            ${cats.map(cat => `
            <button onclick="window.switchCategoryTab('speakers','${cat.id}')"
                style="background:${catId===cat.id?cat.color:cat.color+'15'};color:${catId===cat.id?'white':cat.color};border:1.5px solid ${cat.color}50;border-radius:16px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;">
                ${cat.icon} ${escapeHTML(cat.name)}</button>`).join('')}
        </div>` : '';

    // ── Filter bar ─────────────────────────────────────────────────────────
    const catBadge = catObj
        ? `<span style="background:${catObj.color}18;border:1.5px solid ${catObj.color}50;color:${catObj.color};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">${catObj.icon} ${escapeHTML(catObj.name)}</span>` : '';

    const filterBar = `
        <div class="standings-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding:16px 20px;">
            <div style="display:flex;align-items:center;gap:14px;">
                <h2 class="u-mt-0" style="font-size:18px;font-weight:700;color:#1e293b;margin:0;">🎤 Speaker Rankings</h2>
                ${catBadge}
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-size:13px;color:#64748b;">${speakers.length} speakers</span>
                ${isAdmin ? `
                <select id="team-filter-select" class="standings-filter-select" style="min-width:150px;font-size:12px;padding:6px 10px;">
                    <option value="">Filter by team...</option>
                    ${Array.from(teamMap.entries()).map(([id, d]) =>
                        `<option value="${id}">${escapeHTML(d.name)} (${d.speakerCount - d.disabledCount}/${d.speakerCount})</option>`
                    ).join('')}
                </select>
                <div class="dropdown" style="display:inline-block;">
                    <button onclick="window._toggleDropdown(this)" class="btn btn-primary btn-sm" style="padding:6px 12px;font-size:12px;">⚙️ Manage ▼</button>
                    <div class="dropdown-menu">
                        <button onclick="window.applyTeamFilter()" class="dropdown-item">✓ Apply Team Filter</button>
                        <button onclick="window.clearTeamFilter()" class="dropdown-item">✕ Clear Filter</button>
                        <div class="dropdown-divider"></div>
                        <button onclick="window.toggleReplyColumn()" class="dropdown-item">${showReplies ? '👁️ Hide Replies' : '👁️ Show Replies'}</button>
                        <div class="dropdown-divider"></div>
                        <button onclick="window.clearAllDisabledSpeakers()" class="dropdown-item">🗑️ Show All Disabled</button>
                        <button onclick="window.showBulkDisableModal()" class="dropdown-item">🔽 Bulk Disable</button>
                        <div class="dropdown-divider"></div>
                        <button onclick="window.exportSpeakerStandings()" class="dropdown-item">📥 Export CSV</button>
                    </div>
                </div>
                ` : `
                <button onclick="window.toggleReplyColumn()" class="btn btn-secondary btn-sm" style="padding:6px 12px;font-size:12px;">
                    ${showReplies ? 'Hide Replies' : 'Show Replies'}
                </button>`}
            </div>
        </div>`;

    // ── Table ──────────────────────────────────────────────────────────────
    const adminRoster = isAdmin ? _speakerRosterPanel() : '';
    let html = `<div class="speaker-section">${adminRoster}${catBar}${filterBar}`;

    if (speakers.length === 0) {
        html += `
            <div class="empty-state">
                <div class="empty-state__icon">🗣️</div>
                <h3 class="empty-state__title">No Speakers</h3>
                <p class="empty-state__desc">${catId ? 'No speakers in this category yet.' : disabledSpeakers.size > 0 ? 'All speakers are hidden.' : 'Enter debate results to see speaker rankings.'}</p>
                ${disabledSpeakers.size > 0 ? '<button onclick="window.clearAllDisabledSpeakers()" class="btn btn-primary btn-sm" style="margin-top:15px;">Show All</button>' : ''}
            </div>`;
    } else {
        html += `<div class="table-wrap"><table class="data-table"><thead><tr>
            ${isAdmin ? '<th class="th-center">👁️</th>' : ''}
            <th>Rank</th><th>Speaker</th><th>Team</th><th>Code</th>
            ${allRounds.map(r => `<th class="th-center">R${r.id}</th>`).join('')}
            <th class="th-center th-accent">Avg</th><th class="th-center">Total</th>
            <th class="th-center">Rounds</th><th class="th-center">StDev</th>
            ${!isBP && showReplies ? '<th class="th-center th-reply">Reply Avg</th>' : ''}
        </tr></thead><tbody>`;

        speakers.forEach((s) => {
            const rank = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `${s.rank}`;

            // Build category badges with remove buttons for admins
            let catBadges = '';
            if (isAdmin) {
                const spkTeam = (state.teams || []).find(t => t.id == s.teamId);
                const spkObj  = (spkTeam?.speakers || []).find(
                    sp => _speakerName(sp.name).toLowerCase() === _speakerName(s.name).toLowerCase()
                );
                const spkCatIds = (spkObj && Array.isArray(spkObj.categories) && spkObj.categories.length > 0)
                    ? spkObj.categories
                    : (Array.isArray(spkTeam?.categories) ? spkTeam.categories : []);
                catBadges = spkCatIds.map(cid => {
                    const cat = cats.find(c => c.id === cid);
                    if (!cat) return '';
                    const enc = _safeEncodedName(s.name);
                    return `<span style="display:inline-flex;align-items:center;background:${cat.color}18;border:1px solid ${cat.color}40;color:${cat.color};padding:1px 4px 1px 7px;border-radius:10px;font-size:10px;font-weight:700;margin-left:4px;">${cat.icon} ${escapeHTML(cat.name)}<button type="button" onclick="window.removeSpeakerCategory(${s.teamId},'${enc}','${cat.id}')" style="margin-left:2px;background:none;border:none;cursor:pointer;color:${cat.color};font-size:12px;font-weight:900;padding:0 2px;line-height:1;opacity:0.6;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="Remove ${cat.name} from ${escapeHTML(s.name)}">×</button></span>`;
                }).join('');
            }

            html += `<tr>
                ${isAdmin ? `<td class="td-center"><button onclick="window.toggleSpeakerDisabled('${s.key}')" class="btn btn-ghost btn-xs">👁️</button></td>` : ''}
                <td class="td-rank"><strong>${rank}</strong></td>
                <td><strong>${escapeHTML(s.name)}</strong>${catBadges}</td>
                <td>${escapeHTML(s.team)}</td>
                <td>${escapeHTML(s.teamCode)}</td>
                ${s.roundScores.map(sc => sc === '—' ? '<td class="td-muted">—</td>' : `<td class="td-score">${sc}</td>`).join('')}
                <td class="td-accent">${s.avg.toFixed(2)}</td>
                <td class="td-center">${s.total.toFixed(1)}</td>
                <td class="td-center">${s.count}</td>
                <td class="td-avg">${s.stdev.toFixed(2)}</td>
                ${!isBP && showReplies ? `<td class="td-reply">${s.replyCount > 0 ? s.replyAvg.toFixed(2) + ' (' + s.replyCount + ')' : '—'}</td>` : ''}
            </tr>`;
        });
        html += '</tbody></table></div>';
    }
    html += '</div>';

    // ── Reply speakers section ─────────────────────────────────────────────
    if (anyReplies && showReplies) {
        const replySpeakers = [];
        speakerStats.forEach((stats, key) => {
            if (Object.keys(stats.replyScores).length === 0 || disabledSpeakers.has(key)) return;
            const info = validSpeakers.get(key);
            if (!info) return;
            if (currentTeamFilter && info.teamId != currentTeamFilter) return;
            const rScores = [];
            let tot = 0, cnt = 0;
            allRounds.forEach(r => {
                const sc = stats.replyScores[r.id];
                if (sc !== undefined) { rScores.push(sc.toFixed(1)); tot += sc; cnt++; }
            });
            if (cnt === 0) return;
            replySpeakers.push({ key, name: info.displayName, team: info.teamName||'—', teamCode: info.teamCode||'', roundScores: rScores, avg: tot/cnt, total: tot, count: cnt });
        });
        replySpeakers.sort((a, b) => b.avg - a.avg);

        // Assign tied ranks for reply speakers (avg only — no stdev here)
        replySpeakers.forEach((s, i) => {
            if (i === 0) {
                s.rank = 1;
            } else {
                const prev = replySpeakers[i - 1];
                s.rank = s.avg === prev.avg ? prev.rank : i + 1;
            }
        });

        const catTitle = catObj ? ` — ${catObj.icon} ${escapeHTML(catObj.name)}` : '';
        html += `<div class="speaker-section u-mt-xl"><h2 class="u-mt-0">Reply Speakers${catTitle}</h2>
            <div class="table-wrap"><table class="data-table data-table--md"><thead><tr>
                ${isAdmin ? '<th class="th-center">👁️</th>' : ''}
                <th>Rank</th><th>Speaker</th><th>Team</th><th>Code</th>
                ${allRounds.map(r => `<th class="th-center">R${r.id}</th>`).join('')}
                <th class="th-center th-reply">Avg</th><th class="th-center">Total</th><th class="th-center">Rounds</th>
            </tr></thead><tbody>`;
        if (replySpeakers.length === 0) {
            html += `<tr><td colspan="${5 + allRounds.length + (isAdmin?1:0)}" class="td-muted" style="padding:40px;">No reply speakers yet</td></tr>`;
        } else {
            replySpeakers.forEach((s) => {
                const rank = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : `${s.rank}`;
                html += `<tr>
                    ${isAdmin ? `<td class="td-center"><button onclick="window.toggleSpeakerDisabled('${s.key}')" class="btn btn-ghost btn-xs">👁️</button></td>` : ''}
                    <td class="td-rank"><strong>${rank}</strong></td>
                    <td><strong>${escapeHTML(s.name)}</strong></td>
                    <td>${escapeHTML(s.team)}</td><td>${escapeHTML(s.teamCode)}</td>
                    ${allRounds.map(r => { const sc = s.roundScores[r.id]; return sc !== undefined ? `<td class="td-score">${parseFloat(sc).toFixed(1)}</td>` : '<td class="td-muted">—</td>'; }).join('')}
                    <td class="td-reply">${s.avg.toFixed(2)}</td>
                    <td class="td-center">${s.total.toFixed(1)}</td>
                    <td class="td-center">${s.count}</td>
                </tr>`;
            });
        }
        html += '</tbody></table></div></div>';
    }

    container.innerHTML = html;
}

// ── Team filter ───────────────────────────────────────────────────────────────
function applyTeamFilter() {
    const select = document.getElementById('team-filter-select');
    if (!select?.value) return;
    currentTeamFilter = select.value;
    renderSpeakerStandings();
}

function clearTeamFilter() {
    currentTeamFilter = null;
    renderSpeakerStandings();
}

// ── Bulk disable modal ────────────────────────────────────────────────────────
async function addSpeakerToTeam() {
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    if (!isAdmin) { showNotification('Admin access required', 'error'); return; }

    const teamId = document.getElementById('spk-add-team')?.value;
    const name = document.getElementById('spk-add-name')?.value.trim();
    const email = document.getElementById('spk-add-email')?.value.trim();
    const team = (state.teams || []).find(t => String(t.id) === String(teamId));

    if (!team) { showNotification('Select a team', 'error'); return; }
    if (!name) { showNotification('Speaker name required', 'error'); return; }

    const speakers = [...(team.speakers || []), { name, email: email || null, position: (team.speakers || []).length + 1 }];
    try {
        await api.updateTeam(team.id, { speakers });
        patchTeam(team.id, { speakers });
        renderSpeakerStandings();
        showNotification(`Added ${name}`, 'success');
    } catch (e) {
        showNotification(`Failed to add speaker: ${e.message}`, 'error');
    }
}

async function deleteSpeakerFromTeam(teamId, index) {
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    if (!isAdmin) { showNotification('Admin access required', 'error'); return; }

    const team = (state.teams || []).find(t => String(t.id) === String(teamId));
    if (!team) return;

    const speakers = (team.speakers || [])
        .filter((_, i) => i !== Number(index))
        .map((speaker, i) => ({ ...speaker, position: i + 1 }));
    try {
        await api.updateTeam(team.id, { speakers });
        patchTeam(team.id, { speakers });
        renderSpeakerStandings();
        showNotification('Speaker deleted', 'info');
    } catch (e) {
        showNotification(`Failed to delete speaker: ${e.message}`, 'error');
    }
}

function showBulkDisableModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.onclick   = e => { if (e.target === modal) modal.remove(); };
    const mc = document.createElement('div');
    mc.className = 'modal';
    mc.innerHTML = `
        <h2 class="u-mt-0">🔽 Bulk Disable Speakers</h2>
        <p class="u-text-muted u-mb-lg">Select teams to disable all their speakers:</p>
        <div class="bulk-disable-list">
            ${(state.teams||[]).map(team => `
                <label class="bulk-disable-row">
                    <input type="checkbox" class="bulk-disable-team bulk-disable-checkbox" value="${team.id}">
                    <span><strong>${escapeHTML(team.name)}</strong> <span class="bulk-disable-count">${(team.speakers||[]).length} speakers</span></span>
                </label>`).join('')}
        </div>
        <div class="modal-actions">
            <button onclick="this.closest('.modal-overlay').remove()" class="btn btn-secondary">Cancel</button>
            <button class="apply-bulk btn btn-danger">Disable Selected</button>
        </div>`;
    modal.appendChild(mc);
    document.body.appendChild(modal);
    mc.querySelector('.apply-bulk').onclick = () => {
        let total = 0;
        mc.querySelectorAll('.bulk-disable-team:checked').forEach(cb => {
            const team = state.teams.find(t => t.id == cb.value);
            if (!team) return;
            (team.speakers || []).forEach(sp => {
                const key = _speakerKey(team.id, sp.name);
                if (!key) return;
                if (!disabledSpeakers.has(key)) { disabledSpeakers.add(key); total++; }
            });
        });
        if (total > 0) { saveDisabledSpeakers(); renderSpeakerStandings(); showNotification(`Disabled ${total} speakers`, 'success'); }
        modal.remove();
    };
}

// ── Reply toggle ──────────────────────────────────────────────────────────────
function toggleReplyColumn() { showReplies = !showReplies; renderSpeakerStandings(); }

// ── Fallback tab creator ──────────────────────────────────────────────────────
function createSpeakerRankingsTab() {
    if (document.getElementById('speakers')) return;
    const tabDiv = document.createElement('div');
    tabDiv.id = 'speakers'; tabDiv.className = 'tab-content';
    tabDiv.innerHTML = '<div id="speaker-rankings"></div>';
    document.body.appendChild(tabDiv);
    const tc = document.querySelector('.tabs');
    if (tc) {
        const btn = document.createElement('button');
        btn.className = 'tab-btn'; btn.textContent = '🗣️ Speakers';
        btn.onclick = () => switchTab('speakers');
        tc.appendChild(btn);
    }
}

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportSpeakerStandings() {
    const catId = window._orionCatFilter?.speakers || null;
    const { validSpeakers, speakerStats, allRounds } = _buildSpeakerStats(catId);

    let rows = [];
    speakerStats.forEach((stats, key) => {
        if (disabledSpeakers.has(key)) return;
        const info = validSpeakers.get(key);
        if (!info) return;
        const rSc = allRounds.map(r => stats.roundScores[r.id] !== undefined ? stats.roundScores[r.id] : '');
        const vals = Object.values(stats.roundScores);
        const tot  = vals.reduce((a,b) => a+b, 0);
        const cnt  = vals.length;
        const avg  = cnt > 0 ? tot / cnt : 0;
        let stdev  = 0;
        if (cnt > 1) {
            stdev = Math.sqrt(vals.map(v => Math.pow(v - avg, 2)).reduce((a,b) => a+b, 0) / (cnt - 1));
        }
        rows.push({ name: info.displayName, team: info.teamName, code: info.teamCode || '', roundScores: rSc, avg, stdev, total: tot, count: cnt });
    });
    rows.sort((a, b) => b.avg - a.avg || a.stdev - b.stdev);

    // Assign tied ranks for export
    rows.forEach((s, i) => {
        if (i === 0) { s.rank = 1; }
        else {
            const prev = rows[i - 1];
            s.rank = (s.avg === prev.avg && s.stdev === prev.stdev) ? prev.rank : i + 1;
        }
    });

    let csv = 'Rank,Speaker,Team,Code' + allRounds.map(r => `,Round ${r.id}`).join('') + ',Average,Total,Rounds\n';
    rows.forEach(s => {
        csv += `${s.rank},${s.name},${s.team},${s.code}` + s.roundScores.map(sc => `,${sc}`).join('') + `,${s.avg.toFixed(2)},${s.total.toFixed(1)},${s.count}\n`;
    });

    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    link.download = `speakers${catId ? '_' + catId : ''}_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    showNotification('Exported', 'success');
}

// ── Watchers ──────────────────────────────────────────────────────────────────
// Debounced render — prevents double re-render when a single action touches
// both 'rounds' and 'teams' (which would previously fire two full renders).
const _debouncedRenderSpeakers = debounce(renderSpeakerStandings, 30);

watch('rounds', _debouncedRenderSpeakers);
watch('teams',  _debouncedRenderSpeakers);
watch('auth',   _debouncedRenderSpeakers);

// ── Window registrations ──────────────────────────────────────────────────────
window.renderSpeakerStandings   = renderSpeakerStandings;
window.exportSpeakerStandings   = exportSpeakerStandings;
window.toggleReplyColumn        = toggleReplyColumn;
window.toggleSpeakerDisabled    = toggleSpeakerDisabled;
window.disableTeamSpeakers      = disableTeamSpeakers;
window.enableTeamSpeakers       = enableTeamSpeakers;
window.clearAllDisabledSpeakers = clearAllDisabledSpeakers;
window.removeSpeakerCategory    = (teamId, encodedName, catId) =>
    removeSpeakerCategory(teamId, decodeURIComponent(encodedName), catId);
window.applyTeamFilter          = applyTeamFilter;
window.clearTeamFilter          = clearTeamFilter;
window.addSpeakerToTeam         = addSpeakerToTeam;
window.deleteSpeakerFromTeam    = deleteSpeakerFromTeam;
window.showBulkDisableModal     = showBulkDisableModal;

export {
    renderSpeakerStandings, toggleReplyColumn, createSpeakerRankingsTab,
    exportSpeakerStandings, showReplies, toggleSpeakerDisabled,
    disableTeamSpeakers, enableTeamSpeakers, clearAllDisabledSpeakers,
    applyTeamFilter, clearTeamFilter, showBulkDisableModal,
    addSpeakerToTeam, deleteSpeakerFromTeam
};
