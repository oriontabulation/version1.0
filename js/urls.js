// ============================================
// DYNAMIC URL FEEDBACK SYSTEM - feedback-urls.js
// With proper error handling for expired/invalid URLs
// ============================================

import { state, save } from './state.js';
import { showNotification, escapeHTML } from './utils.js';

// ============================================
// URL TOKEN MANAGEMENT
// ============================================

// Generate a unique token for a judge or team
function generateUniqueToken(entityId, type) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const entityPrefix = type === 'judge' ? 'J' : 'T';
    return `${entityPrefix}_${entityId}_${timestamp}_${random}`;
}

// Create or update dynamic URL for a judge
function createJudgeURL(judgeId, email) {
    if (!state.dynamicURLs) state.dynamicURLs = {};
    
    const token = generateUniqueToken(judgeId, 'judge');
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}?judge=${token}`;
    
    state.dynamicURLs[judgeId] = {
        token,
        url,
        email,
        type: 'judge',
        createdAt: new Date().toISOString(),
        lastAccess: null,
        currentAssignments: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days expiry
    };
    
    save();
    return url;
}

// Single-judge URL generator — alias used by admin.js and exported by name
// Generates a fresh URL (or regenerates if one already exists) for a single judge
export function generateJudgeURL(judgeId) {
    const judge = state.judges?.find(j => j.id === judgeId);
    if (!judge) {
        showNotification('Judge not found', 'error');
        return null;
    }
    const url = createJudgeURL(judgeId, judge.email || '');
    showNotification(`✅ URL generated for ${judge.name}`, 'success');
    return url;
}

// Copy judge URL to clipboard
export function copyJudgeURL(judgeId) {
    const urlEntry = state.dynamicURLs?.[judgeId];
    if (!urlEntry?.url) {
        showNotification('No URL found for this judge', 'error');
        return;
    }
    navigator.clipboard.writeText(urlEntry.url).then(() => {
        showNotification('URL copied to clipboard', 'success');
    }).catch(() => {
        showNotification('Failed to copy URL', 'error');
    });
}

// Regenerate judge URL (revokes old token and creates new one)
export function regenerateJudgeURL(judgeId) {
    const judge = state.judges?.find(j => j.id === judgeId);
    if (!judge) {
        showNotification('Judge not found', 'error');
        return null;
    }
    // Delete old token if exists
    if (state.dynamicURLs?.[judgeId]) {
        delete state.dynamicURLs[judgeId];
    }
    const url = createJudgeURL(judgeId, judge.email || '');
    showNotification(`🔄 URL regenerated for ${judge.name}`, 'success');
    return url;
}

// Single-team URL generator — alias used by admin.js and exported by name
function generateTeamURL(teamId) {
    const team = state.teams?.find(t => t.id === teamId);
    if (!team) {
        showNotification('Team not found', 'error');
        return null;
    }
    const url = createTeamURL(teamId, team.email || '');
    showNotification(`✅ URL generated for ${team.name}`, 'success');
    return url;
}

// Create or update dynamic URL for a team
function createTeamURL(teamId, email) {
    if (!state.dynamicURLs) state.dynamicURLs = {};
    
    const token = generateUniqueToken(teamId, 'team');
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}?team=${token}`;
    
    state.dynamicURLs[teamId] = {
        token,
        url,
        email,
        type: 'team',
        createdAt: new Date().toISOString(),
        lastAccess: null,
        currentAssignments: [],
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days expiry
    };
    
    save();
    return url;
}

// Check if token is expired
function isTokenExpired(expiresAt) {
    if (!expiresAt) return true;
    return new Date(expiresAt) < new Date();
}

// Validate and get entity from token
function validateToken(token) {
    if (!state.dynamicURLs) {
        return { valid: false, reason: 'No URLs found in system' };
    }
    
    // Find entity by token
    for (const [entityId, data] of Object.entries(state.dynamicURLs)) {
        if (data.token === token) {
            // Check if expired
            if (isTokenExpired(data.expiresAt)) {
                return { 
                    valid: false, 
                    reason: 'expired',
                    message: 'This link has expired. Please request a new one.',
                    entityId,
                    type: data.type
                };
            }
            
            // Update last access
            data.lastAccess = new Date().toISOString();
            save();
            
            return {
                valid: true,
                entityId,
                type: data.type,
                email: data.email,
                data
            };
        }
    }
    
    return { 
        valid: false, 
        reason: 'invalid',
        message: 'Invalid link. Please check the URL and try again.'
    };
}

// ============================================
// JUDGE ASSIGNMENT MANAGEMENT
// ============================================

