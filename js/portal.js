// ============================================================
// PORTAL.JS — Judge / Team / Admin portals
// ============================================================

import { supabase }      from './supabase.js';
import { state }         from './state.js';
import { patchJudge }    from './state.js';
import { api }           from './api.js';
import { showNotification, escapeHTML } from './utils.js';
import { el, replaceChildren } from './ui/components.js';
import { registerActions }     from './router.js';
import { isValidTokenFormat }  from './auth-validation.js';

// ── Session helpers ───────────────────────────────────────────────────────────
const SESSION_KEY = 'portal_session';

function _saveSession(type, token, id) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ type, token, id })); } catch(_) { /* ignore unavailable sessionStorage */ }
}
function _loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch(_) { return null; }
}
function _clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch(_) { /* ignore unavailable sessionStorage */ }
}

// ── Token entry — detects ?judge= or ?team= on page load ─────────────────────
export async function checkUrlForJudgeToken() {
    const params      = new URLSearchParams(window.location.search);
    const judgeToken  = params.get('judge');
    const teamToken   = params.get('team');

    if (!judgeToken && !teamToken) return;

    const token = judgeToken || teamToken;
    const type  = judgeToken ? 'judge' : 'team';

    if (!isValidTokenFormat(token)) {
        showNotification('Invalid access link format.', 'error');
        _cleanUrl();
        return;
    }

    // Check if we already have a verified session for this exact token
    const session = _loadSession();
    if (session && session.token === token && session.type === type) {
        _cleanUrl();
        if (type === 'judge') {
            _resumeJudgeSession(token, session.id);
        } else {
            _resumeTeamSession(token, session.id);
        }
        return;
    }

    // No session — show email gate
    _cleanUrl();
    window.switchTab?.('portal');
    const container = document.getElementById('portal-container');
    if (container) _renderEmailGate(container, type, token);
}

function _cleanUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('judge');
    url.searchParams.delete('team');
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.pathname + (url.search === '?' ? '' : url.search));
}

// ── Email gate ────────────────────────────────────────────────────────────────
function _renderEmailGate(container, type, token) {
    const label = type === 'judge' ? 'Judge Portal' : 'Team Portal';
    container.innerHTML = `
    <div style="max-width:420px;margin:60px auto;padding:0 16px;">
      <div style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:36px 32px;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:12px;">${type === 'judge' ? '⚖️' : '🏫'}</div>
        <h2 style="margin:0 0 8px;font-size:1.4rem;">${escapeHTML(label)}</h2>
        <p style="color:#666;margin:0 0 24px;font-size:.95rem;">Enter the email address associated with your registration to access your portal.</p>
        <div id="portal-gate-err" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:.9rem;"></div>
        <input id="portal-gate-email" type="email" placeholder="your@email.com"
               style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #d1d5db;border-radius:10px;font-size:1rem;margin-bottom:14px;outline:none;"
               onkeydown="if(event.key==='Enter')window._portalGateSubmit()">
        <button onclick="window._portalGateSubmit()"
                style="width:100%;padding:12px;background:#1a73e8;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;">
          Access Portal
        </button>
        <p style="color:#9ca3af;font-size:.8rem;margin:16px 0 0;">Your email is only used to verify your identity. It is never stored by this page.</p>
      </div>
    </div>`;

    window._portalGateSubmit = async function() {
        const emailEl = document.getElementById('portal-gate-email');
        const errEl   = document.getElementById('portal-gate-err');
        const email   = emailEl?.value?.trim();
        if (!email) { _showGateErr(errEl, 'Please enter your email address.'); return; }

        const btn = container.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Verifying…';

        try {
            let result;
            if (type === 'judge') {
                result = await api.validateJudgeToken(token, email);
            } else {
                result = await api.validateTeamToken(token, email);
            }

            if (!result?.valid) {
                const msgs = {
                    not_found:      'This access link was not recognised.',
                    revoked:        'This access link has been revoked. Contact the admin.',
                    expired:        'This access link has expired. Contact the admin.',
                    email_required: 'An email address is required to access this portal.',
                    email_mismatch: 'That email address does not match our records. Please use the email you registered with.',
                };
                _showGateErr(errEl, msgs[result?.reason] || 'Access denied.');
                btn.disabled = false;
                btn.textContent = 'Access Portal';
                return;
            }

            if (type === 'judge') {
                _saveSession('judge', token, result.judge?.id);
                renderJudgePortalFromToken(result.judge, result.assignments, result.tournamentId);
            } else {
                _saveSession('team', token, result.team?.id);
                _renderTeamPortalFromToken(result.team, result.debates, result.tournamentId);
            }
        } catch (err) {
            _showGateErr(errEl, 'Could not verify. Check your connection and try again.');
            btn.disabled = false;
            btn.textContent = 'Access Portal';
        }
    };
}

function _showGateErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

async function _resumeJudgeSession(token, judgeId) {
    try {
        const result = await api.validateJudgeToken(token);
        if (!result?.valid) { _clearSession(); _renderLoginPrompt(document.getElementById('portal-container')); return; }
        renderJudgePortalFromToken(result.judge, result.assignments, result.tournamentId);
    } catch (_) {
        _clearSession();
    }
}

async function _resumeTeamSession(token, teamId) {
    try {
        const result = await api.validateTeamToken(token);
        if (!result?.valid) { _clearSession(); _renderLoginPrompt(document.getElementById('portal-container')); return; }
        _renderTeamPortalFromToken(result.team, result.debates, result.tournamentId);
    } catch (_) {
        _clearSession();
    }
}

// ── Team portal entry from token (data comes from Edge Function, not state) ───
function _renderTeamPortalFromToken(team, debates, tournamentId) {
    window.switchTab?.('portal');
    const container = document.getElementById('portal-container');
    if (!container) return;

    window._portalCtx = { teamId: team.id, tournamentId, fromToken: true };

    // Map Supabase debate rows → { debate, round, judges } tuples
    const participatedDebates = (debates || []).map(d => {
        const round  = d.rounds || {};
        const judges = (d.debate_judges || []).map(dj => ({
            id:   dj.judge_id,
            name: dj.judges?.name || 'Judge',
            role: dj.role || 'wing'
        }));
        return { debate: d, round, judges };
    });

    _renderTeamPortalContent(container, team, team.id, participatedDebates);
}

// ── Entry points ──────────────────────────────────────────────────────────────
export function renderJudgePortal() {
    const container = document.getElementById('portal-container');
    if (!container) return;

    const role = state.auth?.currentUser?.role;
    if (!state.auth?.isAuthenticated || !role) {
        _renderLoginPrompt(container);
        return;
    }
    if (role === 'admin') {
        _renderPortalUI(container, {
            id: state.auth.currentUser?.associatedId || state.auth.currentUser?.id || 'admin',
            name: state.auth.currentUser?.name || 'Admin',
            role: 'admin',
        }, _collectAllDebatesForPortal(), {});
        return;
    }
    if (role === 'team')  { _renderTeamPortalView(container);  return; }

    const myAssocId = state.auth.currentUser?.associatedId;
    const judge     = (state.judges || []).find(j => String(j.id) === String(myAssocId));
    const assignments = _collectJudgeAssignments(myAssocId);
    _renderPortalUI(container, judge || { name: state.auth.currentUser?.name || 'Judge' }, assignments, {});
}

export function renderJudgePortalFromToken(judge, assignments, tournamentId) {
    window.switchTab?.('portal');
    const container = document.getElementById('portal-container');
    if (!container) return;
    _renderPortalUI(container, judge, assignments || [], { fromToken: true, tournamentId });
}

