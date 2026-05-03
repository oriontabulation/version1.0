// ============================================================
// FEEDBACK.JS — Admin feedback dashboard + judge view
// ============================================================
import { state, save } from './state.js';
import { api } from './api.js';
import { escapeHTML, showNotification, closeAllModals } from './utils.js';

function _isAdmin() { return state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'admin'; }
function _isJudge() { return state.auth?.isAuthenticated && state.auth?.currentUser?.role === 'judge'; }
function _myJudgeId() { return state.auth?.currentUser?.associatedId ?? null; }

function _panelHasJudge(panel, judgeId) {
    return (panel || []).some(p => String(p.id || p.judge_id) === String(judgeId));
}

function _canJudgeReview(myId, toJudgeId) {
    if (!myId || !toJudgeId || String(myId) === String(toJudgeId)) return false;
    for (const round of state.rounds || []) {
        for (const debate of round.debates || []) {
            const panel = debate.panel || debate.debate_judges || [];
            if (_panelHasJudge(panel, myId) && _panelHasJudge(panel, toJudgeId)) return true;
        }
    }
    return false;
}

const AGC_LABELS = { yes: '✅ Agreed', mostly: '👍 Mostly', partially: '🤷 Partially', no: '❌ Disagreed', na: '—' };

function _avg(arr) {
    const vals = arr.map(v => parseFloat(v.rating || 0)).filter(Boolean);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function _starBar(rating, count) {
    const color = rating >= 4 ? '#10b981' : rating >= 3 ? '#f59e0b' : '#ef4444';
    return `<span style="font-size:22px;font-weight:700;color:${color};">${rating.toFixed(1)}</span>
            <span style="color:#94a3b8;font-size:13px;"> / 5.0 &nbsp;·&nbsp; ${count} review${count!==1?'s':''}</span>`;
}

function _ratingBars(feedbacks) {
    return [5,4,3,2,1].map(r => {
        const cnt = feedbacks.filter(fb => Math.round(parseFloat(fb.rating||0)) === r).length;
        const pct = feedbacks.length ? Math.round(cnt/feedbacks.length*100) : 0;
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="width:44px;text-align:right;font-size:12px;color:#64748b;">${r} ★</span>
            <div style="flex:1;background:#e2e8f0;border-radius:4px;height:7px;overflow:hidden;">
                <div style="background:#f59e0b;height:100%;width:${pct}%;border-radius:4px;"></div>
            </div>
            <span style="width:22px;font-size:12px;color:#64748b;">${cnt}</span>
        </div>`;
    }).join('');
}

// ============================================================
// ENTRY POINT
// ============================================================
function renderFeedback() {
    if (_isAdmin())  { _renderAdminFeedback();  return; }
    if (_isJudge())  { _renderJudgeFeedbackPortal(); return; }
    const c = document.getElementById('feedback');
    if (c) c.innerHTML = `
        <div style="text-align:center;padding:80px 20px;color:#64748b;">
            <div style="font-size:56px;margin-bottom:12px;">🔒</div>
            <h2 style="color:#1e293b;">Access Restricted</h2>
            <p>Feedback is only available to judges and admins.</p>
        </div>`;
}

// ============================================================
// ADMIN VIEW
// ============================================================
function _renderAdminFeedback() {
    const container = document.getElementById('feedback');
    if (!container) return;

    const allFb   = state.feedback || [];
    const judges  = state.judges   || [];

    // Compute per-judge stats
    const byJudge = {};
    for (const fb of allFb) {
        const jid = String(fb.toJudgeId || fb.to_judge_id || '');
        if (!jid) continue;
        if (!byJudge[jid]) byJudge[jid] = { all: [], peer: [], team: [] };
        byJudge[jid].all.push(fb);
        if (fb.source_type === 'team') byJudge[jid].team.push(fb);
        else                           byJudge[jid].peer.push(fb);
    }

    const totalFb    = allFb.length;
    const peerFb     = allFb.filter(fb => fb.source_type !== 'team').length;
    const teamFb     = allFb.filter(fb => fb.source_type === 'team').length;
    const globalAvg  = _avg(allFb);
    const reviewed   = Object.keys(byJudge).length;

    container.innerHTML = `
    <style>
    .fb-section{background:white;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #f1f5f9;}
    .fb-filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;}
    .fb-filter-btn{padding:6px 16px;border-radius:20px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:13px;font-weight:600;color:#64748b;transition:all .15s;}
    .fb-filter-btn.active{background:#1e40af;color:white;border-color:#1e40af;}
    .adm-stat{background:white;border-radius:10px;padding:14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05);}
    </style>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px;">
        <div class="adm-stat"><div style="font-size:28px;font-weight:800;color:#3b82f6;">${totalFb}</div><div style="font-size:12px;color:#64748b;">Total Feedback</div></div>
        <div class="adm-stat"><div style="font-size:28px;font-weight:800;color:#7c3aed;">${peerFb}</div><div style="font-size:12px;color:#64748b;">Peer Reviews</div></div>
        <div class="adm-stat"><div style="font-size:28px;font-weight:800;color:#10b981;">${teamFb}</div><div style="font-size:12px;color:#64748b;">Team Reviews</div></div>
        <div class="adm-stat"><div style="font-size:28px;font-weight:800;color:#f59e0b;">${reviewed}</div><div style="font-size:12px;color:#64748b;">Judges Reviewed</div></div>
        <div class="adm-stat"><div style="font-size:28px;font-weight:800;color:#ef4444;">${globalAvg !== null ? globalAvg.toFixed(1) : '—'}</div><div style="font-size:12px;color:#64748b;">Overall Avg</div></div>
    </div>

    <!-- Source filter -->
    <div class="fb-filter-bar">
        <button class="fb-filter-btn active" id="fbf-all"  onclick="window._fbFilterSource('all')">All Sources</button>
        <button class="fb-filter-btn"        id="fbf-peer" onclick="window._fbFilterSource('peer')">Peer Only</button>
        <button class="fb-filter-btn"        id="fbf-team" onclick="window._fbFilterSource('team')">Team Only</button>
    </div>

    ${Object.keys(byJudge).length === 0 ? `
    <div class="fb-section" style="text-align:center;padding:50px;">
        <div style="font-size:48px;margin-bottom:12px;">📭</div>
        <h3 style="margin:0 0 8px;color:#1e293b;">No Feedback Yet</h3>
        <p style="color:#64748b;margin:0;">Feedback will appear here once judges and teams submit evaluations.</p>
    </div>` :
    `<div id="fb-judge-list" style="display:grid;gap:16px;">
        ${Object.entries(byJudge)
            .sort((a,b) => (_avg(b[1].all)||0) - (_avg(a[1].all)||0))
            .map(([judgeId, stats]) => {
                const j = judges.find(jj => String(jj.id) === String(judgeId));
                if (!j) return '';
                const allAvg  = _avg(stats.all);
                const peerAvg = _avg(stats.peer);
                const teamAvg = _avg(stats.team);
                const rc = j.role === 'chair' ? { bg:'#dcfce7', text:'#16a34a' } : { bg:'#dbeafe', text:'#1d4ed8' };
                const aColor = allAvg >= 4 ? '#16a34a' : allAvg >= 3 ? '#d97706' : '#dc2626';
                const latest = [...stats.all].reverse()[0];
                return `
                <div class="fb-section" style="padding:18px;" data-source="all" data-judge="${judgeId}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="width:44px;height:44px;border-radius:50%;background:${rc.bg};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:${rc.text};">
                                ${escapeHTML((j.name||'J')[0].toUpperCase())}
                            </div>
                            <div>
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                                    <strong style="font-size:16px;color:#1e293b;">${escapeHTML(j.name)}</strong>
                                    <span style="background:${rc.bg};color:${rc.text};padding:1px 9px;border-radius:10px;font-size:11px;font-weight:700;">${(j.role||'WING').toUpperCase()}</span>
                                </div>
                                <div style="display:flex;gap:14px;font-size:12px;color:#64748b;flex-wrap:wrap;">
                                    <span>Overall: <strong style="color:${aColor};">${allAvg?.toFixed(1)||'—'}</strong></span>
                                    <span>Peer: <strong>${peerAvg?.toFixed(1)||'—'}</strong> (${stats.peer.length})</span>
                                    <span>Team: <strong>${teamAvg?.toFixed(1)||'—'}</strong> (${stats.team.length})</span>
                                </div>
                            </div>
                        </div>
                        <button onclick="window.viewJudgeFeedbackDetails('${judgeId}')"
                                style="padding:7px 16px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                            View Details
                        </button>
                    </div>
                    ${latest?.comment ? `
                    <div style="background:#f8fafc;padding:12px;border-radius:8px;border-left:3px solid ${aColor};font-size:13px;">
                        <div style="font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:4px;">RECENT FEEDBACK</div>
                        <div style="color:#475569;font-style:italic;">"${escapeHTML(latest.comment)}"</div>
                        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">— Anonymous · ${latest.source_type === 'team' ? 'Team' : 'Peer'}</div>
                    </div>` : ''}
                </div>`;
            }).join('')}
    </div>`}`;

    window._fbFilterSource = function(src) {
        document.querySelectorAll('.fb-filter-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`fbf-${src}`)?.classList.add('active');
        document.querySelectorAll('#fb-judge-list [data-judge]').forEach(card => {
            const judgeId = card.dataset.judge;
            const stats   = byJudge[judgeId];
            if (!stats) return;
            const items = src === 'peer' ? stats.peer : src === 'team' ? stats.team : stats.all;
            card.style.display = items.length ? '' : 'none';
        });
    };
}

// ============================================================
// JUDGE VIEW
// ============================================================
function _renderJudgeFeedbackPortal() {
    const container = document.getElementById('feedback');
    if (!container) return;

    const myId      = _myJudgeId();
    const received  = (state.feedback || []).filter(fb => String(fb.toJudgeId || fb.to_judge_id) === String(myId));
    const avgRating = _avg(received);

    // Co-panellists
    const coMap = {};
    for (const r of state.rounds || []) {
        for (const d of r.debates || []) {
            const panel = d.panel || [];
            if (!panel.some(p => String(p.id) === String(myId))) continue;
            for (const p of panel) {
                if (String(p.id) === String(myId)) continue;
                const j = (state.judges || []).find(jj => String(jj.id) === String(p.id));
                if (j && !coMap[p.id]) coMap[p.id] = { judge: j, debateId: d.id, roundId: r.id };
            }
        }
    }
    const coJudges = Object.values(coMap);
    const submitted = new Set((state.feedback || []).filter(fb => String(fb.fromJudgeId || fb.from_judge_id) === String(myId)).map(fb => String(fb.toJudgeId || fb.to_judge_id)));

    container.innerHTML = `
    <style>
    .fb-section{background:white;border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #f1f5f9;}
    .hsp-row{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0;}
    .hsp-btn{padding:5px 8px;border-radius:6px;border:1.5px solid #e2e8f0;background:white;cursor:pointer;font-size:12px;font-weight:600;color:#64748b;transition:all .12s;white-space:nowrap;}
    .hsp-btn.active{border-color:#f59e0b;background:#fef9c3;color:#92400e;}
    .hsp-btn.selected{border-color:#d97706;background:#f59e0b;color:white;transform:scale(1.08);}
    .agc-select{width:100%;padding:9px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;background:white;margin-bottom:12px;}
    .fb-textarea{width:100%;padding:10px;border-radius:8px;border:1.5px solid #e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box;}
    </style>
    <div style="max-width:760px;margin:0 auto;">

    <!-- My ratings summary -->
    <div class="fb-section">
        <h2 style="margin:0 0 16px;color:#1e293b;">📬 My Feedback (Anonymous)</h2>
        ${received.length === 0 ? `
        <div style="background:#f8fafc;border-radius:10px;padding:30px;text-align:center;color:#64748b;">
            <div style="font-size:36px;margin-bottom:8px;">📭</div>
            <p style="margin:0;">You haven't received any feedback yet.</p>
        </div>` : `
        <div style="background:#f8fafc;border-radius:10px;padding:20px;margin-bottom:16px;">
            <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
                <div style="text-align:center;">
                    <div style="font-size:40px;font-weight:800;color:${avgRating>=4?'#10b981':avgRating>=3?'#f59e0b':'#ef4444'};">${avgRating.toFixed(1)}</div>
                    <div style="font-size:12px;color:#64748b;">${received.length} review${received.length!==1?'s':''}</div>
                </div>
                <div style="flex:1;min-width:160px;">${_ratingBars(received)}</div>
            </div>
        </div>
        <div style="display:grid;gap:10px;">
            ${[...received].reverse().map(fb => {
                const agc = fb.agreeWithCall || fb.agree_with_call;
                const r = parseFloat(fb.rating || 0);
                return `
                <div style="background:white;padding:14px;border-radius:8px;border:1px solid #e2e8f0;border-left:4px solid ${r>=4?'#10b981':r>=3?'#f59e0b':'#ef4444'};">
                    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                        <span style="font-weight:700;">${r.toFixed(1)} / 5.0</span>
                        ${agc ? `<span style="font-size:12px;background:#f1f5f9;padding:2px 8px;border-radius:8px;">${AGC_LABELS[agc]||agc}</span>` : ''}
                        <span style="font-size:11px;color:#94a3b8;">${fb.source_type==='team'?'Team review':'Peer review'} · ${new Date(fb.timestamp||fb.created_at||0).toLocaleDateString()}</span>
                    </div>
                    ${fb.comment ? `<div style="color:#475569;font-style:italic;font-size:13px;">"${escapeHTML(fb.comment)}"</div>` : '<div style="color:#94a3b8;font-style:italic;font-size:12px;">No comment provided.</div>'}
                </div>`;
            }).join('')}
        </div>`}
    </div>

    <!-- Submit feedback form -->
    <div class="fb-section">
        <h2 style="margin:0 0 16px;color:#1e293b;">✍️ Submit Peer Feedback</h2>
        ${coJudges.length === 0 ? `
        <div style="background:#f8fafc;border-radius:10px;padding:30px;text-align:center;color:#64748b;">
            <div style="font-size:36px;margin-bottom:8px;">⚖️</div>
            <p style="margin:0;">You'll be able to submit feedback once you've been allocated to a round with other judges.</p>
        </div>` : `
        <div style="margin-bottom:14px;">
            <label style="display:block;font-weight:600;color:#374151;font-size:13px;margin-bottom:6px;">Judge to Review *</label>
            <select class="agc-select" id="fb-target-judge" onchange="window._onFeedbackTargetChange()" style="margin-bottom:0;">
                <option value="">— Choose a co-judge —</option>
                ${coJudges.map(({ judge }) => {
                    const done = submitted.has(String(judge.id));
                    return `<option value="${judge.id}" ${done?'disabled':''}>
                        ${escapeHTML(judge.name)} (${judge.role||'wing'}) ${done?'✓ reviewed':''}
                    </option>`;
                }).join('')}
            </select>
        </div>
        <div id="fb-form-body" style="display:none;">
            <div style="margin-bottom:12px;">
                <label style="display:block;font-weight:600;color:#374151;font-size:13px;margin-bottom:6px;">Agree with the Call? *</label>
                <select class="agc-select" id="fb-agc">
                    <option value="">— Select —</option>
                    <option value="yes">✅ Yes — fully agreed</option>
                    <option value="mostly">👍 Mostly agreed</option>
                    <option value="partially">🤷 Partially agreed</option>
                    <option value="no">❌ Disagreed</option>
                    <option value="na">— N/A (I was chair)</option>
                </select>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-weight:600;color:#374151;font-size:13px;margin-bottom:6px;">Quality Rating (1 – 5) *</label>
                <div class="hsp-row" id="fb-hsp">
                    ${[1,1.5,2,2.5,3,3.5,4,4.5,5].map(v => `
                    <button type="button" class="hsp-btn" data-val="${v}"
                            onclick="window._hspClick('fb-hsp',${v})" title="${v} stars">
                        ${'★'.repeat(Math.floor(v))}${v%1?'½':''}
                        <span style="display:block;font-size:10px;">${v}</span>
                    </button>`).join('')}
                </div>
                <input type="hidden" id="fb-hsp_val" value="0">
                <div id="fb-rating-error" style="display:none;color:#dc2626;font-size:12px;margin-top:4px;">Please select a rating</div>
            </div>
            <div style="margin-bottom:14px;">
                <label style="display:block;font-weight:600;color:#374151;font-size:13px;margin-bottom:6px;">Comments <span style="font-weight:400;color:#64748b;">(optional)</span></label>
                <textarea class="fb-textarea" id="fb-comment" rows="3"
                    placeholder="Reasoning quality, consistency, how helpful was their feedback to teams…"></textarea>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;margin-bottom:14px;font-size:12px;color:#1e40af;">
                🔒 Feedback is anonymous — the judge will not see your name.
            </div>
            <button onclick="window.submitFeedback()"
                    style="width:100%;background:linear-gradient(135deg,#1e40af,#7c3aed);color:white;border:none;padding:12px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">
                Submit Feedback
            </button>
        </div>`}
    </div>
    </div>`;
}

// ── Feedback form helpers ─────────────────────────────────────────────────────
window._onFeedbackTargetChange = function() {
    const sel  = document.getElementById('fb-target-judge');
    const body = document.getElementById('fb-form-body');
    if (!body) return;
    if (sel?.value) {
        body.style.display = 'block';
        window._hspClick?.('fb-hsp', 0); // reset picker
        document.getElementById('fb-hsp_val').value = 0;
        const agc = document.getElementById('fb-agc');
        const comment = document.getElementById('fb-comment');
        if (agc) agc.value = '';
        if (comment) comment.value = '';
    } else {
        body.style.display = 'none';
    }
};

// ── Submit feedback (judge → judge) ──────────────────────────────────────────
async function submitFeedback() {
    if (!_isJudge()) { showNotification('Only judges can submit feedback', 'error'); return; }

    const myId     = _myJudgeId();
    const toJudgeId = document.getElementById('fb-target-judge')?.value;
    if (!toJudgeId) { showNotification('Select a judge to review', 'error'); return; }
    if (!_canJudgeReview(myId, toJudgeId)) {
        showNotification('You can only review judges allocated to your room', 'error');
        return;
    }

    const agc    = document.getElementById('fb-agc')?.value;
    if (!agc)    { showNotification('Please indicate if you agreed with the call', 'error'); return; }

    const rating = parseFloat(document.getElementById('fb-hsp_val')?.value || '0');
    if (!rating || rating < 1) {
        const e = document.getElementById('fb-rating-error');
        if (e) e.style.display = 'block';
        showNotification('Please select a rating', 'error');
        return;
    }

    const already = (state.feedback || []).some(
        fb => String(fb.fromJudgeId || fb.from_judge_id) === String(myId) &&
              String(fb.toJudgeId   || fb.to_judge_id)   === String(toJudgeId)
    );
    if (already) { showNotification('You have already submitted feedback for this judge', 'error'); return; }

    const comment  = document.getElementById('fb-comment')?.value.trim() || '';
    const tournId  = state.activeTournamentId;

    try {
        await api.submitFeedback({ tournamentId: tournId, debateId: null, fromJudgeId: myId, toJudgeId, rating, agreeWithCall: agc, comment });

        if (!state.feedback) state.feedback = [];
        state.feedback.push({ id: `fb_${Date.now()}`, fromJudgeId: myId, toJudgeId: parseInt(toJudgeId)||toJudgeId, rating, agreeWithCall: agc, comment, source_type: 'judge_peer', timestamp: new Date().toISOString() });

        save();
        showNotification('✅ Feedback submitted — thank you!', 'success');
        _renderJudgeFeedbackPortal();
    } catch (e) {
        showNotification(`Submission failed: ${e.message}`, 'error');
    }
}

// ── Admin: detailed feedback modal ───────────────────────────────────────────
function viewJudgeFeedbackDetails(judgeId) {
    const judge    = (state.judges || []).find(j => String(j.id) === String(judgeId));
    const feedbacks = (state.feedback || []).filter(fb => String(fb.toJudgeId || fb.to_judge_id) === String(judgeId));
    if (!judge || !feedbacks.length) return;

    closeAllModals();

    const avgAll  = _avg(feedbacks);
    const avgPeer = _avg(feedbacks.filter(f => f.source_type !== 'team'));
    const avgTeam = _avg(feedbacks.filter(f => f.source_type === 'team'));
    const rc = judge.role === 'chair' ? { bg: '#dcfce7', text: '#16a34a' } : { bg: '#dbeafe', text: '#1d4ed8' };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = e => { if (e.target === overlay) closeAllModals(); };

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'max-width:680px;max-height:85vh;overflow:auto;border-radius:16px;';

    modal.innerHTML = `
    <style>
    .hsp-row{display:flex;gap:4px;flex-wrap:wrap;}
    .hsp-btn{padding:4px 8px;border-radius:6px;border:1.5px solid #e2e8f0;background:white;font-size:11px;font-weight:600;color:#64748b;white-space:nowrap;}
    .hsp-btn.active{border-color:#f59e0b;background:#fef9c3;color:#92400e;}
    .hsp-btn.selected{border-color:#d97706;background:#f59e0b;color:white;}
    </style>
    <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:white;padding:24px;border-radius:12px 12px 0 0;margin:-20px -20px 20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            <div style="width:48px;height:48px;border-radius:50%;background:${rc.bg};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:${rc.text};">${escapeHTML((judge.name||'J')[0].toUpperCase())}</div>
            <div>
                <h2 style="margin:0 0 4px;font-size:20px;">${escapeHTML(judge.name)}</h2>
                <span style="background:rgba(255,255,255,.2);padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;">${(judge.role||'WING').toUpperCase()}</span>
            </div>
        </div>
    </div>

    <!-- Rating summary -->
    <div style="background:#f8fafc;border-radius:10px;padding:18px;margin-bottom:20px;">
        <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">
            <div style="text-align:center;">
                <div style="font-size:40px;font-weight:800;color:${avgAll>=4?'#10b981':avgAll>=3?'#f59e0b':'#ef4444'};">${avgAll?.toFixed(1)||'—'}</div>
                <div style="font-size:12px;color:#64748b;">${feedbacks.length} review${feedbacks.length!==1?'s':''}</div>
            </div>
            <div style="flex:1;min-width:160px;">${_ratingBars(feedbacks)}</div>
            <div style="font-size:13px;color:#64748b;">
                <div>👨‍⚖️ Peer avg: <strong>${avgPeer?.toFixed(1)||'—'}</strong></div>
                <div style="margin-top:4px;">🏆 Team avg: <strong>${avgTeam?.toFixed(1)||'—'}</strong></div>
            </div>
        </div>
    </div>

    <!-- Filter tabs -->
    <div style="display:flex;gap:6px;margin-bottom:16px;">
        <button onclick="window._fbModalFilter('all',${judgeId})" id="fmd-all" style="padding:5px 14px;border-radius:20px;border:1.5px solid #1e40af;background:#1e40af;color:white;cursor:pointer;font-size:12px;font-weight:600;">All (${feedbacks.length})</button>
        <button onclick="window._fbModalFilter('peer',${judgeId})" id="fmd-peer" style="padding:5px 14px;border-radius:20px;border:1.5px solid #e2e8f0;background:white;color:#64748b;cursor:pointer;font-size:12px;font-weight:600;">Peer (${feedbacks.filter(f=>f.source_type!=='team').length})</button>
        <button onclick="window._fbModalFilter('team',${judgeId})" id="fmd-team" style="padding:5px 14px;border-radius:20px;border:1.5px solid #e2e8f0;background:white;color:#64748b;cursor:pointer;font-size:12px;font-weight:600;">Team (${feedbacks.filter(f=>f.source_type==='team').length})</button>
    </div>

    <!-- Reviews -->
    <div id="fmd-list" style="display:grid;gap:12px;max-height:380px;overflow-y:auto;padding-right:4px;">
        ${[...feedbacks].reverse().map(fb => {
            const r   = parseFloat(fb.rating || 0);
            const agc = fb.agreeWithCall || fb.agree_with_call;
            return `
            <div data-src="${fb.source_type||'judge_peer'}" style="background:white;padding:14px;border-radius:8px;border:1px solid #e2e8f0;border-left:4px solid ${r>=4?'#10b981':r>=3?'#f59e0b':'#ef4444'};">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                    <div>
                        <span style="font-weight:700;font-size:15px;">${r.toFixed(1)} / 5</span>
                        ${agc ? `<span style="margin-left:8px;font-size:12px;background:#f1f5f9;padding:2px 8px;border-radius:8px;">${AGC_LABELS[agc]||agc}</span>` : ''}
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <span style="font-size:11px;background:${fb.source_type==='team'?'#f0fdf4':'#eff6ff'};color:${fb.source_type==='team'?'#16a34a':'#1e40af'};padding:2px 8px;border-radius:8px;font-weight:600;">
                            ${fb.source_type==='team'?'Team':'Peer'}
                        </span>
                        <span style="font-size:11px;color:#94a3b8;">${new Date(fb.timestamp||fb.created_at||0).toLocaleDateString()}</span>
                    </div>
                </div>
                ${fb.comment
                    ? `<div style="color:#475569;font-style:italic;font-size:13px;padding:8px;background:#f8fafc;border-radius:6px;">"${escapeHTML(fb.comment)}"</div>`
                    : '<div style="color:#94a3b8;font-style:italic;font-size:12px;">No comment.</div>'}
            </div>`;
        }).join('')}
    </div>

    <div style="margin-top:20px;text-align:center;">
        <button onclick="window.closeAllModals()" style="padding:10px 28px;background:#64748b;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Close</button>
    </div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
}

window._fbModalFilter = function(src, judgeId) {
    document.querySelectorAll('[id^="fmd-"]').forEach(b => {
        b.style.background = 'white'; b.style.color = '#64748b'; b.style.borderColor = '#e2e8f0';
    });
    const active = document.getElementById(`fmd-${src}`);
    if (active) { active.style.background = '#1e40af'; active.style.color = 'white'; active.style.borderColor = '#1e40af'; }
    document.querySelectorAll('#fmd-list [data-src]').forEach(row => {
        row.style.display = (src === 'all' || row.dataset.src === src || (src === 'peer' && row.dataset.src !== 'team')) ? '' : 'none';
    });
};

// ── Exports ───────────────────────────────────────────────────────────────────
window.submitFeedback           = submitFeedback;
window.viewJudgeFeedbackDetails = viewJudgeFeedbackDetails;
window.renderFeedback           = renderFeedback;

export { renderFeedback, submitFeedback, viewJudgeFeedbackDetails };