// Sync judge assignments with rounds
function syncJudgeAssignments(judgeId) {
    const assignments = [];
    
    // Find all rounds where this judge is assigned
    (state.rounds || []).forEach(round => {
        (round.debates || []).forEach((debate, idx) => {
            const panelMember = (debate.panel || []).find(p => p.id === judgeId);
            if (panelMember) {
                const gov = state.teams.find(t => t.id === debate.gov);
                const opp = state.teams.find(t => t.id === debate.opp);
                
                assignments.push({
                    roundId: round.id,
                    roundName: `Round ${round.id}`,
                    room: round.rooms?.[idx] || `Room ${String.fromCharCode(65 + idx)}`,
                    debateIdx: idx,
                    govTeam: gov?.name || 'Unknown',
                    oppTeam: opp?.name || 'Unknown',
                    govCode: gov?.code || '',
                    oppCode: opp?.code || '',
                    role: panelMember.role,
                    motion: round.motion || 'TBD',
                    blinded: round.blinded || false,
                    entered: debate.entered || false,
                    results: debate.entered ? (panelMember.role === 'chair' ? debate : null) : null,
                    url: window.location.origin + window.location.pathname + `?room=${round.id}_${idx}`
                });
            }
        });
    });
    
    // Update state
    if (state.dynamicURLs?.[judgeId]) {
        state.dynamicURLs[judgeId].currentAssignments = assignments;
        save();
    }
    
    return assignments;
}

// Get current assignments for a judge
function getJudgeAssignments(judgeId) {
    if (!state.dynamicURLs?.[judgeId]) return [];
    return state.dynamicURLs[judgeId].currentAssignments || [];
}

// ============================================
// TEAM ASSIGNMENT MANAGEMENT
// ============================================

// Sync team assignments with rounds
function syncTeamAssignments(teamId) {
    const assignments = [];
    
    // Find all rounds where this team is debating
    (state.rounds || []).forEach(round => {
        (round.debates || []).forEach((debate, idx) => {
            let side = null;
            let teamResults = null;
            let opponentResults = null;
            
            if (debate.gov === teamId) {
                side = 'Government';
                teamResults = debate.govResults;
                opponentResults = debate.oppResults;
            } else if (debate.opp === teamId) {
                side = 'Opposition';
                teamResults = debate.oppResults;
                opponentResults = debate.govResults;
            }
            
            if (side) {
                const opponent = state.teams.find(t => t.id === (side === 'Government' ? debate.opp : debate.gov));
                const opponentName = opponent?.name || 'Unknown';
                const opponentCode = opponent?.code || '';
                
                // Get team's speakers for this round
                const teamObj = state.teams.find(t => t.id === teamId);
                const speakers = teamObj?.speakers || [];
                
                // Find which speakers spoke in this round
                const roundSpeakers = [];
                if (teamResults?.substantive) {
                    teamResults.substantive.forEach(s => {
                        roundSpeakers.push({
                            name: s.speaker,
                            score: s.score,
                            type: 'substantive'
                        });
                    });
                }
                if (teamResults?.reply) {
                    roundSpeakers.push({
                        name: teamResults.reply.speaker,
                        score: teamResults.reply.score,
                        type: 'reply'
                    });
                }
                
                assignments.push({
                    roundId: round.id,
                    roundName: `Round ${round.id}`,
                    room: round.rooms?.[idx] || `Room ${String.fromCharCode(65 + idx)}`,
                    debateIdx: idx,
                    side: side,
                    opponent: opponentName,
                    opponentCode: opponentCode,
                    motion: round.motion || 'TBD',
                    blinded: round.blinded || false,
                    entered: debate.entered || false,
                    teamTotal: teamResults?.total || 0,
                    opponentTotal: opponentResults?.total || 0,
                    speakers: roundSpeakers,
                    isWinner: teamResults?.total > opponentResults?.total,
                    url: window.location.origin + window.location.pathname + `?room=${round.id}_${idx}`
                });
            }
        });
    });
    
    // Update state
    if (state.dynamicURLs?.[teamId]) {
        state.dynamicURLs[teamId].currentAssignments = assignments;
        save();
    }
    
    return assignments;
}

// Get current assignments for a team
function getTeamAssignments(teamId) {
    if (!state.dynamicURLs?.[teamId]) return [];
    return state.dynamicURLs[teamId].currentAssignments || [];
}

// ============================================
// EMAIL INTEGRATION
// ============================================

// Generate email content for judge
function generateJudgeEmail(judgeId, judgeName) {
    const assignments = getJudgeAssignments(judgeId);
    const judgeData = state.dynamicURLs?.[judgeId];
    
    if (!judgeData) return null;
    
    let subject = `Your Judge Assignments - Debate Tournament`;
    let body = `Hello ${judgeName},\n\n`;
    body += `Here are your current judging assignments:\n\n`;
    body += `Your personal judge portal: ${judgeData.url}\n\n`;
    body += `This link expires on: ${new Date(judgeData.expiresAt).toLocaleDateString()}\n\n`;
    
    if (assignments.length === 0) {
        body += `You have no current judging assignments.\n`;
    } else {
        body += `CURRENT ASSIGNMENTS:\n`;
        body += `===================\n\n`;
        
        assignments.forEach((a, i) => {
            body += `${i+1}. ${a.roundName} - ${a.room}\n`;
            body += `   Role: ${a.role?.toUpperCase() || 'Judge'}\n`;
            body += `   Debate: ${a.govTeam} (${a.govCode}) vs ${a.oppTeam} (${a.oppCode})\n`;
            body += `   Motion: "${a.motion}"\n`;
            body += `   Status: ${a.entered ? '✅ Results Entered' : '⏳ Pending'}\n`;
            if (!a.entered && !a.blinded) {
                body += `   Submit results: ${a.url}\n`;
            } else if (a.blinded) {
                body += `   🔒 Round is blinded\n`;
            }
            body += `\n`;
        });
    }
    
    body += `\n---\n`;
    body += `This link will always show your current assignments. `;
    body += `Bookmark it for easy access throughout the tournament.\n`;
    body += `If this link expires, contact the tournament administrator for a new one.\n`;
    
    return { subject, body };
}