function _collectJudgeAssignments(judgeId) {
    const result = [];
    for (const round of state.rounds || []) {
        for (let debateIdx = 0; debateIdx < (round.debates || []).length; debateIdx++) {
            const debate = round.debates[debateIdx];
            const panel = debate.panel || debate.debate_judges || [];
            const entry = panel.find(p => String(p.id || p.judge_id) === String(judgeId));
            if (entry) result.push({ ...debate, round, debateIdx, roomLabel: round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`, judgeRole: entry.role || 'wing' });
        }
    }
    return result;
}

function _collectAllDebatesForPortal() {
    const result = [];
    for (const round of state.rounds || []) {
        for (let debateIdx = 0; debateIdx < (round.debates || []).length; debateIdx++) {
            const debate = round.debates[debateIdx];
            result.push({ ...debate, round, debateIdx, roomLabel: round.rooms?.[debateIdx] || `Room ${debateIdx + 1}` });
        }
    }
    return result;
}

// ── Judge Portal ─────────────────────────────────────────────────────────────
function _renderPortalUI(container, judge, assignments, opts) {
    const portalJudgeId = judge.id || state.auth?.currentUser?.associatedId || null;
    const isAdminPortal = (judge.role || state.auth?.currentUser?.role) === 'admin';
    window._portalCtx = {
        ...(window._portalCtx || {}),
        judgeId: portalJudgeId,
        tournamentId: opts?.tournamentId || state.activeTournamentId,
    };

    const judgeMap = isAdminPortal
        ? new Map((state.judges || []).map(j => [String(j.id), j]))
        : new Map();
    for (const assignment of assignments || []) {
        for (const p of assignment.panel || assignment.debate_judges || []) {
            const id = p.id || p.judge_id;
            if (!id || String(id) === String(portalJudgeId)) continue;
            if (!judgeMap.has(String(id))) {
                const storedJudge = (state.judges || []).find(j => String(j.id) === String(id));
                judgeMap.set(String(id), {
                    id,
                    name: storedJudge?.name || p.name || p.judges?.name || `Judge ${id}`,
                    role: p.role || storedJudge?.role || '',
                });
            }
        }
    }

    const judgeOptions = [...judgeMap.values()]
        .filter(j => String(j.id) !== String(portalJudgeId))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map(j => `<option value="${j.id}">${escapeHTML(j.name || `Judge ${j.id}`)}${j.role ? ` (${escapeHTML(j.role)})` : ''}</option>`)
        .join('');

    const pendingCount = (assignments || []).filter(a => !a.entered).length;
    const ballotRows = (assignments || []).map(a => {
        const round = a.round || {};
        const roundNum = round.round_number || round.id || '?';
        const roomLabel = a.roomLabel || a.room || a.room_name || (Number.isInteger(a.debateIdx) ? `Room ${a.debateIdx + 1}` : 'Room');
        const motion = round.motion || a.motion || 'Motion TBD';
        const teams = a.format === 'bp'
            ? `${_teamName(a.og)} / ${_teamName(a.oo)} / ${_teamName(a.cg)} / ${_teamName(a.co)}`
            : `${_teamName(a.gov)} vs ${_teamName(a.opp)}`;

        return `
        <div class="portal-simple-row">
            <div class="portal-simple-row__main">
                <strong>Round ${escapeHTML(String(roundNum))} · ${escapeHTML(roomLabel)}</strong>
                <span>${escapeHTML(teams)}</span>
                <small>${escapeHTML(motion)}</small>
            </div>
            <button class="portal-primary-btn" onclick="window._openBallotForDebate('${a.id}')">
                ${a.entered ? 'Edit Ballot' : 'Submit Ballot'}
            </button>
        </div>`;
    }).join('');

    container.innerHTML = `
    <style>
    .portal-simple { display:grid;gap:18px;max-width:980px;margin:0 auto; }
    .portal-simple-head { display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:2px; }
    .portal-simple-title { margin:0;color:#0f172a;font-size:24px;font-weight:800;letter-spacing:0; }
    .portal-simple-sub { margin:4px 0 0;color:#64748b;font-size:14px;line-height:1.5; }
    .portal-simple-grid { display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr);gap:18px;align-items:start; }
    .portal-section { background:white;border-radius:12px;padding:22px;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(15,23,42,.05); }
    .portal-section h3 { margin:0 0 16px;color:#1e293b;font-size:17px;font-weight:800;border:0;padding:0; }
    .fb-label { display:block;font-weight:700;color:#374151;font-size:12px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em; }
    .agc-select,.fb-textarea { width:100%;box-sizing:border-box;padding:10px 11px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;background:white;font-family:inherit; }
    .fb-textarea { resize:vertical;min-height:112px;line-height:1.5; }
    .hsp-row { display:flex;gap:5px;flex-wrap:wrap;margin:6px 0; }
    .hsp-btn { min-width:44px;padding:6px 8px;border-radius:8px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:12px;font-weight:700;color:#64748b;transition:all .12s;white-space:nowrap; }
    .hsp-btn.active { border-color:#f59e0b;background:#fef9c3;color:#92400e; }
    .hsp-btn.selected { border-color:#d97706;background:#f59e0b;color:white;transform:translateY(-1px); }
    .portal-primary-btn { background:var(--t-brand,#f97316);color:white;border:0;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap; }
    .portal-primary-btn:hover { background:var(--t-brand-hover,#ea580c); }
    .portal-simple-row { display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid #f1f5f9; }
    .portal-simple-row:first-of-type { border-top:0;padding-top:0; }
    .portal-simple-row__main { min-width:0;display:flex;flex-direction:column;gap:2px; }
    .portal-simple-row__main strong { color:#0f172a;font-size:14px; }
    .portal-simple-row__main span { color:#334155;font-size:13px; }
    .portal-simple-row__main small { color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:560px; }
    .portal-empty-note { color:#64748b;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:16px;font-size:13px;line-height:1.5; }
    @media (max-width: 820px) {
        .portal-simple-grid { grid-template-columns:1fr; }
        .portal-simple-row { align-items:stretch;flex-direction:column; }
        .portal-primary-btn { width:100%; }
    }
    </style>

    <div class="portal-simple">
        <div class="portal-simple-head">
            <div>
                <h2 class="portal-simple-title">Judge Portal</h2>
                <p class="portal-simple-sub">${escapeHTML(judge.name || 'Judge')} · ${(judge.role || 'judge').toUpperCase()}</p>
            </div>
            <span style="background:#f1f5f9;color:#475569;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;">
                ${pendingCount} pending ballot${pendingCount === 1 ? '' : 's'}
            </span>
        </div>

        <div class="portal-simple-grid">
            <div class="portal-section">
                <h3>Feedback Submission</h3>
                ${judgeOptions ? `
                    <div style="margin-bottom:14px;">
                        <label class="fb-label">Judge</label>
                        <select class="agc-select" id="sfb-judge">
                            <option value="">Select judge</option>
                            ${judgeOptions}
                        </select>
                    </div>
                    <div style="margin-bottom:14px;">
                        <label class="fb-label">Agreeing With Call</label>
                        <select class="agc-select" id="sfb-agc">
                            <option value="">Select option</option>
                            <option value="yes">Yes, fully agreed</option>
                            <option value="mostly">Mostly agreed</option>
                            <option value="partially">Partially agreed</option>
                            <option value="no">Disagreed</option>
                            <option value="na">N/A</option>
                        </select>
                    </div>
                    <div style="margin-bottom:14px;">
                        <label class="fb-label">Rating</label>
                        <select class="agc-select" id="standalone-hsp_val">
                            <option value="0">Select rating</option>
                            <option value="5">5 - Excellent</option>
                            <option value="4">4 - Good</option>
                            <option value="3">3 - Fair</option>
                            <option value="2">2 - Poor</option>
                            <option value="1">1 - Very Poor</option>
                        </select>
                    </div>
                    <div style="margin-bottom:16px;">
                        <label class="fb-label">Comment</label>
                        <textarea class="fb-textarea" id="sfb-comment" placeholder="Add concise feedback on reasoning, clarity, chairing, or decision quality."></textarea>
                    </div>
                    <button class="portal-primary-btn" style="width:100%;" onclick="window._submitStandaloneFeedback()">Submit Feedback</button>
                ` : `<div class="portal-empty-note">No other judges are available for feedback yet.</div>`}
            </div>

            <div class="portal-section">
                <h3>Ballot Submit</h3>
                ${ballotRows || `<div class="portal-empty-note">No ballot assignments yet. When you are placed on a panel, your rooms will appear here.</div>`}
            </div>
        </div>
    </div>`;
    if (window.__orionLegacyPortalEnabled) {
    const checkedIn = judge.checked_in || false;
    const rcBg   = judge.role === 'chair' ? '#dcfce7' : '#dbeafe';
    const rcText = judge.role === 'chair' ? '#16a34a' : '#1d4ed8';

    // Compute received feedback
    const myId    = judge.id;
    const received = myId ? (state.feedback || []).filter(fb => String(fb.toJudgeId || fb.to_judge_id) === String(myId)) : [];
    const avgRaw  = received.length ? received.reduce((s, fb) => s + parseFloat(fb.rating || 0), 0) / received.length : null;
    const avgDisp = avgRaw !== null ? avgRaw.toFixed(1) : null;

    container.innerHTML = `
    <style>
    .portal-section { background:white;border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #f1f5f9; }
    .portal-assign-card { background:#f8fafc;border-radius:10px;padding:18px;margin-bottom:14px;border:1px solid #e2e8f0;transition:box-shadow .15s; }
    .portal-assign-card.done { border-left:4px solid #10b981; }
    .portal-assign-card.pending { border-left:4px solid #f59e0b; }
    .checkin-toggle { display:inline-flex;border-radius:30px;overflow:hidden;border:2px solid #e2e8f0; }
    .checkin-toggle button { padding:7px 18px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s; }
    .checkin-toggle .ci-off { background:white;color:#64748b; }
    .checkin-toggle .ci-on  { background:#10b981;color:white; }
    .hsp-row { display:flex;gap:4px;flex-wrap:wrap;margin:6px 0; }
    .hsp-btn { padding:5px 8px;border-radius:6px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:12px;font-weight:600;color:#64748b;transition:all .12s;white-space:nowrap; }
    .hsp-btn.active { border-color:#f59e0b;background:#fef9c3;color:#92400e; }
    .hsp-btn.selected { border-color:#d97706;background:#f59e0b;color:white;transform:scale(1.08); }
    .agc-select { width:100%;padding:9px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;background:white; }
    .fb-drawer { border-top:1px solid #e2e8f0;margin-top:14px;padding-top:14px;display:none; }
    .fb-drawer.open { display:block; }
    .fb-label { display:block;font-weight:600;color:#374151;font-size:13px;margin-bottom:6px; }
    .fb-textarea { width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box; }
    .portal-tab-bar { display:flex;gap:4px;margin-bottom:20px;background:#f1f5f9;border-radius:10px;padding:4px; }
    .portal-tab { flex:1;text-align:center;padding:9px;border-radius:8px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:#64748b;transition:all .15s; }
    .portal-tab.active { background:white;color:#1e293b;box-shadow:0 1px 4px rgba(0,0,0,.1); }
    .portal-pane { display:none; }
    .portal-pane.active { display:block; }
    .rating-bar-wrap { display:flex;align-items:center;gap:8px; }
    .rating-bar { flex:1;background:#e2e8f0;border-radius:4px;height:7px;overflow:hidden; }
    .rating-bar-fill { background:#f59e0b;height:100%;border-radius:4px; }
    </style>

    <!-- Header -->
    <div class="portal-section" style="background:linear-gradient(135deg,#1e40af 0%,#7c3aed 100%);color:white;border:none;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px;">
            <div>
                <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;">⚖️ ${escapeHTML(judge.name || 'Judge')}</h1>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <span style="background:rgba(255,255,255,.2);padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">
                        ${(judge.role || 'WING').toUpperCase()}
                    </span>
                    ${avgDisp ? `<span style="background:rgba(255,255,255,.15);padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">⭐ ${avgDisp} avg · ${received.length} review${received.length !== 1 ? 's' : ''}</span>` : ''}
                </div>
            </div>
            <!-- Check-in toggle -->
            <div style="text-align:right;">
                <div style="font-size:11px;font-weight:600;opacity:0.8;margin-bottom:6px;">CHECK-IN STATUS</div>
                <div class="checkin-toggle">
                    <button class="ci-off ${!checkedIn ? 'ci-on' : ''}"
                            id="ci-unavail-btn"
                            onclick="window._portalCheckIn(${myId}, false)"
                            style="${!checkedIn ? 'background:#ef4444;' : ''}">
                        ✗ Unavailable
                    </button>
                    <button class="ci-on ${checkedIn ? '' : ''}"
                            id="ci-avail-btn"
                            onclick="window._portalCheckIn(${myId}, true)"
                            style="${checkedIn ? 'background:#10b981;color:white;' : 'background:rgba(255,255,255,.15);color:rgba(255,255,255,.7);'}">
                        ✓ Checked In
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Tabs -->
    <div class="portal-tab-bar">
        <button class="portal-tab active" onclick="window._portalSwitchTab('assignments')" id="ptab-assignments">
            📋 My Assignments <span style="background:#e2e8f0;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;">${assignments.length}</span>
        </button>
        <button class="portal-tab" onclick="window._portalSwitchTab('feedback')" id="ptab-feedback">
            ✍️ Submit Feedback
        </button>
        <button class="portal-tab" onclick="window._portalSwitchTab('received')" id="ptab-received">
            📬 My Reviews <span style="background:#e2e8f0;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;">${received.length}</span>
        </button>
    </div>

    <!-- Assignments pane -->
    <div id="ppane-assignments" class="portal-pane active">
        ${assignments.length === 0 ? `
        <div class="portal-section" style="text-align:center;padding:50px 20px;">
            <div style="font-size:56px;margin-bottom:12px;">📭</div>
            <h3 style="margin:0 0 8px;color:#1e293b;">No Assignments Yet</h3>
            <p style="color:#64748b;margin:0;">Your debate assignments will appear here once the draw is released.</p>
        </div>` :
        assignments.map((a, idx) => _buildAssignmentCard(a, myId, idx, opts)).join('')
        }
    </div>

    <!-- Submit Feedback pane -->
    <div id="ppane-feedback" class="portal-pane">
        ${_buildStandaloneFeedbackForm(myId, judge.name)}
    </div>

    <!-- Received pane -->
    <div id="ppane-received" class="portal-pane">
        ${_buildReceivedFeedback(received)}
    </div>`;
    }
}

function _buildAssignmentCard(assignment, myId, idx, opts) {
    const round    = assignment.round || {};
    const roundNum = round.round_number || round.id || '?';
    const motion   = round.motion || assignment.motion || 'Motion TBD';
    const done     = assignment.entered || false;
    const bp       = assignment.format === 'bp';

    // Team names
    let teamsHtml = '';
    if (bp) {
        const og = _teamName(assignment.og), oo = _teamName(assignment.oo);
        const cg = _teamName(assignment.cg), co = _teamName(assignment.co);
        teamsHtml = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;">
            <div style="padding:8px;background:#eff6ff;border-radius:8px;font-size:12px;font-weight:600;"><span style="opacity:.6;font-size:10px;display:block;">OG</span>${escapeHTML(og)}</div>
            <div style="padding:8px;background:#fdf2f8;border-radius:8px;font-size:12px;font-weight:600;"><span style="opacity:.6;font-size:10px;display:block;">OO</span>${escapeHTML(oo)}</div>
            <div style="padding:8px;background:#f0fdf4;border-radius:8px;font-size:12px;font-weight:600;"><span style="opacity:.6;font-size:10px;display:block;">CG</span>${escapeHTML(cg)}</div>
            <div style="padding:8px;background:#fff7ed;border-radius:8px;font-size:12px;font-weight:600;"><span style="opacity:.6;font-size:10px;display:block;">CO</span>${escapeHTML(co)}</div>
        </div>`;
    } else {
        const gov = _teamName(assignment.gov), opp = _teamName(assignment.opp);
        teamsHtml = `
        <div style="display:flex;align-items:center;gap:10px;margin:12px 0;">
            <div style="flex:1;padding:9px;background:#eff6ff;border-radius:8px;font-size:13px;font-weight:600;">${escapeHTML(gov)} <span style="font-size:10px;color:#64748b;font-weight:400;">GOV</span></div>
            <div style="font-weight:700;color:#94a3b8;font-size:12px;">VS</div>
            <div style="flex:1;padding:9px;background:#fdf2f8;border-radius:8px;font-size:13px;font-weight:600;">${escapeHTML(opp)} <span style="font-size:10px;color:#64748b;font-weight:400;">OPP</span></div>
        </div>`;
    }

    // Co-judges
    const panel = assignment.panel || [];
    const coJudges = panel.filter(p => String(p.id) !== String(myId));
    const coHtml = coJudges.length ? `
        <div style="margin-bottom:12px;font-size:12px;color:#475569;">
            <span style="font-weight:600;">Panel: </span>
            ${panel.map(p => {
                const j = (state.judges || []).find(jj => String(jj.id) === String(p.id));
                const isMe = String(p.id) === String(myId);
                return `<span style="background:${isMe?'#dbeafe':'#f1f5f9'};color:${isMe?'#1e40af':'#475569'};padding:2px 8px;border-radius:10px;font-weight:${isMe?'700':'500'};margin-right:4px;">
                    ${escapeHTML(j?.name || `Judge #${p.id}`)} ${p.role ? `<span style="opacity:.6;">(${p.role})</span>` : ''}${isMe?' (you)':''}
                </span>`;
            }).join('')}
        </div>` : '';

    // Role badge
    const myPanelEntry = panel.find(p => String(p.id) === String(myId));
    const myRole = assignment.judgeRole || myPanelEntry?.role || 'wing';
    const roleBg = myRole === 'chair' ? '#dcfce7' : '#dbeafe';
    const roleText = myRole === 'chair' ? '#16a34a' : '#1d4ed8';

    // Feedback drawer — only show if debate has been assigned/completed and co-judges exist
    const fbKey  = `__portal_fb_${assignment.id}`;
    const hasFeedback = coJudges.length > 0;

    return `
    <div class="portal-section portal-assign-card ${done ? 'done' : 'pending'}" style="padding:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:17px;font-weight:800;color:#1e293b;">Round ${escapeHTML(String(roundNum))}</span>
                <span style="background:${roleBg};color:${roleText};padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">${myRole.toUpperCase()}</span>
            </div>
            <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;${done ? 'background:#dcfce7;color:#16a34a;' : 'background:#fef9c3;color:#92400e;'}">
                ${done ? '✅ Ballot Submitted' : '⏳ Pending'}
            </span>
        </div>
        <div style="font-size:13px;font-style:italic;color:#64748b;margin-bottom:4px;">"${escapeHTML(motion)}"</div>
        ${coHtml}
        ${teamsHtml}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${!done ? `
            <button onclick="window._openBallotForDebate('${assignment.id}')"
                    style="flex:1;min-width:160px;padding:10px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
                📝 Submit Ballot
            </button>` : ''}
            ${hasFeedback ? `
            <button onclick="window._toggleFbDrawer('${fbKey}')"
                    id="fb-toggle-${fbKey}"
                    style="flex:1;min-width:140px;padding:10px;background:white;color:#7c3aed;border:2px solid #7c3aed;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
                ✍️ Judge Feedback
            </button>` : ''}
        </div>
        ${hasFeedback ? _buildInlineFeedbackDrawer(fbKey, assignment, myId) : ''}
    </div>`;
}

function _buildInlineFeedbackDrawer(fbKey, debate, myId) {
    const panel    = debate.panel || [];
    const coJudges = panel.filter(p => String(p.id) !== String(myId));
    const tournId  = state.activeTournamentId;

    const judgeOptions = coJudges.map(p => {
        const j = (state.judges || []).find(jj => String(jj.id) === String(p.id));
        const alreadyDone = (state.feedback || []).some(fb =>
            String(fb.fromJudgeId || fb.from_judge_id) === String(myId) &&
            String(fb.toJudgeId  || fb.to_judge_id)   === String(p.id) &&
            String(fb.debateId   || fb.debate_id)      === String(debate.id)
        );
        return `<option value="${p.id}" ${alreadyDone ? 'disabled' : ''}>
            ${escapeHTML(j?.name || `Judge ${p.id}`)} ${p.role ? `(${p.role})` : ''} ${alreadyDone ? '✓ Done' : ''}
        </option>`;
    }).join('');

    const pickerId = `hsp-${fbKey}`;

    return `
    <div class="fb-drawer" id="${fbKey}">
        <div style="font-size:13px;font-weight:700;color:#7c3aed;margin-bottom:14px;">✍️ Peer Feedback for this Room</div>
        <div style="margin-bottom:12px;">
            <label class="fb-label">Judge to Review *</label>
            <select class="agc-select" id="${fbKey}-judge"
                    onchange="window._fbJudgeChanged('${fbKey}')">
                <option value="">— Select a co-judge —</option>
                ${judgeOptions}
            </select>
        </div>
        <div id="${fbKey}-fields" style="display:none;">
            <div style="margin-bottom:12px;">
                <label class="fb-label">Agree with the Call? *</label>
                <select class="agc-select" id="${fbKey}-agc">
                    <option value="">— Select —</option>
                    <option value="yes">✅ Yes — fully agreed</option>
                    <option value="mostly">👍 Mostly agreed</option>
                    <option value="partially">🤷 Partially agreed</option>
                    <option value="no">❌ Disagreed</option>
                    <option value="na">— N/A (I was chair)</option>
                </select>
            </div>
            <div style="margin-bottom:12px;">
                <label class="fb-label">Quality Rating (1 – 5) *</label>
                ${_halfStarPickerHtml(pickerId)}
            </div>
            <div style="margin-bottom:14px;">
                <label class="fb-label">Comments <span style="font-weight:400;color:#64748b;">(optional)</span></label>
                <textarea class="fb-textarea" id="${fbKey}-comment" rows="3"
                    placeholder="Reasoning quality, consistency, feedback to teams, chairing style…"></textarea>
            </div>
            <div style="background:#eff6ff;border-radius:6px;padding:10px;font-size:12px;color:#1e40af;margin-bottom:12px;">
                🔒 Feedback is anonymous — the judge will not see your name.
            </div>
            <button onclick="window._submitInlineFeedback('${fbKey}','${debate.id}','${tournId}')"
                    style="width:100%;padding:11px;background:#7c3aed;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
                Submit Feedback
            </button>
        </div>
    </div>`;
}

function _buildStandaloneFeedbackForm(myId, myName) {
    // Collect all co-judges across all debates
    const coJudgeMap = {}; // judgeId → { judge, debates[] }
    for (const round of state.rounds || []) {
        for (const debate of round.debates || []) {
            const panel = debate.panel || [];
            if (!panel.some(p => String(p.id) === String(myId))) continue;
            for (const p of panel) {
                if (String(p.id) === String(myId)) continue;
                const j = (state.judges || []).find(jj => String(jj.id) === String(p.id));
                if (!j) continue;
                if (!coJudgeMap[p.id]) coJudgeMap[p.id] = { judge: j, debates: [] };
                coJudgeMap[p.id].debates.push({ debate, round, role: p.role });
            }
        }
    }

    const coJudges = Object.values(coJudgeMap);
    if (!coJudges.length) return `
        <div class="portal-section" style="text-align:center;padding:40px 20px;">
            <div style="font-size:48px;margin-bottom:12px;">⚖️</div>
            <p style="color:#64748b;margin:0;">You'll be able to submit feedback once you've been allocated to a round with other judges.</p>
        </div>`;

    const pickerId = 'standalone-hsp';
    return `
    <div class="portal-section">
        <h3 style="margin:0 0 18px;color:#1e293b;">Submit Peer Feedback</h3>
        <div style="margin-bottom:14px;">
            <label class="fb-label">Select Judge *</label>
            <select class="agc-select" id="sfb-judge" onchange="window._sfbJudgeChange()">
                <option value="">— Choose a co-judge —</option>
                ${coJudges.map(({ judge, debates }) => {
                    const done = (state.feedback || []).some(fb =>
                        String(fb.fromJudgeId || fb.from_judge_id) === String(myId) &&
                        String(fb.toJudgeId || fb.to_judge_id) === String(judge.id)
                    );
                    return `<option value="${judge.id}" ${done ? 'disabled' : ''}>${escapeHTML(judge.name)} ${done ? '(✓ reviewed)' : ''}</option>`;
                }).join('')}
            </select>
        </div>
        <div style="margin-bottom:14px;">
            <label class="fb-label">Round / Debate <span style="font-weight:400;color:#64748b;">(optional — for context)</span></label>
            <select class="agc-select" id="sfb-debate">
                <option value="">— Select round —</option>
                ${coJudges.flatMap(({ judge, debates }) =>
                    debates.map(({ debate, round }) => `<option value="${debate.id}" data-judge="${judge.id}">
                        Round ${round.round_number || round.id} — ${escapeHTML((state.teams||[]).find(t=>String(t.id)===String(debate.gov))?.name||'?')} vs ${escapeHTML((state.teams||[]).find(t=>String(t.id)===String(debate.opp))?.name||'?')}
                    </option>`)
                ).join('')}
            </select>
        </div>
        <div style="margin-bottom:14px;">
            <label class="fb-label">Agree with the Call? *</label>
            <select class="agc-select" id="sfb-agc">
                <option value="">— Select —</option>
                <option value="yes">✅ Yes — fully agreed</option>
                <option value="mostly">👍 Mostly agreed</option>
                <option value="partially">🤷 Partially agreed</option>
                <option value="no">❌ Disagreed</option>
                <option value="na">— N/A (I was chair)</option>
            </select>
        </div>
        <div style="margin-bottom:14px;">
            <label class="fb-label">Quality Rating (1 – 5) *</label>
            ${_halfStarPickerHtml(pickerId)}
        </div>
        <div style="margin-bottom:16px;">
            <label class="fb-label">Comments <span style="font-weight:400;color:#64748b;">(optional)</span></label>
            <textarea class="fb-textarea" id="sfb-comment" rows="4"
                placeholder="Reasoning quality, consistency, how helpful was their feedback to teams…"></textarea>
        </div>
        <div style="background:#eff6ff;border-radius:6px;padding:10px;font-size:12px;color:#1e40af;margin-bottom:14px;">
            🔒 Your feedback is anonymous — the judge will never see your name.
        </div>
        <button onclick="window._submitStandaloneFeedback()"
                style="width:100%;padding:12px;background:linear-gradient(135deg,#7c3aed,#4c1d95);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">
            Submit Feedback
        </button>
    </div>`;
}

function _buildReceivedFeedback(received) {
    if (!received.length) return `
        <div class="portal-section" style="text-align:center;padding:40px 20px;">
            <div style="font-size:48px;margin-bottom:12px;">📭</div>
            <p style="color:#64748b;margin:0;">You haven't received any feedback yet.</p>
        </div>`;

    const avg = received.reduce((s, fb) => s + parseFloat(fb.rating || 0), 0) / received.length;
    const dist = [1,2,3,4,5].map(r => received.filter(fb => Math.round(parseFloat(fb.rating || 0)) === r).length);

    const agcLabels = { yes: '✅ Agreed', mostly: '👍 Mostly', partially: '🤷 Partially', no: '❌ Disagreed', na: '—' };

    return `
    <div class="portal-section">
        <h3 style="margin:0 0 16px;color:#1e293b;">📬 Feedback Received (Anonymous)</h3>
        <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:#f8fafc;border-radius:10px;padding:20px;margin-bottom:20px;">
            <div style="text-align:center;">
                <div style="font-size:42px;font-weight:800;color:${avg>=4?'#16a34a':avg>=3?'#d97706':'#dc2626'};">${avg.toFixed(1)}</div>
                <div style="font-size:20px;">${_starDisplay(avg)}</div>
                <div style="font-size:12px;color:#64748b;">${received.length} review${received.length!==1?'s':''}</div>
            </div>
            <div style="flex:1;min-width:160px;">
                ${[5,4,3,2,1].map(r => {
                    const cnt = dist[r-1];
                    const pct = Math.round(cnt / received.length * 100);
                    return `<div class="rating-bar-wrap" style="margin-bottom:5px;">
                        <span style="width:44px;text-align:right;font-size:12px;color:#64748b;">${r} ★</span>
                        <div class="rating-bar"><div class="rating-bar-fill" style="width:${pct}%"></div></div>
                        <span style="width:22px;font-size:12px;color:#64748b;">${cnt}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div style="display:grid;gap:10px;">
            ${[...received].reverse().map(fb => {
                const agc = fb.agreeWithCall || fb.agree_with_call;
                return `
                <div style="background:white;padding:14px;border-radius:8px;border:1px solid #e2e8f0;border-left:4px solid ${parseFloat(fb.rating||0)>=4?'#10b981':parseFloat(fb.rating||0)>=3?'#f59e0b':'#ef4444'};">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                        <span style="font-size:16px;">${_starDisplay(parseFloat(fb.rating||0))} <strong>${parseFloat(fb.rating||0).toFixed(1)}</strong></span>
                        ${agc ? `<span style="font-size:12px;background:#f1f5f9;padding:2px 8px;border-radius:8px;">${agcLabels[agc]||agc}</span>` : ''}
                        <span style="font-size:11px;color:#94a3b8;">${new Date(fb.timestamp||fb.created_at||0).toLocaleDateString()}</span>
                    </div>
                    ${fb.comment ? `<div style="color:#475569;font-style:italic;font-size:13px;">"${escapeHTML(fb.comment)}"</div>` : ''}
                    <div style="font-size:11px;color:#94a3b8;margin-top:5px;">— Anonymous · ${fb.source_type === 'team' ? 'Team review' : 'Peer review'}</div>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

// ── Half-star picker ──────────────────────────────────────────────────────────
function _halfStarPickerHtml(id) {
    const vals = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    return `
    <div class="hsp-row" id="${id}">
        ${vals.map(v => `
        <button type="button" class="hsp-btn" data-val="${v}"
                onclick="window._hspClick('${id}', ${v})"
                title="${v} star${v!==1?'s':''}">
            ${_halfStarLabel(v)}
        </button>`).join('')}
    </div>
    <input type="hidden" id="${id}_val" value="0">`;
}

function _halfStarLabel(v) {
    const full = Math.floor(v);
    const half = v % 1 !== 0;
    return '★'.repeat(full) + (half ? '½' : '') + `<span style="display:block;font-size:10px;margin-top:1px;">${v}</span>`;
}

window._hspClick = function(id, val) {
    const input = document.getElementById(id + '_val');
    if (input) input.value = val;
    document.querySelectorAll(`#${id} .hsp-btn`).forEach(btn => {
        const bv = parseFloat(btn.dataset.val);
        btn.classList.toggle('active',   bv < val);
        btn.classList.toggle('selected', bv === val);
    });
};

// ── Portal tab switch ─────────────────────────────────────────────────────────
window._portalSwitchTab = function(tab) {
    document.querySelectorAll('.portal-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.portal-pane').forEach(p => p.classList.remove('active'));
    const tabEl  = document.getElementById(`ptab-${tab}`);
    const paneEl = document.getElementById(`ppane-${tab}`);
    if (tabEl)  tabEl.classList.add('active');
    if (paneEl) paneEl.classList.add('active');
};

// ── Check-in toggle ───────────────────────────────────────────────────────────
window._portalCheckIn = async function(judgeId, status) {
    if (!judgeId) return;
    try {
        const { api } = await import('./api.js');
        await api.checkInJudge(judgeId, status);
        patchJudge(judgeId, { checked_in: status });
        const offBtn = document.getElementById('ci-unavail-btn');
        const onBtn  = document.getElementById('ci-avail-btn');
        if (offBtn) { offBtn.style.background = status ? 'rgba(255,255,255,.15)' : '#ef4444'; offBtn.style.color = status ? 'rgba(255,255,255,.7)' : 'white'; }
        if (onBtn)  { onBtn.style.background  = status ? '#10b981' : 'rgba(255,255,255,.15)'; onBtn.style.color  = status ? 'white' : 'rgba(255,255,255,.7)'; }
        showNotification(status ? '✓ Checked in' : 'Marked unavailable', 'info');
    } catch (e) {
        showNotification('Check-in update failed', 'error');
    }
};

// ── Feedback drawer toggle ────────────────────────────────────────────────────
window._toggleFbDrawer = function(fbKey) {
    const drawer = document.getElementById(fbKey);
    const btn    = document.getElementById(`fb-toggle-${fbKey}`);
    if (!drawer) return;
    const open = drawer.classList.toggle('open');
    if (btn) btn.textContent = open ? '✕ Close Feedback' : '✍️ Judge Feedback';
};

window._fbJudgeChanged = function(fbKey) {
    const fields = document.getElementById(`${fbKey}-fields`);
    const sel    = document.getElementById(`${fbKey}-judge`);
    if (fields) fields.style.display = sel?.value ? 'block' : 'none';
};

// ── Submit inline feedback ────────────────────────────────────────────────────
window._submitInlineFeedback = async function(fbKey, debateId, tournamentId) {
    const myId     = state.auth?.currentUser?.associatedId;
    const toJudgeId = document.getElementById(`${fbKey}-judge`)?.value;
    const agc      = document.getElementById(`${fbKey}-agc`)?.value;
    const rating   = parseFloat(document.getElementById(`${fbKey}_val`)?.value || '0');
    const comment  = document.getElementById(`${fbKey}-comment`)?.value.trim() || '';

    if (!toJudgeId)      { showNotification('Select a judge to review', 'error'); return; }
    if (!agc)            { showNotification('Please indicate if you agreed with the call', 'error'); return; }
    if (!rating || rating < 1) { showNotification('Please select a rating', 'error'); return; }

    try {
        const { api } = await import('./api.js');
        await api.submitFeedback({ tournamentId, debateId, fromJudgeId: myId, toJudgeId, rating, agreeWithCall: agc, comment });

        // Mirror to in-memory state
        if (!state.feedback) state.feedback = [];
        state.feedback.push({ id: `fb_${Date.now()}`, fromJudgeId: myId, toJudgeId, debateId, rating, agreeWithCall: agc, comment, source_type: 'judge_peer', timestamp: new Date().toISOString() });

        showNotification('✅ Feedback submitted!', 'success');
        const drawer = document.getElementById(fbKey);
        if (drawer) {
            drawer.innerHTML = `<div style="background:#f0fdf4;border-radius:8px;padding:14px;color:#16a34a;font-size:13px;font-weight:600;text-align:center;">✅ Feedback submitted — thank you!</div>`;
        }
    } catch (e) {
        showNotification(`Submission failed: ${e.message}`, 'error');
    }
};

// ── Standalone feedback form handlers ────────────────────────────────────────
window._sfbJudgeChange = function() {};  // future: filter debate dropdown

window._submitStandaloneFeedback = async function() {
    const ctx      = window._portalCtx || {};
    const myId     = state.auth?.currentUser?.associatedId || ctx.judgeId;
    const toJudgeId = document.getElementById('sfb-judge')?.value;
    const debateId = document.getElementById('sfb-debate')?.value || null;
    const agc      = document.getElementById('sfb-agc')?.value;
    const rating   = parseFloat(document.getElementById('standalone-hsp_val')?.value || '0');
    const comment  = document.getElementById('sfb-comment')?.value.trim() || '';
    const tournId  = ctx.tournamentId || state.activeTournamentId;

    if (!toJudgeId)      { showNotification('Select a judge to review', 'error'); return; }
    if (!agc)            { showNotification('Please indicate if you agreed with the call', 'error'); return; }
    if (!rating || rating < 1) { showNotification('Please select a rating (1 – 5)', 'error'); return; }

    const already = (state.feedback || []).some(fb =>
        String(fb.fromJudgeId || fb.from_judge_id) === String(myId) &&
        String(fb.toJudgeId   || fb.to_judge_id)   === String(toJudgeId)
    );
    if (already) { showNotification('You have already submitted feedback for this judge', 'error'); return; }

    try {
        const { api } = await import('./api.js');
        await api.submitFeedback({ tournamentId: tournId, debateId, fromJudgeId: myId, toJudgeId, rating, agreeWithCall: agc, comment });

        if (!state.feedback) state.feedback = [];
        state.feedback.push({ id: `fb_${Date.now()}`, fromJudgeId: myId, toJudgeId, debateId, rating, agreeWithCall: agc, comment, source_type: 'judge_peer', timestamp: new Date().toISOString() });

        showNotification('✅ Feedback submitted!', 'success');
        document.getElementById('sfb-judge')?.querySelector(`option[value="${toJudgeId}"]`)?.setAttribute('disabled', 'disabled');
        const judgeEl = document.getElementById('sfb-judge');
        const agcEl = document.getElementById('sfb-agc');
        const commentEl = document.getElementById('sfb-comment');
        const ratingEl = document.getElementById('standalone-hsp_val');
        if (judgeEl) judgeEl.value = '';
        if (agcEl) agcEl.value = '';
        if (commentEl) commentEl.value = '';
        if (ratingEl) ratingEl.value = '0';
        document.querySelectorAll('#standalone-hsp .hsp-btn').forEach(btn => btn.classList.remove('active', 'selected'));
    } catch (e) {
        showNotification(`Submission failed: ${e.message}`, 'error');
    }
};

// ── Navigate to ballot modal ─────────────────────────────────────────────────
window._openBallotForDebate = function(debateId) {
    const rounds = state.rounds || [];
    for (let ri = 0; ri < rounds.length; ri++) {
        const debates = rounds[ri].debates || [];
        for (let di = 0; di < debates.length; di++) {
            if (String(debates[di].id) === String(debateId)) {
                window.showEnterResults?.(ri, di);
                return;
            }
        }
    }
    showNotification('Could not locate debate. Check the Draw tab.', 'error');
};

// ── Team Portal ───────────────────────────────────────────────────────────────
function _renderTeamPortalView(container) {
    const teamId = state.auth?.currentUser?.associatedId;
    const team   = (state.teams || []).find(t => String(t.id) === String(teamId));

    if (!team) {
        container.innerHTML = `
            <div class="section" style="text-align:center;padding:60px 20px;">
                <div style="font-size:64px;margin-bottom:20px;">⚠️</div>
                <h3 style="margin:0 0 10px;color:#1e293b;">Team Profile Not Found</h3>
                <p style="color:#64748b;margin:0;">Your account is not linked to a team. Contact the admin.</p>
            </div>`;
        return;
    }

    // Gather debates this team participated in, grouped by round
    const participatedDebates = [];
    for (const round of state.rounds || []) {
        for (const debate of round.debates || []) {
            const sides = [debate.gov, debate.opp, debate.og, debate.oo, debate.cg, debate.co];
            if (!sides.some(s => String(s) === String(teamId))) continue;
            const judges = (debate.panel || []).map(p => {
                const j = (state.judges || []).find(jj => String(jj.id) === String(p.id));
                return j ? { ...j, role: p.role || j.role || 'wing' } : null;
            }).filter(Boolean);
            if (judges.length) participatedDebates.push({ debate, round, judges });
        }
    }
    window._portalCtx = { teamId, tournamentId: state.activeTournamentId, fromToken: false };
    _renderTeamPortalContent(container, team, teamId, participatedDebates);
}

// Shared HTML renderer for team portal — used by both logged-in and token flows
function _renderTeamPortalContent(container, team, teamId, participatedDebates) {
    const rcMap = { chair: { bg: '#dcfce7', text: '#16a34a' }, wing: { bg: '#dbeafe', text: '#1d4ed8' }, trainee: { bg: '#fef3c7', text: '#92400e' } };

    container.innerHTML = `
    <style>
    .portal-section{background:white;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #f1f5f9;}
    .hsp-row{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0;}
    .hsp-btn{padding:5px 8px;border-radius:6px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:12px;font-weight:600;color:#64748b;transition:all .12s;white-space:nowrap;}
    .hsp-btn.active{border-color:#f59e0b;background:#fef9c3;color:#92400e;}
    .hsp-btn.selected{border-color:#d97706;background:#f59e0b;color:white;transform:scale(1.08);}
    .agc-select{width:100%;padding:9px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;background:white;}
    .fb-label{display:block;font-weight:600;color:#374151;font-size:13px;margin-bottom:6px;}
    .fb-textarea{width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box;}
    </style>

    <div class="portal-section" style="background:linear-gradient(135deg,#7c3aed,#4c1d95);color:white;border:none;">
        <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;">🏆 ${escapeHTML(team.name)}</h1>
        <p style="margin:0;opacity:0.85;font-size:14px;">Rate the judges from your debates — feedback is fully anonymous.</p>
    </div>

    ${!participatedDebates.length ? `
        <div class="portal-section" style="text-align:center;padding:50px;">
            <div style="font-size:48px;margin-bottom:12px;">📭</div>
            <p style="color:#64748b;margin:0;">No debates yet. Your judges will appear here once you've debated.</p>
        </div>` :
        participatedDebates.map(({ debate, round, judges }) => {
            const roundNum = round.round_number || round.id || '?';
            const motion   = round.motion || 'Motion TBD';
            return `
            <div class="portal-section">
                <div style="font-weight:800;font-size:16px;color:#1e293b;margin-bottom:4px;">Round ${escapeHTML(String(roundNum))}</div>
                <div style="font-size:13px;font-style:italic;color:#64748b;margin-bottom:16px;">"${escapeHTML(motion)}"</div>
                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:12px;color:#166534;margin-bottom:16px;">
                    🔒 Your feedback is completely anonymous — judges will never see your team name.
                </div>
                <div style="display:grid;gap:14px;">
                    ${judges.map(judge => {
                        const rc  = rcMap[judge.role] || rcMap.wing;
                        const key = `tfb-${debate.id}-${judge.id}`;
                        const done = (state.feedback || []).some(fb =>
                            String(fb.fromTeamId || fb.from_team_id) === String(teamId) &&
                            String(fb.toJudgeId  || fb.to_judge_id)  === String(judge.id) &&
                            String(fb.debateId   || fb.debate_id)     === String(debate.id)
                        );
                        return `
                        <div style="background:#f8fafc;border-radius:10px;padding:16px;border:1px solid #e2e8f0;">
                            <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                                <div style="width:40px;height:40px;border-radius:50%;background:${rc.bg};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:${rc.text};">
                                    ${escapeHTML((judge.name||'J')[0].toUpperCase())}
                                </div>
                                <div>
                                    <div style="font-weight:700;font-size:15px;color:#1e293b;">${escapeHTML(judge.name)}</div>
                                    <span style="background:${rc.bg};color:${rc.text};padding:1px 9px;border-radius:12px;font-size:11px;font-weight:700;">${(judge.role||'WING').toUpperCase()}</span>
                                </div>
                                ${done ? '<span style="margin-left:auto;background:#dcfce7;color:#16a34a;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">✓ Reviewed</span>' : ''}
                            </div>
                            ${done ? `
                                <div style="background:#f0fdf4;border-radius:8px;padding:12px;color:#16a34a;font-size:13px;text-align:center;">
                                    ✅ Feedback submitted for this judge. Thank you!
                                </div>` : `
                                <div style="margin-bottom:10px;">
                                    <label class="fb-label">Agree with the Call?</label>
                                    <select class="agc-select" id="${key}-agc">
                                        <option value="">— Select —</option>
                                        <option value="yes">✅ Yes — fully agreed</option>
                                        <option value="mostly">👍 Mostly agreed</option>
                                        <option value="partially">🤷 Partially agreed</option>
                                        <option value="no">❌ Disagreed</option>
                                        <option value="na">— N/A</option>
                                    </select>
                                </div>
                                <div style="margin-bottom:10px;">
                                    <label class="fb-label">Quality Rating (1 – 5) *</label>
                                    ${_halfStarPickerHtml(key)}
                                </div>
                                <div style="margin-bottom:12px;">
                                    <label class="fb-label">Comments <span style="font-weight:400;color:#64748b;">(optional)</span></label>
                                    <textarea class="fb-textarea" id="${key}-comment" rows="3"
                                        placeholder="How clear was their decision? Was their feedback helpful? How did they run the room?"></textarea>
                                </div>
                                <button onclick="window._submitTeamFeedback('${key}','${debate.id}','${judge.id}')"
                                        style="width:100%;padding:11px;background:#7c3aed;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
                                    Submit Feedback for ${escapeHTML(judge.name)}
                                </button>
                            `}
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }).join('')
    }`;
}

window._submitTeamFeedback = async function(key, debateId, toJudgeId) {
    const ctx    = window._portalCtx || {};
    const teamId = ctx.teamId || state.auth?.currentUser?.associatedId;
    const judgeInState = (state.judges || []).find(j => String(j.id) === String(toJudgeId));
    const judgeName = judgeInState?.name || 'Judge';
    if (!teamId) { showNotification('Could not identify your team', 'error'); return; }

    const agc    = document.getElementById(`${key}-agc`)?.value || null;
    const rating = parseFloat(document.getElementById(`${key}_val`)?.value || '0');
    const comment = document.getElementById(`${key}-comment`)?.value.trim() || '';

    if (!rating || rating < 1) { showNotification('Please select a rating (1 – 5)', 'error'); return; }

    const already = (state.feedback || []).some(fb =>
        String(fb.fromTeamId || fb.from_team_id) === String(teamId) &&
        String(fb.toJudgeId  || fb.to_judge_id)  === String(toJudgeId) &&
        String(fb.debateId   || fb.debate_id)     === String(debateId)
    );
    if (already) { showNotification('You have already reviewed this judge for this round', 'error'); return; }

    try {
        const tournId = ctx.tournamentId || state.activeTournamentId;
        await api.submitTeamFeedback({ tournamentId: tournId, debateId, fromTeamId: teamId, toJudgeId, rating, agreeWithCall: agc, comment });

        if (!state.feedback) state.feedback = [];
        state.feedback.push({ id: `fb_${Date.now()}`, fromTeamId: teamId, toJudgeId, debateId, rating, agreeWithCall: agc, comment, source_type: 'team', timestamp: new Date().toISOString() });

        showNotification(`Feedback submitted for ${judgeName}!`, 'success');
        const container = document.getElementById('portal-container');
        if (container) _renderTeamPortalView(container);
    } catch (e) {
        showNotification(`Submission failed: ${e.message}`, 'error');
    }
};

// ── Admin Portal ──────────────────────────────────────────────────────────────
function _renderAdminPortalView(container) {
    const judges = state.judges || [];
    const rounds = state.rounds || [];
    const feedback = state.feedback || [];

    const checkedIn  = judges.filter(j => j.checked_in).length;
    const totalAssign = rounds.reduce((s, r) => s + r.debates.reduce((ss, d) => ss + (d.panel||[]).length, 0), 0);
    const pending    = rounds.reduce((s, r) => s + r.debates.filter(d => !d.entered).length, 0);
    const submitted  = rounds.reduce((s, r) => s + r.debates.filter(d => d.entered).length, 0);

    // Per-judge stats
    const judgeStats = {};
    for (const fb of feedback) {
        const jid = String(fb.toJudgeId || fb.to_judge_id);
        if (!judgeStats[jid]) judgeStats[jid] = { ratings: [], peer: [], team: [] };
        judgeStats[jid].ratings.push(parseFloat(fb.rating || 0));
        if (fb.source_type === 'team') judgeStats[jid].team.push(parseFloat(fb.rating || 0));
        else judgeStats[jid].peer.push(parseFloat(fb.rating || 0));
    }

    const avg = arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : '—';

    // Check-in section
    const checkInRows = judges.map(j => {
        const rc = j.role === 'chair' ? { bg: '#dcfce7', text: '#16a34a' } : { bg: '#dbeafe', text: '#1d4ed8' };
        const jAssign = rounds.reduce((s, r) => s + r.debates.filter(d => (d.panel||[]).some(p => String(p.id) === String(j.id))).length, 0);
        const stats = judgeStats[String(j.id)];
        const jAvg  = stats ? avg(stats.ratings) : '—';
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:36px;height:36px;border-radius:50%;background:${rc.bg};display:flex;align-items:center;justify-content:center;font-weight:700;color:${rc.text};">
                    ${escapeHTML((j.name||'J')[0].toUpperCase())}
                </div>
                <div>
                    <div style="font-weight:700;font-size:14px;color:#1e293b;">${escapeHTML(j.name)}</div>
                    <div style="font-size:12px;color:#64748b;">${jAssign} assignments · ⭐ ${jAvg}</div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12px;font-weight:600;color:${j.checked_in?'#16a34a':'#94a3b8'};">
                    ${j.checked_in ? '✓ Checked In' : '✗ Not In'}
                </span>
                <button onclick="window._adminOverrideCheckIn('${j.id}', ${!j.checked_in})"
                        style="padding:4px 12px;background:${j.checked_in?'#fee2e2':'#dcfce7'};color:${j.checked_in?'#991b1b':'#16a34a'};border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
                    ${j.checked_in ? 'Mark Out' : 'Mark In'}
                </button>
            </div>
        </div>`;
    }).join('');

    // Feedback overview
    const topJudges = [...judges]
        .filter(j => judgeStats[String(j.id)])
        .sort((a, b) => {
            const aAvg = parseFloat(avg(judgeStats[String(a.id)].ratings)) || 0;
            const bAvg = parseFloat(avg(judgeStats[String(b.id)].ratings)) || 0;
            return bAvg - aAvg;
        });

    container.innerHTML = `
    <style>
    .portal-section{background:white;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #f1f5f9;}
    .adm-stat{background:white;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.05);}
    .adm-stat-num{font-size:32px;font-weight:800;}
    .adm-stat-lbl{font-size:12px;color:#64748b;margin-top:4px;}
    .portal-tab-bar{display:flex;gap:4px;margin-bottom:18px;background:#f1f5f9;border-radius:10px;padding:4px;}
    .portal-tab{flex:1;text-align:center;padding:8px;border-radius:8px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:#64748b;transition:all .15s;}
    .portal-tab.active{background:white;color:#1e293b;box-shadow:0 1px 4px rgba(0,0,0,.1);}
    .portal-pane{display:none;}
    .portal-pane.active{display:block;}
    </style>

    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px;">
        <div class="adm-stat"><div class="adm-stat-num" style="color:#3b82f6;">${judges.length}</div><div class="adm-stat-lbl">Total Judges</div></div>
        <div class="adm-stat"><div class="adm-stat-num" style="color:#10b981;">${checkedIn}</div><div class="adm-stat-lbl">Checked In</div></div>
        <div class="adm-stat"><div class="adm-stat-num" style="color:#f59e0b;">${pending}</div><div class="adm-stat-lbl">Pending Ballots</div></div>
        <div class="adm-stat"><div class="adm-stat-num" style="color:#10b981;">${submitted}</div><div class="adm-stat-lbl">Submitted</div></div>
        <div class="adm-stat"><div class="adm-stat-num" style="color:#7c3aed;">${feedback.length}</div><div class="adm-stat-lbl">Feedback Items</div></div>
    </div>

    <!-- Admin tabs -->
    <div class="portal-tab-bar">
        <button class="portal-tab active" onclick="window._portalSwitchTab('checkin')" id="ptab-checkin">✓ Check-In</button>
        <button class="portal-tab" onclick="window._portalSwitchTab('ratings')" id="ptab-ratings">⭐ Ratings</button>
        <button class="portal-tab" onclick="window._portalSwitchTab('ballots')" id="ptab-ballots">📋 Ballots</button>
    </div>

    <!-- Check-in pane -->
    <div id="ppane-checkin" class="portal-pane active">
        <div class="portal-section" style="padding:0;overflow:hidden;">
            <div style="padding:16px 18px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <h3 style="margin:0;color:#1e293b;">Judge Check-In Status</h3>
                <div style="font-size:13px;color:#64748b;">${checkedIn} / ${judges.length} checked in</div>
            </div>
            ${checkInRows || '<div style="padding:30px;text-align:center;color:#64748b;">No judges registered.</div>'}
        </div>
    </div>

    <!-- Ratings pane -->
    <div id="ppane-ratings" class="portal-pane">
        ${topJudges.length === 0 ? `<div class="portal-section" style="text-align:center;padding:40px;"><div style="font-size:48px;margin-bottom:12px;">📭</div><p style="color:#64748b;margin:0;">No feedback submitted yet.</p></div>` :
        topJudges.map((j, rank) => {
            const stats = judgeStats[String(j.id)];
            const jAvg  = avg(stats.ratings);
            const pAvg  = avg(stats.peer);
            const tAvg  = avg(stats.team);
            const aColor = parseFloat(jAvg) >= 4 ? '#16a34a' : parseFloat(jAvg) >= 3 ? '#d97706' : '#dc2626';
            const rc = j.role === 'chair' ? { bg: '#dcfce7', text: '#16a34a' } : { bg: '#dbeafe', text: '#1d4ed8' };
            return `
            <div class="portal-section" style="padding:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                    <div style="display:flex;align-items:center;gap:12px;">
                        <div style="width:38px;height:38px;border-radius:50%;background:${rc.bg};display:flex;align-items:center;justify-content:center;font-weight:700;color:${rc.text};font-size:16px;">
                            ${escapeHTML((j.name||'J')[0].toUpperCase())}
                        </div>
                        <div>
                            <div style="font-weight:700;font-size:15px;color:#1e293b;">#${rank+1} ${escapeHTML(j.name)}</div>
                            <span style="background:${rc.bg};color:${rc.text};padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;">${(j.role||'WING').toUpperCase()}</span>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:26px;font-weight:800;color:${aColor};">${jAvg} <span style="font-size:14px;color:#94a3b8;">/ 5.0</span></div>
                        <div style="font-size:12px;color:#64748b;">${stats.ratings.length} review${stats.ratings.length!==1?'s':''}</div>
                    </div>
                </div>
                <div style="display:flex;gap:16px;margin-top:12px;font-size:12px;color:#64748b;flex-wrap:wrap;">
                    <span>👨‍⚖️ Peer avg: <strong style="color:#1e293b;">${pAvg}</strong> (${stats.peer.length})</span>
                    <span>🏆 Team avg: <strong style="color:#1e293b;">${tAvg}</strong> (${stats.team.length})</span>
                </div>
                <button onclick="window.viewJudgeFeedbackDetails('${j.id}')"
                        style="margin-top:12px;padding:6px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;color:#475569;">
                    View All Reviews
                </button>
            </div>`;
        }).join('')}
    </div>

    <!-- Ballots pane -->
    <div id="ppane-ballots" class="portal-pane">
        <div class="portal-section" style="padding:0;overflow:hidden;">
            <div style="padding:16px 18px;border-bottom:1px solid #f1f5f9;">
                <h3 style="margin:0;color:#1e293b;">Ballot Status by Round</h3>
            </div>
            ${rounds.length === 0 ? '<div style="padding:30px;text-align:center;color:#64748b;">No rounds yet.</div>' :
            rounds.map(round => {
                const dones = (round.debates || []).filter(d => d.entered).length;
                const total = (round.debates || []).length;
                const pct   = total ? Math.round(dones/total*100) : 0;
                return `
                <div style="padding:14px 18px;border-bottom:1px solid #f8fafc;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-weight:700;color:#1e293b;">Round ${round.round_number || round.id}</span>
                        <span style="font-size:13px;color:${dones===total?'#16a34a':'#d97706'};font-weight:600;">${dones}/${total} submitted</span>
                    </div>
                    <div style="background:#e2e8f0;border-radius:4px;height:6px;overflow:hidden;">
                        <div style="background:${dones===total?'#10b981':'#f59e0b'};height:100%;width:${pct}%;transition:width .3s;border-radius:4px;"></div>
                    </div>
                </div>`;
            }).join('')}
        </div>
    </div>

    <!-- Quick actions -->
    <div class="portal-section">
        <h3 style="margin:0 0 12px;color:#1e293b;">Quick Actions</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button onclick="window.switchTab?.('admin-dashboard');setTimeout(()=>window.adminSwitchSection?.('judges'),100)" class="btn-secondary" style="font-size:13px;">⚖️ Manage Judges</button>
            <button onclick="window.switchTab?.('draw')" class="btn-secondary" style="font-size:13px;">🎲 Go to Draw</button>
            <button onclick="window.switchTab?.('feedback')" class="btn-secondary" style="font-size:13px;">📊 Feedback Dashboard</button>
        </div>
    </div>`;
}

window._adminOverrideCheckIn = async function(judgeId, status) {
    try {
        const { api } = await import('./api.js');
        await api.checkInJudge(judgeId, status);
        patchJudge(judgeId, { checked_in: status });
        showNotification(`Judge ${status ? 'checked in' : 'marked out'}`, 'info');
        const container = document.getElementById('portal-container');
        if (container) _renderAdminPortalView(container);
    } catch (e) {
        showNotification('Override failed', 'error');
    }
};

// ── Login prompt ──────────────────────────────────────────────────────────────
function _renderLoginPrompt(container) {
    container.innerHTML = '';
    const overlay = el('div', { class: 'locked-overlay', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 'locked-modal' },
            el('div', { class: 'locked-modal__icon' }, '🚪'),
            el('span', { class: 'locked-badge locked-badge--info' }, '🔑 Login Required'),
            el('h2',  { class: 'locked-modal__heading' }, 'Portal'),
            el('p',   { class: 'locked-modal__sub' }, 'This portal is for judges and teams. Use your private link, or log in with your account.'),
            el('div', { class: 'locked-modal__actions' },
                el('button', { class: 'btn btn-primary', 'data-action': 'showLoginModal' }, '🔑 Login')
            )
        )
    );
    container.appendChild(overlay);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _teamName(id) {
    if (!id) return 'TBD';
    const t = (state.teams || []).find(t => String(t.id) === String(id));
    return t?.name || `Team #${id}`;
}

function _starDisplay(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
}

// ── submitPortalBallot (kept for backward compat) ─────────────────────────────
export async function submitPortalBallot({ debateId, tournamentId, winnerSide, govTotal, oppTotal, speakerScores }) {
    try {
        const { api } = await import('./api.js');
        await api.submitBallot({ debateId, tournamentId, winnerSide, govTotal, oppTotal, speakerScores });
        showNotification('Ballot submitted successfully!', 'success');
        renderJudgePortal();
    } catch (err) {
        showNotification(`Ballot submission failed: ${err.message}`, 'error');
        throw err;
    }
}

export function switchPortalTab(tab) { window._portalSwitchTab(tab); }
export function submitPortalFeedback() { showNotification('Use the feedback form in your portal.', 'info'); }

// ── Register ──────────────────────────────────────────────────────────────────
registerActions({ renderJudgePortal, switchPortalTab, submitPortalFeedback, checkUrlForJudgeToken });

window.addEventListener('portal:login-success', () => {
    try {
        const container = document.getElementById('portal-container');
        if (container) { container.innerHTML = ''; renderJudgePortal(); }
    } catch (e) { /* keep portal event handler non-fatal */ }
});