// Generate email content for team
function generateTeamEmail(teamId, teamName) {
    const assignments = getTeamAssignments(teamId);
    const teamData = state.dynamicURLs?.[teamId];
    
    if (!teamData) return null;
    
    let subject = `Your Team Debate Assignments - Debate Tournament`;
    let body = `Hello ${teamName} Team,\n\n`;
    body += `Here are your upcoming debates:\n\n`;
    body += `Your team portal: ${teamData.url}\n\n`;
    body += `This link expires on: ${new Date(teamData.expiresAt).toLocaleDateString()}\n\n`;
    
    if (assignments.length === 0) {
        body += `You have no scheduled debates yet.\n`;
    } else {
        body += `UPCOMING DEBATES:\n`;
        body += `================\n\n`;
        
        assignments.forEach((a, i) => {
            body += `${i+1}. ${a.roundName} - ${a.room}\n`;
            body += `   Side: ${a.side}\n`;
            body += `   Opponent: ${a.opponent} (${a.opponentCode})\n`;
            body += `   Motion: "${a.motion}"\n`;
            body += `   Status: ${a.entered ? '✅ Results Posted' : '⏳ Upcoming'}\n`;
            
            if (a.entered) {
                body += `   Your score: ${a.teamTotal.toFixed(1)}\n`;
                body += `   Result: ${a.isWinner ? '🏆 WIN' : '📉 Loss'}\n`;
                if (a.speakers.length > 0) {
                    body += `   Speakers:\n`;
                    a.speakers.forEach(s => {
                        body += `     - ${s.name}: ${s.score.toFixed(1)} (${s.type})\n`;
                    });
                }
            }
            body += `\n`;
        });
    }
    
    body += `\n---\n`;
    body += `This link will always show your current debate schedule. `;
    body += `Bookmark it for easy access.\n`;
    body += `If this link expires, contact the tournament administrator for a new one.\n`;
    
    return { subject, body };
}

// Get mailto link for judge — pre-fills recipient if email is stored
function getJudgeMailtoLink(judgeId, judgeName) {
    const emailData = generateJudgeEmail(judgeId, judgeName);
    if (!emailData) return '#';
    
    // Prefer email on the URL record, fall back to judge.email
    const judge = state.judges?.find(j => j.id === judgeId);
    const recipientEmail = state.dynamicURLs?.[judgeId]?.email || judge?.email || '';
    const toField = recipientEmail ? encodeURIComponent(recipientEmail) : '';
    
    return `mailto:${toField}?subject=${encodeURIComponent(emailData.subject)}&body=${encodeURIComponent(emailData.body)}`;
}

// Get mailto link for team — pre-fills recipient if email is stored
function getTeamMailtoLink(teamId, teamName) {
    const emailData = generateTeamEmail(teamId, teamName);
    if (!emailData) return '#';
    
    // Prefer email on the URL record, fall back to team.email
    const team = state.teams?.find(t => t.id === teamId);
    const recipientEmail = state.dynamicURLs?.[teamId]?.email || team?.email || '';
    const toField = recipientEmail ? encodeURIComponent(recipientEmail) : '';
    
    return `mailto:${toField}?subject=${encodeURIComponent(emailData.subject)}&body=${encodeURIComponent(emailData.body)}`;
}

// ============================================
// ERROR HANDLING UI
// ============================================

// Show error modal for invalid/expired URLs
function showURLErrorModal(error) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal" style="max-width: 400px; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 20px;">
                ${error.reason === 'expired' ? '⌛' : '❌'}
            </div>
            <h2 style="color: ${error.reason === 'expired' ? '#f59e0b' : '#dc2626'}; margin-bottom: 15px;">
                ${error.reason === 'expired' ? 'Link Expired' : 'Invalid Link'}
            </h2>
            <p style="color: #64748b; margin-bottom: 25px; line-height: 1.6;">
                ${error.message}
            </p>
            ${error.reason === 'expired' ? `
                <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left;">
                    <p style="margin: 0 0 5px; color: #92400e;"><strong>What to do:</strong></p>
                    <p style="margin: 0; color: #92400e; font-size: 14px;">
                        1. Contact the tournament administrator<br>
                        2. Request a new link for ${error.type === 'judge' ? 'your judging' : 'your team'} account<br>
                        3. They will generate a fresh URL for you
                    </p>
                </div>
            ` : `
                <div style="background: #fee2e2; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left;">
                    <p style="margin: 0 0 5px; color: #991b1b;"><strong>Possible reasons:</strong></p>
                    <p style="margin: 0; color: #991b1b; font-size: 14px;">
                        • The URL was typed incorrectly<br>
                        • The link was for a different tournament<br>
                        • The link has been deactivated
                    </p>
                </div>
            `}
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button onclick="window.location.href = window.location.pathname" class="primary">
                    🏠 Go to Homepage
                </button>
                <button onclick="this.closest('.modal-overlay').remove()" class="secondary">
                    Close
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ============================================
// URL PARAMETER HANDLING
// ============================================

// Check URL for tokens on page load
export function checkURLForTokens() {
    const urlParams = new URLSearchParams(window.location.search);
    const judgeToken = urlParams.get('judge');
    const teamToken = urlParams.get('team');
    const roomParam = urlParams.get('room');
    
    if (judgeToken) {
        return handleJudgeToken(judgeToken);
    } else if (teamToken) {
        return handleTeamToken(teamToken);
    } else if (roomParam) {
        return handleRoomParam(roomParam);
    }
    
    return null;
}

// Handle judge token with error handling
function handleJudgeToken(token) {
    const validation = validateToken(token);
    
    if (!validation.valid) {
        showURLErrorModal(validation);
        return null;
    }
    
    const judge = state.judges.find(j => j.id === validation.entityId);
    if (!judge) {
        showURLErrorModal({
            valid: false,
            reason: 'invalid',
            message: 'Judge account not found. Please contact the tournament administrator.'
        });
        return null;
    }
    
    // Sync latest assignments
    const assignments = syncJudgeAssignments(validation.entityId);
    
    return {
        type: 'judge',
        entity: judge,
        assignments,
        token: validation.data
    };
}

// Handle team token with error handling
function handleTeamToken(token) {
    const validation = validateToken(token);
    
    if (!validation.valid) {
        showURLErrorModal(validation);
        return null;
    }
    
    const team = state.teams.find(t => t.id === validation.entityId);
    if (!team) {
        showURLErrorModal({
            valid: false,
            reason: 'invalid',
            message: 'Team account not found. Please contact the tournament administrator.'
        });
        return null;
    }
    
    // Sync latest assignments
    const assignments = syncTeamAssignments(validation.entityId);
    
    return {
        type: 'team',
        entity: team,
        assignments,
        token: validation.data
    };
}

// Handle room parameter
function handleRoomParam(roomParam) {
    const [roundId, debateIdx] = roomParam.split('_').map(Number);
    const round = state.rounds?.find(r => r.id === roundId);
    
    if (!round) {
        showURLErrorModal({
            valid: false,
            reason: 'invalid',
            message: 'Room not found. The round may have been deleted.'
        });
        return null;
    }
    
    if (!round.debates[debateIdx]) {
        showURLErrorModal({
            valid: false,
            reason: 'invalid',
            message: 'Debate not found in this round.'
        });
        return null;
    }
    
    return {
        type: 'room',
        round,
        debate: round.debates[debateIdx],
        debateIdx,
        roomName: round.rooms?.[debateIdx] || `Room ${String.fromCharCode(65 + debateIdx)}`
    };
}

// ============================================
// FEEDBACK PORTAL UI
// ============================================

// Show judge portal
function showJudgePortal(judgeData) {
    const { entity: judge, assignments } = judgeData;
    const urlData = state.dynamicURLs[judge.id];
    const daysLeft = urlData ? Math.ceil((new Date(urlData.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)) : 30;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal xl" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; position: sticky; top: 0; background: white; padding: 10px 0;">
                <h2 style="margin: 0; color: #0a3b5c;">
                    ⚖️ Judge Portal - ${escapeHTML(judge.name)}
                </h2>
                <button onclick="this.closest('.modal-overlay').remove()" class="secondary">✖ Close</button>
            </div>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                    <div>
                        <h3 style="margin: 0 0 8px;">Your Personal Judge Portal</h3>
                        <p style="margin: 0; color: #64748b; font-size: 14px;">
                            Bookmark this link - it always shows your current judging assignments
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button onclick="window.copyToClipboard('${urlData.url}')" class="secondary">
                            📋 Copy Link
                        </button>
                        <button onclick="window.emailJudgeAssignments('${judge.id}', '${escapeHTML(judge.name)}')" class="primary">
                            📧 Email Assignments
                        </button>
                    </div>
                </div>
                <div style="background: white; padding: 12px; border-radius: 8px; margin-top: 15px; font-family: monospace; word-break: break-all; font-size: 12px;">
                    ${urlData.url}
                </div>
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #64748b;">
                        Created: ${new Date(urlData.createdAt).toLocaleDateString()}
                    </span>
                    <span style="font-size: 12px; color: ${daysLeft < 7 ? '#f59e0b' : '#10b981'};">
                        ${daysLeft < 7 ? '⚠️' : '✓'} Expires in ${daysLeft} days
                    </span>
                </div>
            </div>
            
            <h3>Your Judging Assignments</h3>
            ${renderJudgeAssignments(assignments)}
            
            <div style="margin-top: 20px; text-align: right;">
                <button onclick="this.closest('.modal-overlay').remove()" class="primary">Done</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Show team portal
function showTeamPortal(teamData) {
    const { entity: team, assignments } = teamData;
    const urlData = state.dynamicURLs[team.id];
    const daysLeft = urlData ? Math.ceil((new Date(urlData.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)) : 30;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal xl" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; position: sticky; top: 0; background: white; padding: 10px 0;">
                <h2 style="margin: 0; color: #0a3b5c;">
                    👥 Team Portal - ${escapeHTML(team.name)}
                </h2>
                <button onclick="this.closest('.modal-overlay').remove()" class="secondary">✖ Close</button>
            </div>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                    <div>
                        <h3 style="margin: 0 0 8px;">Your Team Portal</h3>
                        <p style="margin: 0; color: #64748b; font-size: 14px;">
                            Bookmark this link - it always shows your current debate schedule
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button onclick="window.copyToClipboard('${urlData.url}')" class="secondary">
                            📋 Copy Link
                        </button>
                        <button onclick="window.emailTeamAssignments('${team.id}', '${escapeHTML(team.name)}')" class="primary">
                            📧 Email Schedule
                        </button>
                    </div>
                </div>
                <div style="background: white; padding: 12px; border-radius: 8px; margin-top: 15px; font-family: monospace; word-break: break-all; font-size: 12px;">
                    ${urlData.url}
                </div>
                <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #64748b;">
                        Created: ${new Date(urlData.createdAt).toLocaleDateString()}
                    </span>
                    <span style="font-size: 12px; color: ${daysLeft < 7 ? '#f59e0b' : '#10b981'};">
                        ${daysLeft < 7 ? '⚠️' : '✓'} Expires in ${daysLeft} days
                    </span>
                </div>
            </div>
            
            <h3>Your Debates</h3>
            ${renderTeamAssignments(assignments)}
            
            <div style="margin-top: 20px; text-align: right;">
                <button onclick="this.closest('.modal-overlay').remove()" class="primary">Done</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Render judge assignments
function renderJudgeAssignments(assignments) {
    if (assignments.length === 0) {
        return `
            <div style="text-align: center; padding: 40px; background: #f8fafc; border-radius: 12px;">
                <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
                <h3>No Current Judging Assignments</h3>
                <p style="color: #64748b;">You'll see your assignments here once you're assigned to debates</p>
            </div>
        `;
    }
    
    return `
        <div style="display: grid; gap: 15px; max-height: 400px; overflow-y: auto; padding: 5px;">
            ${assignments.map(a => `
                <div style="background: ${a.entered ? '#f0fdf4' : '#fff7ed'}; padding: 20px; border-radius: 12px; border-left: 4px solid ${a.entered ? '#10b981' : '#f59e0b'};">
                    <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                <h4 style="margin: 0;">${a.roundName} - ${a.room}</h4>
                                <span style="background: ${a.role === 'chair' ? '#3b82f6' : '#64748b'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
                                    ${a.role?.toUpperCase()}
                                </span>
                                ${a.blinded ? '<span style="background: #64748b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">🔒 BLINDED</span>' : ''}
                            </div>
                            <p style="margin: 4px 0;"><strong>Debate:</strong> ${a.govTeam} vs ${a.oppTeam}</p>
                            <p style="margin: 4px 0;"><strong>Motion:</strong> "${a.motion}"</p>
                        </div>
                        <div style="text-align: right; min-width: 120px;">
                            <span style="background: ${a.entered ? '#10b981' : '#f59e0b'}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; display: inline-block;">
                                ${a.entered ? '✅ Completed' : '⏳ Pending'}
                            </span>
                            ${!a.entered && !a.blinded ? `
                                <div style="margin-top: 10px;">
                                    <a href="${a.url}" target="_blank" class="primary" style="display: inline-block; padding: 6px 12px; background: #1a73e8; color: white; text-decoration: none; border-radius: 6px; font-size: 12px;">
                                        Enter Results
                                    </a>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Render team assignments
function renderTeamAssignments(assignments) {
    if (assignments.length === 0) {
        return `
            <div style="text-align: center; padding: 40px; background: #f8fafc; border-radius: 12px;">
                <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
                <h3>No Scheduled Debates</h3>
                <p style="color: #64748b;">Your debate schedule will appear here once rounds are created</p>
            </div>
        `;
    }
    
    return `
        <div style="display: grid; gap: 15px; max-height: 400px; overflow-y: auto; padding: 5px;">
            ${assignments.map(a => `
                <div style="background: ${a.entered ? '#f0fdf4' : '#fff7ed'}; padding: 20px; border-radius: 12px; border-left: 4px solid ${a.entered ? '#10b981' : '#f59e0b'};">
                    <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                <h4 style="margin: 0;">${a.roundName} - ${a.room}</h4>
                                <span style="background: ${a.side === 'Government' ? '#1e40af' : '#be185d'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
                                    ${a.side}
                                </span>
                                ${a.blinded ? '<span style="background: #64748b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px;">🔒 BLINDED</span>' : ''}
                            </div>
                            <p style="margin: 4px 0;"><strong>Opponent:</strong> ${a.opponent} (${a.opponentCode})</p>
                            <p style="margin: 4px 0;"><strong>Motion:</strong> "${a.motion}"</p>
                            
                            ${a.entered ? `
                                <div style="margin-top: 10px; padding: 10px; background: white; border-radius: 8px;">
                                    <p style="margin: 4px 0;"><strong>Your Score:</strong> ${a.teamTotal.toFixed(1)}</p>
                                    <p style="margin: 4px 0;"><strong>Result:</strong> ${a.isWinner ? '🏆 WIN' : '📉 Loss'}</p>
                                    ${a.speakers.length > 0 ? `
                                        <p style="margin: 8px 0 4px;"><strong>Speakers:</strong></p>
                                        <ul style="margin: 0; padding-left: 20px;">
                                            ${a.speakers.map(s => `<li>${s.name}: ${s.score.toFixed(1)} (${s.type})</li>`).join('')}
                                        </ul>
                                    ` : ''}
                                </div>
                            ` : ''}
                        </div>
                        <div style="text-align: right; min-width: 120px;">
                            <span style="background: ${a.entered ? '#10b981' : '#f59e0b'}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; display: inline-block;">
                                ${a.entered ? '✅ Results Posted' : '⏳ Upcoming'}
                            </span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Copy to clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Copied to clipboard!', 'success');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showNotification('Copied to clipboard!', 'success');
    });
}

// Email judge assignments
function emailJudgeAssignments(judgeId, judgeName) {
    const mailtoLink = getJudgeMailtoLink(judgeId, judgeName);
    if (mailtoLink !== '#') {
        window.location.href = mailtoLink;
    } else {
        showNotification('Could not generate email', 'error');
    }
}

// Email team assignments
function emailTeamAssignments(teamId, teamName) {
    const mailtoLink = getTeamMailtoLink(teamId, teamName);
    if (mailtoLink !== '#') {
        window.location.href = mailtoLink;
    } else {
        showNotification('Could not generate email', 'error');
    }
}

// Initialize URL checking on page load
function initURLFeedbackSystem() {
    const result = checkURLForTokens();
    if (result) {
        setTimeout(() => {
            if (result.type === 'judge') {
                showJudgePortal(result);
            } else if (result.type === 'team') {
                showTeamPortal(result);
            } else if (result.type === 'room') {
                // Handle room URL - could open results entry
                console.log('Room access:', result);
                // You can add room result entry modal here
            }
        }, 500);
    }
}

// Sync all judge assignments (call after round changes)
function syncAllJudgeAssignments() {
    if (!state.dynamicURLs) return;
    
    Object.keys(state.dynamicURLs).forEach(entityId => {
        if (state.dynamicURLs[entityId].type === 'judge') {
            syncJudgeAssignments(entityId);
        }
    });
}

// Sync all team assignments (call after round changes)
function syncAllTeamAssignments() {
    if (!state.dynamicURLs) return;
    
    Object.keys(state.dynamicURLs).forEach(entityId => {
        if (state.dynamicURLs[entityId].type === 'team') {
            syncTeamAssignments(entityId);
        }
    });
}

// ============================================
// SEND URL TO EMAIL
// (with inline prompt if no email is saved)
// ============================================

// Send a judge's private URL to their email. If no email is stored, prompt for one first.
function sendJudgeURL(judgeId) {
    if (!state.dynamicURLs?.[judgeId]) {
        showNotification('Generate a URL for this judge first', 'error');
        return;
    }
    const judge = state.judges?.find(j => j.id === judgeId);
    if (!judge) return;

    const storedEmail = state.dynamicURLs[judgeId].email || judge.email || '';

    if (storedEmail) {
        // Sync email to both locations then fire mailto
        state.dynamicURLs[judgeId].email = storedEmail;
        judge.email = storedEmail;
        _openMailto(getJudgeMailtoLink(judgeId, judge.name));
    } else {
        showEmailPromptModal({
            title: `Send URL to ${judge.name}`,
            onConfirm(enteredEmail) {
                state.dynamicURLs[judgeId].email = enteredEmail;
                judge.email = enteredEmail;
                save();
                _openMailto(getJudgeMailtoLink(judgeId, judge.name));
            }
        });
    }
}

// Send a team's private URL to their email. If no email is stored, prompt for one first.
function sendTeamURL(teamId) {
    if (!state.dynamicURLs?.[teamId]) {
        showNotification('Generate a URL for this team first', 'error');
        return;
    }
    const team = state.teams?.find(t => t.id === teamId);
    if (!team) return;

    const storedEmail = state.dynamicURLs[teamId].email || team.email || '';

    if (storedEmail) {
        state.dynamicURLs[teamId].email = storedEmail;
        team.email = storedEmail;
        _openMailto(getTeamMailtoLink(teamId, team.name));
    } else {
        showEmailPromptModal({
            title: `Send URL to ${team.name}`,
            onConfirm(enteredEmail) {
                state.dynamicURLs[teamId].email = enteredEmail;
                team.email = enteredEmail;
                save();
                _openMailto(getTeamMailtoLink(teamId, team.name));
            }
        });
    }
}

// Modal that asks for an email address when none is stored, then calls onConfirm(email)
function showEmailPromptModal({ title, onConfirm }) {
    document.querySelector('.email-prompt-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'email-prompt-overlay';
    overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:rgba(0,0,0,0.55)', 'display:flex', 'align-items:center',
        'justify-content:center', 'z-index:10000', 'padding:20px'
    ].join(';');

    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:32px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="text-align:center;font-size:40px;margin-bottom:12px;">📧</div>
            <h3 style="margin:0 0 6px;color:#1e293b;text-align:center;">${escapeHTML(title)}</h3>
            <p style="margin:0 0 20px;color:#64748b;font-size:14px;text-align:center;">
                No email address is saved for this entry.<br>
                Enter one below — it will be saved for future use.
            </p>
            <input type="email" id="email-prompt-input"
                   placeholder="email@example.com"
                   style="width:100%;padding:12px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:15px;box-sizing:border-box;margin-bottom:6px;">
            <div id="email-prompt-error" style="color:#dc2626;font-size:13px;min-height:18px;margin-bottom:14px;"></div>
            <div style="display:flex;gap:10px;">
                <button id="epm-cancel"
                        style="flex:1;padding:11px;border-radius:8px;border:1px solid #e2e8f0;background:white;color:#475569;font-size:14px;font-weight:600;cursor:pointer;">
                    Cancel
                </button>
                <button id="epm-confirm"
                        style="flex:2;padding:11px;border-radius:8px;border:none;background:#10b981;color:white;font-size:14px;font-weight:600;cursor:pointer;">
                    Save &amp; Send
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const input  = overlay.querySelector('#email-prompt-input');
    const errDiv = overlay.querySelector('#email-prompt-error');

    overlay.querySelector('#epm-cancel').onclick  = () => overlay.remove();
    overlay.querySelector('#epm-confirm').onclick = () => {
        const val = input.value.trim().toLowerCase();
        if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
            errDiv.textContent = 'Please enter a valid email address.';
            input.focus();
            return;
        }
        overlay.remove();
        onConfirm(val);
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  overlay.querySelector('#epm-confirm').click();
        if (e.key === 'Escape') overlay.remove();
    });

    setTimeout(() => input.focus(), 40);
}

// ============================================
// BULK URL GENERATION & SENDING
// ============================================

// Generate URLs for all judges that don't yet have one, then show bulk send panel
export function generateAllJudgeURLs() {
    if (!state.judges?.length) {
        showNotification('No judges to generate URLs for', 'error');
        return;
    }
    if (!state.dynamicURLs) state.dynamicURLs = {};

    let created = 0, existing = 0;
    state.judges.forEach(judge => {
        if (!state.dynamicURLs[judge.id]) {
            createJudgeURL(judge.id, judge.email || '');
            created++;
        } else {
            existing++;
        }
    });

    save();
    showNotification(
        `✅ ${created} URL${created !== 1 ? 's' : ''} generated${existing ? ` (${existing} already existed)` : ''}`,
        'success'
    );
    showBulkSendPanel('judge');
}

// Generate URLs for all teams that don't yet have one, then show bulk send panel
function generateAllTeamURLs() {
    if (!state.teams?.length) {
        showNotification('No teams to generate URLs for', 'error');
        return;
    }
    if (!state.dynamicURLs) state.dynamicURLs = {};

    let created = 0, existing = 0;
    state.teams.forEach(team => {
        if (!state.dynamicURLs[team.id]) {
            createTeamURL(team.id, team.email || '');
            created++;
        } else {
            existing++;
        }
    });

    save();
    showNotification(
        `✅ ${created} URL${created !== 1 ? 's' : ''} generated${existing ? ` (${existing} already existed)` : ''}`,
        'success'
    );
    showBulkSendPanel('team');
}

// Show a panel listing all judges or teams with their URL and email status,
// individual Send buttons, and a "Send All" button for those with emails ready
function showBulkSendPanel(entityType) {
    document.querySelector('.bulk-send-overlay')?.remove();

    const isJudge  = entityType === 'judge';
    const entities = isJudge ? (state.judges || []) : (state.teams || []);
    const label    = isJudge ? 'Judge' : 'Team';

    // Count how many have both a URL and an email
    const readyToSend = entities.filter(e => {
        const rec   = state.dynamicURLs?.[e.id];
        const email = rec?.email || e.email || '';
        return !!rec && !!email;
    });

    const rows = entities.map(entity => {
        const rec     = state.dynamicURLs?.[entity.id];
        const email   = rec?.email || entity.email || '';
        const hasURL  = !!rec;
        const sendFn  = isJudge
            ? `window.sendJudgeURL('${entity.id}')`
            : `window.sendTeamURL('${entity.id}')`;

        return `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f1f5f9;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${escapeHTML(entity.name)}
                    </div>
                    <div style="font-size:12px;color:${email ? '#10b981' : '#f59e0b'};">
                        ${email ? `📧 ${escapeHTML(email)}` : '⚠️ No email saved'}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                    <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;
                          background:${hasURL ? '#d1fae5' : '#fee2e2'};color:${hasURL ? '#065f46' : '#991b1b'};">
                        ${hasURL ? '✓ URL' : '✗ No URL'}
                    </span>
                    ${hasURL ? `
                        <button onclick="${sendFn}"
                                style="padding:6px 14px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
                            📧 Send
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'bulk-send-overlay';
    overlay.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:rgba(0,0,0,0.55)', 'display:flex', 'align-items:center',
        'justify-content:center', 'z-index:9999', 'padding:20px'
    ].join(';');

    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;max-width:560px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:24px 24px 16px;border-bottom:1px solid #e2e8f0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h2 style="margin:0 0 4px;color:#1e293b;">📧 Send Private URLs</h2>
                        <p style="margin:0;color:#64748b;font-size:14px;">
                            ${entities.length} ${label}${entities.length !== 1 ? 's' : ''}
                            · ${readyToSend.length} ready to send
                        </p>
                    </div>
                    <button onclick="this.closest('.bulk-send-overlay').remove()"
                            style="background:none;border:none;font-size:22px;cursor:pointer;color:#64748b;line-height:1;">✖</button>
                </div>
                ${readyToSend.length > 0 ? `
                    <button onclick="window.sendAllURLs('${entityType}')"
                            style="margin-top:14px;width:100%;padding:12px;background:#10b981;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
                        📨 Send All (${readyToSend.length} with email)
                    </button>
                ` : ''}
            </div>
            <div style="overflow-y:auto;padding:0 24px 8px;flex:1;">
                ${rows}
            </div>
            <div style="padding:16px 24px;border-top:1px solid #e2e8f0;text-align:right;">
                <button onclick="this.closest('.bulk-send-overlay').remove()" class="secondary" style="padding:10px 24px;">
                    Close
                </button>
            </div>
        </div>
    `;

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

// Open a mailto link without navigating away from the page
function _openMailto(href) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Open mail client for all entities that have both a URL and a stored email.
// For ≤ 10 recipients uses a single BCC mailto; for larger lists queues them sequentially.
function sendAllURLs(entityType) {
    const isJudge  = entityType === 'judge';
    const entities = isJudge ? (state.judges || []) : (state.teams || []);

    const ready = entities.filter(e => {
        const rec   = state.dynamicURLs?.[e.id];
        const email = rec?.email || e.email || '';
        return !!rec && !!email;
    });

    if (!ready.length) {
        showNotification('No entries with both a URL and an email address', 'error');
        return;
    }

    if (ready.length <= 10) {
        // Single mailto with BCC
        const emails = ready.map(e => state.dynamicURLs[e.id]?.email || e.email).filter(Boolean);
        const urlLines = ready.map(e => `${e.name}: ${state.dynamicURLs[e.id]?.url || ''}`).join('\n');
        const subject  = encodeURIComponent(
            isJudge ? 'Your Private Judging Portal — Debate Tournament'
                    : 'Your Team Portal — Debate Tournament'
        );
        const body = encodeURIComponent(
            `Hello,\n\nHere are your private portal links:\n\n${urlLines}\n\n` +
            `Bookmark your link — it always shows your current assignments.\n\nRegards,\nTournament Director`
        );
        _openMailto(`mailto:${encodeURIComponent(emails[0])}?bcc=${encodeURIComponent(emails.join(','))}&subject=${subject}&body=${body}`);
    } else {
        // Large list — open individually via window.open with a stagger
        showNotification(`Opening ${ready.length} email drafts…`, 'info');
        ready.forEach((e, i) => {
            setTimeout(() => {
                const mailtoHref = isJudge
                    ? getJudgeMailtoLink(e.id, e.name)
                    : getTeamMailtoLink(e.id, e.name);
                if (mailtoHref && mailtoHref !== '#') _openMailto(mailtoHref);
            }, i * 900);
        });
    }
}

// ============================================
// WINDOW REGISTRATIONS
// (called from inline onclick HTML attributes)
// ============================================
if (typeof window !== 'undefined') {
    window.sendJudgeURL          = sendJudgeURL;
    window.sendTeamURL           = sendTeamURL;
    window.generateAllJudgeURLs  = generateAllJudgeURLs;
    window.generateAllTeamURLs   = generateAllTeamURLs;
    window.showBulkSendPanel     = showBulkSendPanel;
    window.sendAllURLs           = sendAllURLs;
    window.copyToClipboard       = copyToClipboard;
    window.emailJudgeAssignments = emailJudgeAssignments;
    window.emailTeamAssignments  = emailTeamAssignments;
}

// ============================================
// EXPORT FUNCTIONS
// ============================================

export {
    // Judge functions
    createJudgeURL,  
    syncJudgeAssignments,
    getJudgeAssignments,
    generateJudgeEmail,
    getJudgeMailtoLink,
    showJudgePortal,
    emailJudgeAssignments,
    sendJudgeURL,
  

    // Team functions
    createTeamURL,
    generateTeamURL,
    syncTeamAssignments,
    getTeamAssignments,
    generateTeamEmail,
    getTeamMailtoLink,
    showTeamPortal,
    emailTeamAssignments,
    sendTeamURL,
    generateAllTeamURLs,

    // Shared / UI
    validateToken,

    initURLFeedbackSystem,
    copyToClipboard,
    syncAllJudgeAssignments,
    syncAllTeamAssignments,
    handleRoomParam,
    showURLErrorModal,
    showEmailPromptModal,
    showBulkSendPanel,
    sendAllURLs
};