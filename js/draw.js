// ============================================
// DRAW.JS — Rounds, pairing, judge allocation, results
// ADDED: Round Robin pairing support
// ============================================

import { save, saveNow} from './supabase-sync.js';
import { state, watch } from './state.js';
import { showNotification, escapeHTML, closeAllModals, getPreviousMeetings, teamCode } from './utils.js';
import { hasConflict, buildConflictMap } from './maps.js';
import { renderStandings } from './tab.js';


// ─── Format detection ────────────────────────────────────────────────────────
function getFormat() {
    const activeId = state.activeTournamentId;
    const tour = state.tournaments?.[activeId];
    if (tour?.speechMode) return 'speech';
    return tour?.format || 'standard';
}
function isBP()     { return getFormat() === 'bp';     }
function isSpeech() { return getFormat() === 'speech'; }

// Team label helper - shows team names or codes based on display preference
function teamLabel(team) {
    if (!team) return 'TBD';
    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const displayMode = savedPrefs['display'] || 'names';
    if (displayMode === 'codes') {
        return escapeHTML(teamCode(team));
    }
    return escapeHTML(team.name || '');
}

// Returns a label for a team — codes mode shows code, hide-names blurs, otherwise shows name
function _nameLabel(team) {
    if (!team) return 'TBD';
    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const displayMode = savedPrefs['display'] || 'names';
    if (displayMode === 'codes') {
        return escapeHTML(teamCode(team));
    }
    if (savedPrefs['hide-names']) {
        return `<span class="draw-name-blind">${escapeHTML(team.name || '')}</span>`;
    }
    return escapeHTML(team.name || '');
}

// Toggle between names and codes display
function _toggleTeamNames() {
    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const current = savedPrefs['display'] || 'names';
    const newDisplay = (current === 'names') ? 'codes' : 'names';
    savedPrefs['display'] = newDisplay;
    localStorage.setItem('orion_draw_prefs', JSON.stringify(savedPrefs));
    displayRounds();
}

// Set name display mode and refresh draw
function _setNameDisplay(value) {
    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    savedPrefs['display'] = value;
    localStorage.setItem('orion_draw_prefs', JSON.stringify(savedPrefs));
    displayRounds();
}


// Judge pill HTML helper
function _judgePillHtml(debate, emoji = '⚖️') {
    if (!debate || !debate.panel || debate.panel.length === 0) {
        return `<span style="font-size:11px;color:#94a3b8;font-style:italic;">No judges</span>`;
    }
    
    const isJudge = state.auth?.currentUser?.role === 'judge';
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    
    // Build judge chips with roles
    const judgeChips = debate.panel.map(panelObj => {
        const j = (state.judges || []).find(j => String(j.id) === String(panelObj.id));
        if (!j) return '';
        
        // Find role for this judge in this debate (stored on the panel object)
        const judgeInDebate = panelObj.role || 'wing';
        const isChair = judgeInDebate === 'chair';
        
        // Determine if this is the current user's judge assignment
        const isMyJudge = myJudgeId && String(myJudgeId) === String(j.id);
        
        return `
            <span class="dnd-judge-chip" ${isMyJudge ? 'style="border:2px solid #3b82f6"' : ''}>
                <span class="chip-role ${isChair?'chair':'wing'}">${judgeInDebate}</span>
                ${escapeHTML(j.name)}
                ${isMyJudge ? ' <span style="font-size:10px;opacity:0.8;">(you)</span>' : ''}
            </span>
        `;
    }).filter(chip => chip.trim() !== '').join('');
    
    // If no valid judges found
    if (!judgeChips) {
        return `<span style="font-size:11px;color:#94a3b8;font-style:italic;">No judges</span>`;
    }
    
    return `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span style="font-size:11px;color:#94a3b8;">${emoji}</span>
            ${judgeChips}
        </div>
    `;
}


// ─── CSS — injected once into <head>, not on every render ────────────────────
let _cssInjected = false;
function _injectDrawCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    const style = document.createElement('style');
    style.textContent = `
  /* Modern Judge Chips */
  .dnd-judge-chip { display:inline-flex; align-items:center; gap:6px; background:rgba(255,255,255,0.8); backdrop-filter:blur(4px); border:1px solid #e2e8f0; padding:4px 10px 4px 12px; border-radius:999px; font-size:12px; color:#1e293b; font-weight:600; cursor:grab; user-select:none; transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1); box-shadow:0 1px 2px rgba(0,0,0,0.05); margin:3px; }
  .dnd-judge-chip:hover { transform:translateY(-1px); background:#f0f9ff; border-color:#bae6fd; color:#0369a1; box-shadow:0 3px 6px rgba(14,165,233,0.1); }
  .dnd-judge-chip.dragging { opacity:0.6; cursor:grabbing; transform:scale(0.95); box-shadow:none; }
  .dnd-judge-chip .chip-role { font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:#64748b; background:#f8fafc; padding:2px 6px; border-radius:12px; border:1px solid #e2e8f0; cursor:pointer; transition:all 0.15s; }
  .dnd-judge-chip .chip-role:hover { background:#e0e7ff; color:#3730a3; border-color:#a5b4fc; }
  .dnd-judge-chip .chip-role.chair { color:#1d4ed8; border-color:#bfdbfe; background:#eff6ff; }
  .dnd-judge-chip .chip-role.chair:hover { background:#dbeafe; color:#1e3a8a; }
  .dnd-judge-zone.drag-over-promote { border-color:#7c3aed !important; background:#f5f3ff !important; transform:scale(1.01); }
  .chip-remove { background:none; border:none; cursor:pointer; color:#94a3b8; font-size:14px; line-height:1; padding:2px; border-radius:50%; flex-shrink:0; transition:all 0.15s; display:flex; align-items:center; justify-content:center; width:18px; height:18px; margin-left:2px; }
  .chip-remove:hover { color:#ef4444; background:#fee2e2; }

  /* Modern Team Chips */
  .dnd-team-chip { display:block; width:100%; cursor:grab; user-select:none; transition:all 0.2s cubic-bezier(0.4, 0, 0.2, 1); border-radius:12px; }
  .dnd-team-chip:hover { transform:translateY(-2px); box-shadow:0 8px 16px rgba(0,0,0,0.08); }
  .dnd-team-chip.dragging { opacity:0.5; cursor:grabbing; transform:scale(0.96); box-shadow:none; }
  
  /* Drag & Drop Zones */
  .dnd-judge-zone { min-height:42px; padding:8px; border-radius:12px; border:2px dashed #e2e8f0; transition:all 0.2s ease; display:flex; flex-wrap:wrap; align-items:center; gap:4px; background:rgba(248,250,252,0.5); }
  .dnd-judge-zone.drag-over { border-color:#3b82f6; background:#eff6ff; transform:scale(1.01); }
  .dnd-judge-zone.drag-over-conflict { border-color:#f59e0b; background:#fffbeb; transform:scale(1.01); }
  .dnd-team-zone { transition:all 0.2s ease; border-radius:12px; }
  .dnd-team-zone.drag-over { outline:2px dashed #3b82f6; outline-offset:2px; background:#eff6ff !important; border-color:#bfdbfe !important; }
  .dnd-team-zone.drag-over-warn { outline:2px dashed #f59e0b; outline-offset:2px; background:#fffbeb !important; border-color:#fde68a !important; }
  
  /* Add Judge Select */
  .judge-add-select { font-size:12px; font-weight:600; border:1px dashed #cbd5e1; border-radius:20px; padding:4px 12px; color:#3b82f6; background:#f8fafc; cursor:pointer; transition:all 0.2s ease; outline:none; max-width:160px; }
  .judge-add-select:hover { border-color:#3b82f6; background:#eff6ff; box-shadow:0 2px 4px rgba(59,130,246,0.1); }
  
  /* Draw Room Cards */
  .draw-room { background:#ffffff; border-radius:16px; padding:16px 20px; margin-bottom:16px; transition:all 0.2s ease; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.05); border:1px solid #f1f5f9; border-left:4px solid #e2e8f0; position:relative; overflow:hidden; }
  .draw-room:hover { box-shadow:0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.05); transform:translateY(-1px); }
  .draw-room::before { content:''; position:absolute; top:0; left:0; width:100%; height:100%; background:linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%); pointer-events:none; }
  .draw-room.done { border-left-color:#10b981; }
  .draw-room.pending-partial { border-left-color:#f59e0b; }
  .draw-room.no-judges { border-left-color:#ef4444; }
  
  /* Draw Create Panel */
  .draw-create-panel { background:rgba(255,255,255,0.95); backdrop-filter:blur(8px); border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:16px; display:none; box-shadow:0 10px 25px rgba(0,0,0,0.05); }
  .draw-create-panel.open { display:block; animation:fadeInDown 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
  @keyframes fadeInDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
  
  /* Knockout Bracket */
  .knockout-bracket { display:flex; justify-content:space-around; margin:24px 0; overflow-x:auto; padding:24px 10px; gap:32px; }
  .bracket-round { display:flex; flex-direction:column; gap:24px; min-width:300px; background:transparent; padding:0; border-radius:0; border:none; }
  .bracket-match { background:#ffffff; border-radius:12px; padding:16px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05); border:1px solid #e2e8f0; transition:all 0.25s cubic-bezier(0.4, 0, 0.2, 1); position:relative; }
  .bracket-match:hover { box-shadow:0 12px 20px -5px rgba(0,0,0,0.1); transform:translateY(-3px); border-color:#cbd5e1; }
  .bracket-winner { border-left:4px solid #10b981; }
  .bracket-winner .team-name { font-weight:800; color:#064e3b; }
  .bracket-current { border:2px solid #3b82f6; box-shadow:0 0 0 4px rgba(59,130,246,0.1); }
  
  /* Modal Results Grid */
  .modal-results-grid { display:grid; grid-template-columns:1fr 1fr; gap:32px; margin-bottom:24px; }
  @media(max-width:768px){ .modal-results-grid{ grid-template-columns:1fr !important; gap:20px !important; } }
  
  /* Input & Select Focus Rings */
  .draw-create-panel input:focus, .draw-create-panel select:focus, .modal-results-grid select:focus, .modal-results-grid input:focus { outline:none; border-color:#3b82f6 !important; box-shadow:0 0 0 3px rgba(59,130,246,0.2) !important; }

  /* Blind round name hiding */
  .draw-name-blind { filter:blur(5px); transition:filter 0.2s; cursor:pointer; user-select:none; }
  .draw-name-blind:hover { filter:none; }

  /* Round Settings Dropdown */
  .round-settings-wrap { position:relative; display:inline-block; }
  .round-settings-menu { display:none; position:absolute; right:0; top:calc(100% + 4px); background:white; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.12); z-index:200; min-width:170px; padding:4px; }
  .round-settings-menu.open { display:block; animation:fadeInDown 0.15s cubic-bezier(0.16,1,0.3,1); }
  .round-settings-menu button { display:flex; align-items:center; gap:8px; width:100%; text-align:left; padding:8px 12px; border:none; background:none; cursor:pointer; font-size:12px; font-weight:500; border-radius:6px; color:#334155; transition:background 0.1s; }
  .round-settings-menu button:hover:not(:disabled) { background:#f8fafc; }
  .round-settings-menu button:disabled { opacity:0.4; cursor:not-allowed; }
  .round-settings-menu .danger { color:#ef4444; }
  .round-settings-menu .danger:hover:not(:disabled) { background:#fee2e2; }
  .round-settings-menu hr { border:none; border-top:1px solid #f1f5f9; margin:3px 0; }

  /* Round Mini Summary table (shown when collapsed) */
  .round-mini-summary { border-top:1px solid #f1f5f9; padding:0 0 4px; overflow-x:auto; }
  .round-mini-summary.hidden { display:none; }
  .round-mini-table { width:100%; border-collapse:collapse; font-size:12px; }
  .round-mini-table thead th { padding:5px 12px 4px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#94a3b8; text-align:left; border-bottom:1px solid #e8ecf0; white-space:nowrap; background:#f9fafb; }
  .round-mini-table tbody td { padding:5px 12px; border-bottom:1px solid #f8fafc; vertical-align:middle; }
  .round-mini-table tbody tr:last-child td { border-bottom:none; }
  .rmt-room { font-size:10px; color:#94a3b8; font-weight:700; white-space:nowrap; }
  .rmt-teams { color:#334155; font-weight:500; max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rmt-chair { color:#1d4ed8; font-weight:600; white-space:nowrap; }
  .rmt-chair .rmt-c { font-size:9px; color:#60a5fa; font-weight:800; margin-left:2px; }
  .rmt-wings { color:#475569; white-space:nowrap; max-width:130px; overflow:hidden; text-overflow:ellipsis; }
  .rmt-trainee { color:#64748b; font-size:11px; white-space:nowrap; }
  .rmt-status { text-align:center; font-size:13px; }

  /* ── Round accordion cards ────────────────────────────────────── */
  .round-card-wrap { background:#fff; border-radius:14px; border:1px solid #edf0f4; box-shadow:0 2px 8px rgba(0,0,0,.04); margin-bottom:14px; overflow:hidden; }
  .round-card-hdr { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; gap:10px; cursor:pointer; user-select:none; background:linear-gradient(to bottom,#fafbfc,#fff); border-bottom:1px solid #f1f5f9; flex-wrap:wrap; transition:background .15s ease; }
  .round-card-hdr:hover { background:#f8fafc; }
  .round-card-body { padding:16px; }
  .round-card-body.collapsed { display:none; }
  /* Remove draw-room bottom margin inside the grid (gap handles it) */
  .round-card-body .draw-room { margin-bottom:0; }
  .round-chevron { font-size:10px; color:#94a3b8; transition:transform .2s ease; flex-shrink:0; display:inline-block; }
  .round-chevron.open { transform:rotate(90deg); }

  /* ── Jump pills row ───────────────────────────────────────────── */
  .draw-jump-pills { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
  .draw-jump-pills:empty { display:none; margin:0; }

  /* Panel label inside judge zone */
  .draw-panel-label { font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; flex-shrink:0; margin-right:4px; }
    `;
}

export function renderDraw() {
    const container = document.getElementById('draw');
    if (!container) return;

    // Check if tournament is loaded
    if (!state.activeTournamentId) {
        container.innerHTML = `
            <div class="section">
                <h2>Draw</h2>
                <div style="text-align:center;padding:60px 20px;color:#64748b">
                    <div style="font-size:48px;margin-bottom:12px">🏛️</div>
                    <h3 style="margin:0 0 8px;color:#1e293b">No Tournament Selected</h3>
                    <p style="margin:0">Please select or create a tournament first.</p>
                </div>
            </div>`;
        return;
    }

    try {
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    const rounds  = state.rounds || [];
    const entered = (rounds || []).flatMap(r => (r.debates||[])).filter(d=>d.entered).length;
    const total   = (rounds || []).flatMap(r => (r.debates||[])).filter(d=>d.entered || d.panel?.length).length;

    // Load saved selector preferences
    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}

    const savedPairMethod = savedPrefs['cr-pair'] || 'random';
    const savedFilter     = savedPrefs['round-filter'] || 'all';

    // Pre-compute speech-conditional fragments
    const _speechMode     = isSpeech();
    const _motionPlaceholder = _speechMode
        ? 'e.g. Prepared Speech — Persuasion'
        : 'e.g. This House Would ban social media for under-16s';
    const _pairingLabel   = _speechMode ? 'Room Draw' : 'Pairing';
    const _replyCheckbox  = _speechMode ? '' :
        '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px">' +
        '<input type="checkbox" id="cr-disable-reply"> 🚫 No Reply Speeches</label>';

    _injectDrawCSS();
    container.innerHTML = `
    <div class="section">
    <h2>Draw</h2>
         <!-- Grouped controls bar -->
         <div class="draw-controls-bar">
             <div class="draw-controls-left">
                 <strong style="font-size:15px;color:#1e293b;white-space:nowrap">${_speechMode ? '🎤 Speech Draw' : '🎲 Draw'}</strong>
                 <span style="font-size:13px;color:#94a3b8">${(rounds || []).length} rounds · ${entered}/${total} results</span>
             </div>
<div class="draw-controls-right">
                   <select id="round-filter" class="draw-round-filter"
                           onchange="window.displayRounds()"
                           title="Filter rounds">
                       <option value="all" ${savedFilter==='all'?'selected':''}>All Rounds</option>
                       <option value="pending"   ${savedFilter==='pending'  ?'selected':''}>Pending</option>
                       <option value="completed" ${savedFilter==='completed'?'selected':''}>Completed</option>
                       <option value="blinded"   ${savedFilter==='blinded'  ?'selected':''}>Blind</option>
                   </select>
                   <select id="draw-name-display" class="draw-round-filter"
                           onchange="window._setNameDisplay(this.value)"
                           title="Show names or codes">
                       <option value="names" ${(savedPrefs['display']||'names')==='names'?'selected':''}>Names</option>
                       <option value="codes" ${savedPrefs['display']==='codes'?'selected':''}>Codes</option>
                   </select>
                   <button id="draw-view-toggle" onclick="window._toggleDrawView()" 
                           class="btn-secondary" style="padding:5px 10px;font-size:12px;font-weight:600"
                           title="Toggle between full and mini view">
                       📋 Mini
                   </button>
                   ${isAdmin ? `<button onclick="window._toggleCreateRound()" id="draw-new-btn"
                           class="btn-primary" style="padding:5px 12px;font-size:12px;font-weight:700">➕ New Round</button>` : ''}
               </div>
         </div>
         <div id="draw-jump-pills" class="draw-jump-pills"></div>

        ${isAdmin ? `
        <!-- Collapsible create round form -->
        <div class="draw-create-panel" id="draw-create-panel">
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px">
                <div>
                    <label style="display:block;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Motion / Topic</label>
                    <input id="cr-motion" placeholder="${_motionPlaceholder}"
                        style="width:100%;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box;font-family:inherit"
                        onkeydown="if(event.key==='Enter') window._submitNewRound()">
                </div>
                <div style="display:grid;grid-template-columns:${_speechMode?'1fr 1fr':'1fr'};gap:8px">
                    <div>
                        <label style="display:block;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">${_pairingLabel}</label>
                        <select id="cr-pair" style="width:100%;padding:7px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:inherit"
                                onchange="window._saveDrawPref('cr-pair',this.value)">
                            <option value="random" ${savedPairMethod==='random'?'selected':''}>🎲 Random</option>
                            <option value="power"   ${savedPairMethod==='power'  ?'selected':''}>⚡ Power</option>
                            <option value="fold"    ${savedPairMethod==='fold'   ?'selected':''}>📊 Balanced</option>
                        </select>
                    </div>
                    ${_speechMode ? `<div>
                        <label style="display:block;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Room Size</label>
                        <input type="number" id="cr-room-size" min="1" max="50" value="4" style="width:100%;padding:7px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:inherit">
                    </div>` : ''}
                </div>
                ${!_speechMode ? `<div>
                    <label style="display:block;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">Side Preference</label>
                    <select id="cr-side-pref" style="width:100%;padding:7px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:inherit" onchange="window._saveDrawPref('cr-side-pref',this.value)">
                        <option value="random" ${(savedPrefs['cr-side-pref']||'random')==='random'?'selected':''}>🎲 Random</option>
                        <option value="alternate" ${savedPrefs['cr-side-pref']==='alternate'?'selected':''}>🔄 Alternate (no repeat)</option>
                        <option value="balanced" ${savedPrefs['cr-side-pref']==='balanced'?'selected':''}>⚖️ Balanced (equal over time)</option>
                    </select>
                </div>` : ''}
                <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
                        <input type="checkbox" id="cr-autojudge" checked> Auto-allocate Judges
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
                        <input type="checkbox" id="cr-blind"> 🔒 Blind Round
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
                        <input type="checkbox" id="cr-avoid-meetings" checked> 🔄 Avoid Previous Meetings
                    </label>
                    ${_replyCheckbox}
                </div>
            </div>
            <div style="display:flex;gap:8px">
                <button onclick="window._submitNewRound()" class="btn-primary" style="padding:6px 16px;font-size:12px;font-weight:700">🎯 Create</button>
                <button onclick="window._toggleCreateRound()" class="btn-secondary" style="padding:6px 12px;font-size:12px">Cancel</button>
            </div>
        </div>` : ''}

        <div id="rounds-list"></div>
    </div>`;
    displayRounds();
    } catch (error) {
        console.error('[draw] renderDraw error:', error);
        container.innerHTML = `
            <div class="section">
                <h2>Draw</h2>
                <div style="text-align:center;padding:60px 20px;color:#64748b">
                    <div style="font-size:48px;margin-bottom:12px">❌</div>
                    <h3 style="margin:0 0 8px;color:#1e293b">Render Error</h3>
                    <p style="margin:0">Failed to render draw page. Check console for details.</p>
                    <button onclick="window.renderDraw()" style="margin-top:12px;padding:8px 16px;border:1px solid #e2e8f0;border-radius:6px;background:white;">Retry</button>
                </div>
            </div>`;
    }
}

window._toggleCreateRound = function() {
    const panel = document.getElementById('draw-create-panel');
    if (!panel) return;
    panel.classList.toggle('open');
    const btn = document.getElementById('draw-new-btn');
    if (btn) btn.textContent = panel.classList.contains('open') ? '✕ Cancel' : '➕ New Round';
};

window._submitNewRound = function() {
    const motion         = document.getElementById('cr-motion')?.value.trim() || 'Debate Round';
    const method         = document.getElementById('cr-pair')?.value   || 'random';
    const sideMethod     = document.getElementById('cr-sides')?.value  || 'random';
    const autoAllocate   = document.getElementById('cr-autojudge')?.checked ?? true;
    const blind          = document.getElementById('cr-blind')?.checked ?? false;
    const disableReply   = document.getElementById('cr-disable-reply')?.checked ?? false;
    const avoidMeetings  = document.getElementById('cr-avoid-meetings')?.checked ?? true;
    createRound({ motion, method, sideMethod, autoAllocate, blind, disableReply, avoidMeetings });
    // Collapse form after creation
    const panel = document.getElementById('draw-create-panel');
    if (panel) panel.classList.remove('open');
    const btn = document.getElementById('draw-new-btn');
    if (btn) btn.textContent = '➕ New Round';
};

function renderKnockoutBracket(rounds) {
    // Sort rounds by ID
    const sortedRounds = [...rounds].sort((a, b) => a.id - b.id);
    
    // Get the latest round
    const latestRound = sortedRounds[sortedRounds.length - 1];
    
    // If there's only one round, generate the full bracket structure
    if (sortedRounds.length === 1) {
        return renderFullKnockoutBracket(sortedRounds[0]);
    }
    
    // Multiple rounds - group debates by round
    const roundsByStage = sortedRounds.map(round => {
        const debates = round.debates || [];
        return {
            roundId: round.id,
            name: getKnockoutStageName(debates.length),
            debates: debates,
            motion: round.motion,
            isComplete: debates.every(d => d.entered),
            isLatest: round.id === latestRound.id
        };
    });
    
    // Generate the complete bracket structure
    let bracketHtml = `
        <div class="section">
            <h2 style="margin-bottom: 20px;">🏆 Knockout Bracket</h2>
            <div class="knockout-bracket">
    `;
    
    // Generate all possible rounds from current number of debates down to final
    const totalDebates = latestRound.debates.length;
    const allStages = generateAllBracketStages(totalDebates);
    
    allStages.forEach(stage => {
        const existingRound = roundsByStage.find(r => r.name === stage.name);
        
        bracketHtml += `
            <div class="bracket-round">
                <h3 style="text-align: center; margin-bottom: 15px; ${existingRound?.isLatest ? 'color: #2563eb; font-weight: 700;' : ''}">
                    ${stage.name}
                    ${existingRound?.isLatest ? ' (Current)' : ''}
                </h3>
        `;
        
        if (existingRound) {
            // Show actual debates from existing round
            existingRound.debates.forEach(debate => {
                bracketHtml += renderBracketMatch(debate);
            });
            
            // Add "Next Round" button if this round is complete and next doesn't exist
            if (existingRound.isComplete && !roundsByStage.find(r => r.name === stage.nextStage)) {
                bracketHtml += `
                    <div style="margin-top: 20px; text-align: center;">
                        <button onclick="window.createNextKnockoutRound(${existingRound.roundId})" 
                                class="btn-primary" 
                                style="padding: 10px 16px; border-radius: 8px; font-size: 13px; background: #7c3aed;">
                            ➡️ Advance to ${stage.nextStage || 'Next Round'}
                        </button>
                    </div>
                `;
            }
        } else {
            // Show placeholder brackets
            for (let i = 0; i < stage.numDebates; i++) {
                bracketHtml += `
                    <div class="bracket-match" style="opacity: 0.5;">
                        <div style="padding: 12px; color: #94a3b8; text-align: center;">
                            TBD
                        </div>
                        <div style="border-top: 1px solid #e2e8f0; margin: 4px 0;"></div>
                        <div style="padding: 12px; color: #94a3b8; text-align: center;">
                            TBD
                        </div>
                    </div>
                `;
            }
        }
        
        bracketHtml += `</div>`;
    });
    
    bracketHtml += `</div></div>`;
    return bracketHtml;
}

function renderFullKnockoutBracket(currentRound) {
    // Get all teams in the current round with their seeds
    const teams = [];
    const debates = currentRound.debates || [];
    debates.forEach(debate => {
        const gov = state.teams.find(t => t.id === debate.gov);
        const opp = state.teams.find(t => t.id === debate.opp);
        if (gov) teams.push({ team: gov, seed: gov.seed || 999, id: gov.id });
        if (opp) teams.push({ team: opp, seed: opp.seed || 999, id: opp.id });
    });

    // Sort by seed
    teams.sort((a, b) => a.seed - b.seed);

    // Generate all bracket stages
    const stages = generateAllBracketStages(debates.length);
    
    // Get all knockout rounds
    const allKnockoutRounds = state.rounds.filter(r => r.type === 'knockout');
    
    let html = `
        <div class="section">
            <h2 style="margin-bottom: 20px;">🏆 Knockout Bracket</h2>
            <div class="knockout-bracket">
    `;
    
    stages.forEach((stage, index) => {
        const isCurrentRound = index === 0;
        const existingRound = allKnockoutRounds.find(r => {
            if (isCurrentRound) return r.id === currentRound.id;
            return r.debates?.length === stage.numDebates;
        });
        
        html += `
            <div class="bracket-round">
                <h3 style="text-align: center; margin-bottom: 15px; ${isCurrentRound ? 'color: #2563eb; font-weight: 700;' : ''}">
                    ${stage.name}
                    ${isCurrentRound ? ' (Current)' : ''}
                </h3>
        `;
        
        if (existingRound) {
            // Show existing debates
            existingRound.debates.forEach(debate => {
                html += renderBracketMatch(debate);
            });
        } else {
            // Show seeded placeholders
            const debatesNeeded = stage.numDebates;
            for (let i = 0; i < debatesNeeded; i++) {
                const team1 = teams[i * 2]?.team;
                const team2 = teams[i * 2 + 1]?.team;
                
                html += `
                    <div class="bracket-match" style="opacity: ${team1 && team2 ? '1' : '0.5'};">
                        <div style="padding: 12px; color: ${team1 ? '#1e293b' : '#94a3b8'}; text-align: center; font-weight: ${team1 ? '600' : '400'};">
                            ${team1 ? teamLabel(team1) : `Seed #${i*2+1}`}
                        </div>
                        <div style="border-top: 1px solid #e2e8f0; margin: 4px 0;"></div>
                        <div style="padding: 12px; color: ${team2 ? '#1e293b' : '#94a3b8'}; text-align: center; font-weight: ${team2 ? '600' : '400'};">
                            ${team2 ? teamLabel(team2) : `Seed #${i*2+2}`}
                        </div>
                    </div>
                `;
            }
        }
        
        html += `</div>`;
    });
    
    html += `</div>`;
    
    // Add "Create Next Round" button if current round is complete and next doesn't exist
    if (currentRound.debates.every(d => d.entered) && !currentRound.nextRoundCreated) {
        html += `
            <div style="text-align: center; margin-top: 30px;">
                <button onclick="window.createNextKnockoutRound(${currentRound.id})" 
                        class="btn-primary" 
                        style="padding: 14px 32px; border-radius: 8px; font-size: 16px; background: #7c3aed;">
                    ➡️ Create ${getNextStageName(currentRound.debates.length)}
                </button>
            </div>
        `;
    }
    
    html += `</div>`;
    return html;
}

function renderBracketMatch(debate) {
    const gov = state.teams.find(t => t.id === debate.gov);
    const opp = state.teams.find(t => t.id === debate.opp);

    // New/empty room — teams not yet assigned. Render a placeholder card.
    if (!gov || !opp) {
        const isAdmin = state.auth?.currentUser?.role === 'admin';
        const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;
        return `
        <div class="draw-room pending-partial" style="background:white;border-radius:10px;border-left:4px solid #94a3b8;padding:14px;margin-bottom:10px;opacity:0.85;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <strong style="font-size:14px;color:#1e293b;">${escapeHTML(roomLabel)}</strong>
                    ${isAdmin ? `
                        <button onclick="window.renameRoom(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;" title="Rename room">✏️</button>
                        <button onclick="window.deleteDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;" title="Delete room">🗑️</button>
                        <button onclick="window.addDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;" title="Add room after this">➕</button>
                    ` : ''}
                    <span style="font-size:12px;color:#94a3b8;font-weight:600;">⚪ Unassigned</span>
                </div>
                ${isAdmin ? `<button onclick="window.showAssignTeamsModal(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 14px;font-size:12px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;">🔀 Assign Teams</button>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;">
                <div style="padding:14px;border-radius:8px;border:2px dashed #cbd5e1;text-align:center;color:#94a3b8;font-size:13px;">${gov ? escapeHTML(gov.name) : 'TBD'}</div>
                <div style="font-size:14px;font-weight:700;color:#cbd5e1;">vs</div>
                <div style="padding:14px;border-radius:8px;border:2px dashed #cbd5e1;text-align:center;color:#94a3b8;font-size:13px;">${opp ? escapeHTML(opp.name) : 'TBD'}</div>
            </div>
        </div>`;
    }
    
    const govWon = debate.entered && debate.govResults?.total > debate.oppResults?.total;
    const oppWon = debate.entered && debate.oppResults?.total > debate.govResults?.total;
    
    return `
        <div class="bracket-match ${debate.entered ? 'bracket-winner' : ''}">
            <div style="font-weight: ${govWon ? '700' : '400'}; color: ${govWon ? '#10b981' : '#1e293b'}; padding: 8px; display: flex; justify-content: space-between; background: ${govWon ? '#f0fdf4' : 'transparent'};">
                <span class="team-name">${teamLabel(gov)}</span>
                ${govWon ? '<span>🏆</span>' : ''}
            </div>
            <div style="border-top: 1px solid #e2e8f0; margin: 0 8px;"></div>
            <div style="font-weight: ${oppWon ? '700' : '400'}; color: ${oppWon ? '#10b981' : '#1e293b'}; padding: 8px; display: flex; justify-content: space-between; background: ${oppWon ? '#f0fdf4' : 'transparent'};">
                <span class="team-name">${teamLabel(opp)}</span>
                ${oppWon ? '<span>🏆</span>' : ''}
            </div>
            ${debate.entered ? `
                <div style="margin-top: 8px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px dashed #e2e8f0; padding-top: 8px;">
                    ${Math.max(govWon ? debate.govResults?.total : debate.oppResults?.total, 
                              oppWon ? debate.oppResults?.total : debate.govResults?.total).toFixed(1)} - 
                    ${Math.min(govWon ? debate.oppResults?.total : debate.govResults?.total,
                              oppWon ? debate.govResults?.total : debate.oppResults?.total).toFixed(1)}
                </div>
            ` : `
                <div style="margin-top: 8px; font-size: 11px; color: #f59e0b; text-align: center;">
                    ⏳ Results Pending
                </div>
            `}
        </div>
    `;
}

function generateAllBracketStages(startingDebates) {
    const stages = [];
    let numDebates = startingDebates;
    let roundNames = [];
    
    // Build round names from current down to final
    while (numDebates >= 1) {
        roundNames.push({
            name: getKnockoutStageName(numDebates),
            numDebates: numDebates,
            nextStage: numDebates > 1 ? getKnockoutStageName(numDebates / 2) : null
        });
        numDebates = numDebates / 2;
        if (numDebates < 1) break;
    }
    
    return roundNames;
}

function getKnockoutStageName(numDebates) {
    const stages = {
        1: 'Final',
        2: 'Semi-Finals',
        4: 'Quarter-Finals',
        8: 'Round of 16',
        16: 'Round of 32',
        32: 'Round of 64',
        64: 'Round of 128'
    };
    return stages[numDebates] || `Round of ${numDebates * 2}`;
}

function getNextStageName(currentNumDebates) {
    const nextNum = currentNumDebates / 2;
    return getKnockoutStageName(nextNum);
}


// ============================================================================
// BP DEBATE CARD — 4-team room (OG / OO / CG / CO)
// ============================================================================
function renderBPDebateCard(round, debate, roundIdx, debateIdx) {
    const positions = [
        { key:'og', label:'OG',color:'#1e40af', bg:'#eff6ff', border:'#bfdbfe' },
        { key:'oo', label:'OO',color:'#be185d', bg:'#fdf2f8', border:'#fbcfe8' },
        { key:'cg', label:'CG',color:'#065f46', bg:'#f0fdf4', border:'#86efac' },
        { key:'co', label:'CO',color:'#7c3aed', bg:'#faf5ff', border:'#e9d5ff' },
    ];

    const isAdmin  = state.auth?.currentUser?.role === 'admin';
    const isJudge  = state.auth?.currentUser?.role === 'judge';
    const myJudgeId= null;
    const isMyRoom = false;
    const isBlinded= round.blinded || false;
    const room     = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    // Build team cells — with DnD for admins on unentered rooms
    const teamCells = positions.map(pos => {
        const team = state.teams.find(t => t.id === debate[pos.key]);
        if (!team) return `<div style="padding:10px;background:#f8fafc;border-radius:8px;border:1px dashed #cbd5e1;text-align:center;color:#94a3b8;font-size:12px;">TBD</div>`;
        const rank = debate.entered && debate.bpRanks ? debate.bpRanks[pos.key] : null;
        const pts  = rank != null ? [3,2,1,0][rank-1] : null;
        const rankColors = ['#26a786','#205196','#b45309','#c52713'];
        const rankLabels = ['🥇 1st','🥈 2nd','🥉 3rd','4th'];
        const dndAttrs = (!debate.entered && isAdmin) ? `draggable="true"
            ondragstart="window.dndTeamDragStart(event,${roundIdx},${debateIdx},'${pos.key}')"
            ondragend="window.dndDragEnd(event)"
            ondragover="window.dndBPTeamDragOver(event,${roundIdx},${debateIdx},'${pos.key}')"
            ondragleave="window.dndDragLeave(event)"
            ondrop="window.dndTeamDrop(event,${roundIdx},${debateIdx},'${pos.key}')"` : '';
        return `
        <div ${dndAttrs} style="padding:10px;background:${pos.bg};border-radius:8px;border:1.5px solid ${pos.border};text-align:center;${!debate.entered&&isAdmin?'cursor:grab;':''}">
            <div style="font-size:10px;font-weight:700;color:${pos.color};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${pos.label}</div>
            <div style="font-weight:700;color:#1e293b;font-size:13px;word-break:break-word;">${teamLabel(team)}</div>
            ${rank != null && !isBlinded ? `
                <div style="margin-top:6px;font-size:12px;font-weight:700;color:${rankColors[rank-1]}">${rankLabels[rank-1]}</div>
                <div style="font-size:11px;color:#64748b;">${debate[pos.key+'Score']?.toFixed(1)||'—'} spk</div>
            ` : ''}
            ${!debate.entered && isAdmin ? '<div style="font-size:9px;color:#94a3b8;margin-top:3px;">⠿ drag to swap</div>' : ''}
        </div>`;
    }).join('');

    // Build judge chips with chair/wing roles — same as WSDC
    const availableJudges = (state.judges||[]).filter(j => !(debate.panel||[]).some(p=>p.id==j.id) && j.available !== false);
    const freeJudges  = availableJudges.filter(j => !round.debates.some((d,di)=>di!==debateIdx&&(d.panel||[]).some(p=>p.id==j.id)));
    const otherJudges = availableJudges.filter(j =>  round.debates.some((d,di)=>di!==debateIdx&&(d.panel||[]).some(p=>p.id==j.id)));

    const judgeChips = (debate.panel||[]).map(p => {
        const j = (state.judges||[]).find(j=>j.id==p.id);
        if (!j) return '';
        const isChair = p.role === 'chair';
        const roleTitle = isAdmin && !debate.entered ? (isChair ? 'Chair — click to make wing' : 'Wing — click to make chair') : p.role;
        return `<span class="dnd-judge-chip"
                    ${!debate.entered && isAdmin ? `draggable="true"
                    ondragstart="window.dndJudgeDragStart(event,'${j.id}',${roundIdx},${debateIdx})"
                    ondragend="window.dndDragEnd(event)"` : ''}>
            <span class="chip-role ${isChair?'chair':''}"
                  title="${roleTitle}"
                  ${!debate.entered && isAdmin ? `onclick="event.stopPropagation();window.toggleJudgeRole(${roundIdx},${debateIdx},'${j.id}')"` : ''}>
                ${p.role}
            </span>
            ${escapeHTML(j.name)}
            ${!debate.entered && isAdmin ? `<button class="chip-remove" onclick="window.removeJudgeFromPanel(${roundIdx},${debateIdx},'${j.id}')" title="Remove">×</button>` : ''}
        </span>`;
    }).join('');

    const addJudgeDropdown = (!debate.entered && isAdmin && availableJudges.length > 0) ? `
        <select class="judge-add-select"
                onchange="if(this.value){window.addJudgeToPanel(${roundIdx},${debateIdx},this.value);this.value=''}"
                title="Add judge to this room">
            <option value="">+ Add Judge</option>
            ${freeJudges.length?`<optgroup label="Available">${freeJudges.map(j=>`<option value="${j.id}">${escapeHTML(j.name)}${j.rating?` (${j.rating}★)`:''} (${j.role})</option>`).join('')}</optgroup>`:'' }
            ${otherJudges.length?`<optgroup label="In other rooms">${otherJudges.map(j=>`<option value="${j.id}">${escapeHTML(j.name)} ← other room</option>`).join('')}</optgroup>`:'' }
        </select>` : '';

    const statusDot   = debate.entered ? '#10b981' : (debate.panel?.length ? '#f59e0b' : '#ef4444');
    const statusLabel = debate.entered ? '✅ Done' : '⏳ Pending';

    return `
    <div class="draw-room ${debate.entered?'done':'pending-partial'}" style="background:white;border-radius:10px;border-left:4px solid ${statusDot};padding:14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-size:14px;color:#1e293b;">${escapeHTML(room)}</strong>
                ${isAdmin ? `<button onclick="window.renameRoom(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;line-height:1" title="Rename room">✏️</button><button onclick="window.deleteDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;line-height:1" title="Delete room">🗑️</button>
                <button onclick="window.addDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;line-height:1" title="Add room">➕</button>` : ''}
                <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;">BP</span>
                <span style="font-size:12px;font-weight:600;color:${debate.entered?'#10b981':'#f59e0b'}">${statusLabel}</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                ${isAdmin && !debate.entered ? `<button onclick="window.showJudgeManagement(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 10px;font-size:12px">⚖️ Panel</button>` : ''}
                ${!debate.entered && isAdmin ? `
                    <button onclick="window.showEnterResults(${roundIdx},${debateIdx})" class="btn-primary" style="padding:4px 12px;font-size:12px">Enter Results</button>
                ` : !debate.entered && isMyRoom ? `
                    <button onclick="window.showEnterResults(${roundIdx},${debateIdx})" class="btn-primary" style="padding:4px 12px;font-size:12px;background:#7c3aed">Submit Ballot</button>
                ` : debate.entered && !isBlinded ? `
                    ${isAdmin?`<button onclick="window.editResults(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 10px;font-size:12px">✏️ Edit Ballot</button>`:''}
                ` : ''}
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            ${teamCells}
        </div>
        <div class="dnd-judge-zone"
             ${!debate.entered && isAdmin ? `ondragover="window.dndJudgeDragOver(event,${roundIdx},${debateIdx})" ondragleave="window.dndDragLeave(event)" ondrop="window.dndJudgeDrop(event,${roundIdx},${debateIdx})"` : ''}
             style="background:#f8fafc;border-radius:6px;padding:6px 8px;display:flex;flex-wrap:wrap;align-items:center;gap:3px;min-height:34px;">
            <strong style="font-size:11px;font-weight:700;color:#64748b;margin-right:4px;text-transform:uppercase;letter-spacing:.04em;">Panel</strong>
            ${judgeChips || '<span style="font-size:12px;color:#ef4444;font-style:italic;">No judges assigned</span>'}
            ${addJudgeDropdown}
        </div>
    </div>`;
}

function renderDebateCard(round, debate, roundIdx, debateIdx, previousMeetings) {
    // Dispatch to BP card if this is a BP debate
    if (debate.format === 'bp')     return renderBPDebateCard(round, debate, roundIdx, debateIdx);
    if (debate.format === 'speech') return renderSpeechDebateCard(round, debate, roundIdx, debateIdx);

    const gov = state.teams.find(t => t.id === debate.gov);
    const opp = state.teams.find(t => t.id === debate.opp);
    // New/empty room — teams not yet assigned. Render a placeholder card.
    if (!gov || !opp) {
        const isAdmin = state.auth?.currentUser?.role === 'admin';
        const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;
        return `
        <div class="draw-room pending-partial" style="background:white;border-radius:10px;border-left:4px solid #94a3b8;padding:14px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <strong style="font-size:14px;color:#1e293b;">${escapeHTML(roomLabel)}</strong>
                    ${isAdmin ? `
                        <button onclick="window.renameRoom(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;" title="Rename room">✏️</button>
                        <button onclick="window.deleteDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;" title="Delete room">🗑️</button>
                        <button onclick="window.addDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;" title="Add room after this">➕</button>
                    ` : ''}
                    <span style="font-size:12px;color:#94a3b8;font-weight:600;">⚪ Unassigned</span>
                </div>
                ${isAdmin ? `<button onclick="window.showAssignTeamsModal(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 14px;font-size:12px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;">🔀 Assign Teams</button>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;">
                <div style="padding:14px;border-radius:8px;border:2px dashed #cbd5e1;text-align:center;color:#94a3b8;font-size:13px;">${gov ? escapeHTML(gov.name) : 'TBD'}</div>
                <div style="font-size:14px;font-weight:700;color:#cbd5e1;">vs</div>
                <div style="padding:14px;border-radius:8px;border:2px dashed #cbd5e1;text-align:center;color:#94a3b8;font-size:13px;">${opp ? escapeHTML(opp.name) : 'TBD'}</div>
            </div>
        </div>`;
    }

    const isAdmin   = state.auth?.currentUser?.role === 'admin';
    const isJudge   = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    const isMyRoom  = isJudge && (debate.panel || []).some(p => String(p.id) === myJudgeId);
    const isBlinded  = round.blinded || false;
    const govPresent = debate.attendance?.gov !== false;
    const oppPresent = debate.attendance?.opp !== false;
    const room       = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    let _dp = {}; try { _dp = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const displayMode = _dp['display'] || 'names';
    // Judges always see code; others see it only when not in codes mode (code already primary) and not hiding names
    const showSecondaryCode = (isJudge && !isAdmin) || (displayMode !== 'codes' && !_dp['hide-names']);

    // Judges always see real team names; everyone else uses the display preference
    const govLabel = (isJudge && !isAdmin) ? escapeHTML(gov?.name || '') : _nameLabel(gov);
    const oppLabel = (isJudge && !isAdmin) ? escapeHTML(opp?.name || '') : _nameLabel(opp);

    // Rematch detection — count only rounds that came BEFORE this one (lower id)
    // so round 2 can never show "3rd meeting" due to future pairings being included
    const priorMeetings = (state.rounds || []).filter(r => r.id < round.id).reduce((count, r) => {
        const met = (r.debates || []).some(d =>
            (d.gov === debate.gov && d.opp === debate.opp) ||
            (d.gov === debate.opp && d.opp === debate.gov)
        );
        return count + (met ? 1 : 0);
    }, 0);
    const isRepeat   = priorMeetings > 0;
    const meetingNum = priorMeetings + 1; // 2 = "2nd meeting", 3 = "3rd meeting"
    const meetingOrd = meetingNum === 2 ? '2nd' : meetingNum === 3 ? '3rd' : meetingNum + 'th';

    // Room status class
    let roomClass = 'pending-partial';
    if (debate.entered) roomClass = 'done';
    else if (!debate.panel || debate.panel.length === 0) roomClass = 'no-judges';

    // ── Inline judge zone 
    const availableJudges = (state.judges || []).filter(j => {
        if (debate.panel?.some(p => p.id == j.id)) return false; // already in panel
        return true;
    });
    const freeJudges = availableJudges.filter(j => {
        // not assigned to any other debate in this round
        const inOther = round.debates.some((d, di) => di !== debateIdx && (d.panel||[]).some(p => p.id == j.id));
        return !inOther;
    });
    const otherJudges = availableJudges.filter(j => {
        const inOther = round.debates.some((d, di) => di !== debateIdx && (d.panel||[]).some(p => p.id == j.id));
        return inOther;
    });

    const judgeChips = (debate.panel || []).map(p => {
        const j = (state.judges||[]).find(j => j.id == p.id);
        if (!j) return '';
        const conflictMap = buildConflictMap(state.judges);
        const conflict = hasConflict(conflictMap, j.id, debate.gov) || hasConflict(conflictMap, j.id, debate.opp);
        const isChair = p.role === 'chair';
        const roleTitle = isAdmin && !debate.entered ? (isChair ? 'Chair — click to make wing' : 'Wing — click to make chair') : p.role;
        return `<span class="dnd-judge-chip" ${conflict?'style="border-color:#f59e0b;background:#fffbeb"':''}
                    ${!debate.entered && isAdmin ? `draggable="true"
                    ondragstart="window.dndJudgeDragStart(event,'${j.id}',${roundIdx},${debateIdx})"
                    ondragend="window.dndDragEnd(event)"` : ''}>
            <span class="chip-role ${isChair?'chair':''}"
                  title="${roleTitle}"
                  ${!debate.entered && isAdmin ? `onclick="event.stopPropagation();window.toggleJudgeRole(${roundIdx},${debateIdx},'${j.id}')"` : ''}>
                ${p.role}
            </span>
            ${escapeHTML(j.name)}${conflict?' ⚠️':''}
            ${!debate.entered && isAdmin ? `<button class="chip-remove" onclick="window.removeJudgeFromPanel(${roundIdx},${debateIdx},'${j.id}')" title="Remove">×</button>` : ''}
        </span>`;
    }).join('');

    // Build judge add dropdown
    const addJudgeDropdown = (!debate.entered && isAdmin && availableJudges.length > 0) ? `
        <select class="judge-add-select"
                onchange="if(this.value){window.addJudgeToPanel(${roundIdx},${debateIdx},this.value);this.value=''}"
                title="Add judge to this room">
            <option value="">+ Add Judge</option>
            ${freeJudges.length ? `<optgroup label="Available">
                ${freeJudges.map(j => {
                    const conflictMap = buildConflictMap(state.judges);
                    const c = hasConflict(conflictMap, j.id, debate.gov) || hasConflict(conflictMap, j.id, debate.opp);
                    return `<option value="${j.id}" ${c?'style="color:#ef4444"':''}>${escapeHTML(j.name)} (${j.role})${c?' ⚠️':''}</option>`;
                }).join('')}
            </optgroup>` : ''}
            ${otherJudges.length ? `<optgroup label="In other rooms">
                ${otherJudges.map(j => {
                    const conflictMap = buildConflictMap(state.judges);
                    const c = hasConflict(conflictMap, j.id, debate.gov) || hasConflict(conflictMap, j.id, debate.opp);
                    return `<option value="${j.id}" ${c?'style="color:#ef4444"':''}>${escapeHTML(j.name)} (${j.role})${c?' ⚠️':''}</option>`;
                }).join('')}
            </optgroup>` : ''}
        </select>` : '';

    return `
    <div class="draw-room ${roomClass}">
        <!-- Room header row -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <strong style="font-size:14px;color:#1e293b">${escapeHTML(room)}</strong>
                ${isAdmin ? `<button onclick="window.renameRoom(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;line-height:1" title="Rename room">✏️</button><button onclick="window.deleteDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;line-height:1" title="Delete room">🗑️</button>
                <button onclick="window.addDebate(${roundIdx},${debateIdx})" style="background:none;border:none;cursor:pointer;padding:0 4px;font-size:13px;color:#94a3b8;line-height:1" title="Add room">➕</button>` : ''}
                ${isRepeat?`<span style="background:#f97316;color:white;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;box-shadow:0 1px 4px rgba(249,115,22,0.4)">🔄 ${meetingOrd} meeting</span>`:''}
                ${!govPresent||!oppPresent?'<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">⚠️ Absent</span>':''}
                ${debate.sidesPending?'<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">✋ Sides Pending</span>':''}
                ${debate.entered?'<span style="color:#10b981;font-size:12px;font-weight:600">✅ Done</span>':'<span style="color:#f59e0b;font-size:12px;font-weight:600">⏳ Pending</span>'}
                <!-- Judge allocation pill — always visible 
                 ${_judgePillHtml(debate)}-->             
            </div>
            <!-- Action buttons - compact row -->
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                ${!debate.entered && isAdmin ? `
                <button onclick="window.swapTeams(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 10px;font-size:12px" title="Swap sides">⇄</button>
                <button onclick="window.showMoveTeamModal(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 10px;font-size:12px" title="Move team to another room">↔</button>
                <button onclick="window.showEnterResults(${roundIdx},${debateIdx})" class="btn-primary" style="padding:4px 12px;font-size:12px"
                        ${!govPresent||!oppPresent?'disabled':''}>Enter Results</button>
                ` : !debate.entered && isMyRoom ? `
                <button onclick="window.showEnterResults(${roundIdx},${debateIdx})" class="btn-primary" style="padding:4px 12px;font-size:12px;background:#7c3aed"
                        ${!govPresent||!oppPresent?'disabled title="Both teams must be present"':''}>Submit Ballot</button>
                ` : debate.entered && !isBlinded ? `
                <button onclick="window.viewDebateDetails(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 10px;font-size:12px">📊 Details</button>
                ${isAdmin?`<button onclick="window.editResults(${roundIdx},${debateIdx})" class="btn-secondary" style="padding:4px 10px;font-size:12px">✏️ Edit Result</button>`:''}
                ` : ''}
            </div>
        </div>

        <!-- Teams row -->
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin-bottom:10px">
            <!-- Government -->
            <div class="${!debate.entered && isAdmin ? 'dnd-team-zone dnd-team-chip' : ''}"
                 data-zone-type="team" data-zone-side="gov"
                 data-round="${roundIdx}" data-debate="${debateIdx}"
                 ${!debate.entered && isAdmin ? `draggable="true"
                 ondragstart="window.dndTeamDragStart(event,${roundIdx},${debateIdx},'gov')"
                 ondragend="window.dndDragEnd(event)"
                 ondragover="window.dndTeamDragOver(event,${roundIdx},${debateIdx},'gov')"
                 ondragleave="window.dndDragLeave(event)"
                 ondrop="window.dndTeamDrop(event,${roundIdx},${debateIdx},'gov')"` : ''}
                 style="text-align:center;padding:10px;background:${debate.entered&&debate.govResults?.total>debate.oppResults?.total?'#d1fae5':govPresent?'white':'#fee2e2'};border-radius:8px;border:1px solid ${!govPresent?'#fca5a5':'#e2e8f0'}">
                <div style="display:flex;justify-content:center;align-items:center;gap:6px">
                    <span style="font-size:10px;color:#1e40af;font-weight:700;background:#dbeafe;padding:1px 6px;border-radius:8px">GOV</span>
                    <strong style="font-size:14px;color:#1e293b">${govLabel}</strong>
                    ${!debate.entered && !isBlinded && isAdmin ? `
                    <button onclick="window.toggleAttendance(${roundIdx},${debateIdx},'gov')"
                            style="padding:1px 6px;font-size:11px;border-radius:4px;border:1px solid #cbd5e1;background:white;cursor:pointer"
                            title="${govPresent?'Mark absent':'Mark present'}">${govPresent?'✓':'✗'}</button>` : ''}
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:2px">${showSecondaryCode ? teamCode(gov) : ''}</div>
                ${debate.entered && !isBlinded ? `<div style="font-size:17px;font-weight:700;color:#1e293b;margin-top:4px">${debate.govResults?.total?.toFixed(1)||'?'}</div>` : ''}
                ${debate.entered&&debate.govResults?.total>debate.oppResults?.total?'<div style="font-size:11px;color:#10b981;margin-top:2px">🏆 Winner</div>':''}
                ${!debate.entered&&isAdmin?'<div style="font-size:10px;color:#94a3b8;margin-top:3px">⠿ drag</div>':''}
            </div>

            <div style="text-align:center;font-weight:700;color:#94a3b8;font-size:13px">VS</div>

            <!-- Opposition -->
            <div class="${!debate.entered && isAdmin ? 'dnd-team-zone dnd-team-chip' : ''}"
                 data-zone-type="team" data-zone-side="opp"
                 data-round="${roundIdx}" data-debate="${debateIdx}"
                 ${!debate.entered && isAdmin ? `draggable="true"
                 ondragstart="window.dndTeamDragStart(event,${roundIdx},${debateIdx},'opp')"
                 ondragend="window.dndDragEnd(event)"
                 ondragover="window.dndTeamDragOver(event,${roundIdx},${debateIdx},'opp')"
                 ondragleave="window.dndDragLeave(event)"
                 ondrop="window.dndTeamDrop(event,${roundIdx},${debateIdx},'opp')"` : ''}
                 style="text-align:center;padding:10px;background:${debate.entered&&debate.oppResults?.total>debate.govResults?.total?'#d1fae5':oppPresent?'white':'#fee2e2'};border-radius:8px;border:1px solid ${!oppPresent?'#fca5a5':'#e2e8f0'}">
                <div style="display:flex;justify-content:center;align-items:center;gap:6px">
                    <span style="font-size:10px;color:#be185d;font-weight:700;background:#fce7f3;padding:1px 6px;border-radius:8px">OPP</span>
                    <strong style="font-size:14px;color:#1e293b">${oppLabel}</strong>
                    ${!debate.entered && !isBlinded && isAdmin ? `
                    <button onclick="window.toggleAttendance(${roundIdx},${debateIdx},'opp')"
                            style="padding:1px 6px;font-size:11px;border-radius:4px;border:1px solid #cbd5e1;background:white;cursor:pointer"
                            title="${oppPresent?'Mark absent':'Mark present'}">${oppPresent?'✓':'✗'}</button>` : ''}
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:2px">${showSecondaryCode ? teamCode(opp) : ''}</div>
                ${debate.entered && !isBlinded ? `<div style="font-size:17px;font-weight:700;color:#1e293b;margin-top:4px">${debate.oppResults?.total?.toFixed(1)||'?'}</div>` : ''}
                ${debate.entered&&debate.oppResults?.total>debate.govResults?.total?'<div style="font-size:11px;color:#10b981;margin-top:2px">🏆 Winner</div>':''}
                ${!debate.entered&&isAdmin?'<div style="font-size:10px;color:#94a3b8;margin-top:3px">⠿ drag</div>':''}
            </div>
        </div>

        <!-- Judge zone — inline chips + add dropdown -->
        <div class="dnd-judge-zone"
             data-round="${roundIdx}" data-debate="${debateIdx}"
             ${!debate.entered && isAdmin ? `
             ondragover="window.dndJudgeDragOver(event,${roundIdx},${debateIdx})"
             ondragleave="window.dndDragLeave(event)"
             ondrop="window.dndJudgeDrop(event,${roundIdx},${debateIdx})"` : ''}
             style="background:white;border-radius:6px;padding:5px 8px;margin-top:4px">
            <span class="draw-panel-label">Panel</span>
            ${judgeChips || '<span style="font-size:12px;color:#94a3b8;font-style:italic">No judges assigned</span>'}
            ${addJudgeDropdown}
        </div>
    </div>`;
}


export function toggleBlindRound(roundIdx) {
    const round = state.rounds[roundIdx];
    if (!round) return;
    
    round.blinded = !round.blinded;
    saveNow();
    displayRounds();
    renderStandings();
    
    showNotification(
        round.blinded ? 'Round blinded - results hidden from teams' : 'Round unblinded - results visible',
        'success'
    );
}

// ============================================
// REDRAW ROUND (SWAP TEAMS)
// ============================================

export function redrawRound(roundIdx) {
    const round = state.rounds[roundIdx];
    if (!round) return;
    
    // Check if any results entered
    if (round.debates.some(d => d.entered)) {
        showNotification('Cannot redraw round after results have been entered', 'error');
        return;
    }
    
    if (!confirm('Are you sure you want to redraw this round? This will create new matchups.')) {
        return;
    }
    
    const isKnockout = round.type === 'knockout';
    const activeTeams = state.teams.filter(t => !t.eliminated);
    
    let debates = [];
    let pairs = [];
    let teamsCopy = [...activeTeams];

    if (isKnockout) {
        // Re-apply knockout bracket fold
        teamsCopy.sort((a, b) => (b.wins || 0) - (a.wins || 0) || (b.total || 0) - (a.total || 0));
        if (teamsCopy.length % 2 !== 0) teamsCopy.pop();
        const half = Math.floor(teamsCopy.length / 2);
        const top = teamsCopy.slice(0, half);
        const bottom = teamsCopy.slice(half).reverse();
        for (let i = 0; i < top.length; i++) pairs.push([top[i], bottom[i]]);
    } else {
        // Fisher-Yates shuffle for truly random prelim pairings
        for (let i = teamsCopy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [teamsCopy[i], teamsCopy[j]] = [teamsCopy[j], teamsCopy[i]];
        }
        if (teamsCopy.length % 2 !== 0) teamsCopy.pop();
        for (let i = 0; i < teamsCopy.length; i += 2) pairs.push([teamsCopy[i], teamsCopy[i + 1]]);
    }

    // Always use random sides on redraw
    pairs.forEach(([teamA, teamB]) => {
        const govFirst = Math.random() < 0.5;
        debates.push({
            gov: govFirst ? teamA.id : teamB.id,
            opp: govFirst ? teamB.id : teamA.id,
            entered: false,
            panel: [],
            attendance: { gov: true, opp: true }
        });
    });
    
    // Re-allocate judges
    allocateJudgesToDebates(debates, isKnockout);
    
    round.debates = debates;
    // Reset rooms to default names so stale custom names don't persist
    round.rooms = debates.map((_, i) => `Room ${i + 1}`);
    saveNow();
    displayRounds();
    
    showNotification(isKnockout ? 'Round redrawn with bracket seeding' : '🎲 Round redrawn with fresh random pairings', 'success');
}

// ============================================
// SWAP TEAMS IN DEBATE
// ============================================

export function swapTeams(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    
    if (debate.entered) {
        showNotification('Cannot swap teams after results entered', 'error');
        return;
    }
    
    // Swap government and opposition
    [debate.gov, debate.opp] = [debate.opp, debate.gov];
    
    // Also swap attendance if tracked
    if (debate.attendance) {
        [debate.attendance.gov, debate.attendance.opp] = [debate.attendance.opp, debate.attendance.gov];
    }

    // Clear sidesPending flag — user has explicitly set sides now
    debate.sidesPending = false;
    
    saveNow();
    displayRounds();
    showNotification('Teams swapped successfully', 'success');
}

// ============================================
// MOVE TEAM ACROSS ROOMS
// ============================================

function showMoveTeamModal(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];

    if (debate.entered) {
        showNotification('Cannot move teams after results are entered', 'error');
        return;
    }

    const gov = state.teams.find(t => t.id === debate.gov);
    const opp = state.teams.find(t => t.id === debate.opp);

    // If room is empty or only partially assigned, use the full assign modal instead
    if (!gov || !opp) {
        showAssignTeamsModal(roundIdx, debateIdx);
        return;
    }

    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    // Teams not assigned to any debate in this round (free pool)
    // Use String() normalisation to avoid number/string ID type mismatches
    const sid = v => (v === null || v === undefined) ? null : String(v);
    const assignedIds = new Set(round.debates.flatMap(d => [d.gov, d.opp].filter(Boolean).map(sid)));
    const freeTeams = state.teams.filter(t => !assignedIds.has(sid(t.id)));

    // Other rooms available to swap with
    const otherRooms = round.debates
        .map((d, idx) => ({ d, idx }))
        .filter(({ d, idx }) => idx !== debateIdx && !d.entered);

    if (otherRooms.length === 0 && freeTeams.length === 0) {
        showNotification('No other rooms or unassigned teams available', 'info');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px;';

    modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 580px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
                <h2 style="margin: 0 0 4px 0; color: #1e293b;">↔ Move Team to Another Room</h2>
                <p style="margin: 0; color: #64748b; font-size: 14px;">
                    <strong>${escapeHTML(roomLabel)}</strong>: ${escapeHTML(gov.name)} <span style="color: #94a3b8;">vs</span> ${escapeHTML(opp.name)}
                </p>
            </div>

            <div style="padding: 24px;">
                <p style="margin: 0 0 16px 0; color: #475569; font-size: 14px;">
                    Select a team from this room and a target room. The selected team will swap places with one team from the target room.
                </p>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #1e293b; font-size: 14px;">Team to Move</label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <label style="display: flex; align-items: center; gap: 10px; padding: 14px; background: #eff6ff; border: 2px solid #bfdbfe; border-radius: 10px; cursor: pointer;">
                            <input type="radio" name="move-team" value="gov" style="accent-color: #3b82f6;">
                            <div>
                                <div style="font-weight: 600; color: #1e40af;">${escapeHTML(gov.name)}</div>
                                <div style="font-size: 11px; color: #64748b;">Currently Gov</div>
                            </div>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; padding: 14px; background: #fdf2f8; border: 2px solid #fbcfe8; border-radius: 10px; cursor: pointer;">
                            <input type="radio" name="move-team" value="opp" style="accent-color: #be185d;">
                            <div>
                                <div style="font-weight: 600; color: #be185d;">${escapeHTML(opp.name)}</div>
                                <div style="font-size: 11px; color: #64748b;">Currently Opp</div>
                            </div>
                        </label>
                    </div>
                </div>

                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #1e293b; font-size: 14px;">Target Room</label>
                    <select id="move-target-room" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 14px;">
                        <option value="">— Select target —</option>
                        ${freeTeams.length ? `<optgroup label="Unassigned Teams (no swap needed)">` + freeTeams.map(t => `<option value="free:${t.id}">⚪ ${escapeHTML(t.name)} (unassigned)</option>`).join('') + `</optgroup>` : ''}
                        ${otherRooms.length ? `<optgroup label="Swap with another room">` + otherRooms.map(({ d, idx }) => {
                            const tGov = state.teams.find(t => t.id === d.gov);
                            const tOpp = state.teams.find(t => t.id === d.opp);
                            const rLabel = round.rooms?.[idx] || `Room ${idx + 1}`;
                            return `<option value="${idx}">${escapeHTML(rLabel)}: ${escapeHTML(tGov?.name || '?')} vs ${escapeHTML(tOpp?.name || '?')}</option>`;
                        }).join('') + `</optgroup>` : ''}
                    </select>
                </div>

                <div id="move-target-side-row" style="display: none; margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #1e293b; font-size: 14px;">Which team do they replace?</label>
                    <select id="move-target-side" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 14px;">
                        <option value="gov">Replace Gov team (they become Gov)</option>
                        <option value="opp">Replace Opp team (they become Opp)</option>
                    </select>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #64748b;">
                        The displaced team will move to <strong>${escapeHTML(roomLabel)}</strong> and take the vacant side.
                    </p>
                </div>

                <div id="move-preview" style="display: none; padding: 14px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; font-size: 13px; color: #166534; margin-bottom: 16px;"></div>
            </div>

            <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                <button onclick="window.closeAllModals()" class="btn-secondary" style="padding: 10px 20px; border-radius: 8px;">
                    Cancel
                </button>
                <button onclick="window.executeMoveTeam(${roundIdx}, ${debateIdx})" class="btn-primary" style="padding: 10px 24px; border-radius: 8px; font-weight: 600;">
                    Confirm Move
                </button>
            </div>
        </div>
    `;

    // Show side selector when target room is chosen and update preview
    function updateMovePreview() {
        const targetVal  = document.getElementById('move-target-room')?.value || '';
        const targetIdx  = parseInt(targetVal);
        const teamSide   = document.querySelector('input[name="move-team"]:checked')?.value;
        const targetSide = document.getElementById('move-target-side')?.value;
        const sideRow    = document.getElementById('move-target-side-row');
        const preview    = document.getElementById('move-preview');

        // Free-team selection: no side row or swap preview needed
        if (targetVal.startsWith('free:')) {
            sideRow.style.display = 'none';
            preview.style.display = 'block';
            const freeId   = targetVal.slice(5);
            const freeTeam = state.teams.find(t => t.id === freeId || String(t.id) === freeId);
            const movingSide = teamSide || '?';
            const movingTeam = teamSide ? state.teams.find(t => t.id === debate[teamSide]) : null;
            preview.innerHTML = `<strong>Preview:</strong><br>• <strong>${escapeHTML(freeTeam?.name || '?')}</strong> joins ${escapeHTML(roomLabel)} as <strong>${movingSide}</strong> (replacing ${escapeHTML(movingTeam?.name || '?')})`;
            return;
        }

        if (!isNaN(targetIdx) && targetVal !== '') {
            sideRow.style.display = 'block';
        } else {
            sideRow.style.display = 'none';
            preview.style.display = 'none';
            return;
        }

        if (!teamSide || !targetSide || isNaN(targetIdx)) {
            preview.style.display = 'none';
            return;
        }

        const targetDebate = round.debates[targetIdx];
        const movingTeam = state.teams.find(t => t.id === debate[teamSide]);
        const displacedTeam = state.teams.find(t => t.id === targetDebate[targetSide]);
        const vacatedSide = teamSide; // side left behind in source room
        const targetRoomLabel = round.rooms?.[targetIdx] || `Room ${targetIdx + 1}`;

        preview.style.display = 'block';
        preview.innerHTML = `
            <strong>Preview:</strong><br>
            • <strong>${escapeHTML(movingTeam?.name || '?')}</strong> → ${escapeHTML(targetRoomLabel)} as <strong>${targetSide}</strong><br>
            • <strong>${escapeHTML(displacedTeam?.name || '?')}</strong> → ${escapeHTML(roomLabel)} as <strong>${vacatedSide}</strong>
        `;
    }

    modal.addEventListener('change', updateMovePreview);
    modal.addEventListener('click', e => { if (e.target === modal) closeAllModals(); });
    document.body.appendChild(modal);
}


// ============================================================================
// ASSIGN TEAMS MODAL
// ============================================================================
function showAssignTeamsModal(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    if (!round) return;
    const debate = round.debates[debateIdx];
    if (!debate) return;
    if (debate.entered) {
        showNotification('Cannot reassign teams after results are entered', 'error');
        return;
    }

    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    // ── Normalise IDs to strings for safe comparison ─────────────────────────
    const sid = v => (v === null || v === undefined) ? null : String(v);

    const currentGovId = sid(debate.gov);
    const currentOppId = sid(debate.opp);
    const currentGov   = state.teams.find(t => sid(t.id) === currentGovId);
    const currentOpp   = state.teams.find(t => sid(t.id) === currentOppId);

    // ── Collect every team slot occupied in this round (by other rooms) ───────

    const occupiedElsewhere = []; // { team, rLabel, dIdx, side }
    round.debates.forEach((d, dIdx) => {
        if (dIdx === debateIdx) return;         // skip THIS room
        if (d.entered) return;                  // skip locked rooms
        const rLabel = round.rooms?.[dIdx] || `Room ${dIdx + 1}`;
        ['gov', 'opp'].forEach(side => {
            const tId = sid(d[side]);
            if (!tId) return;
            const team = state.teams.find(t => sid(t.id) === tId);
            if (team) occupiedElsewhere.push({ team, rLabel, dIdx, side });
        });
    });

    // ── Truly unassigned: in state.teams but not in ANY debate slot ───────────
    const allOccupied = new Set(
        round.debates.flatMap(d => ['gov','opp'].map(s => sid(d[s])).filter(Boolean))
    );
    const unassigned = state.teams.filter(t => !allOccupied.has(sid(t.id)));

    // ── Build <option> list for one slot ─────────────────────────────────────
    // currentTeam : team object currently in THIS slot (show as "Keep")
    // excludeId   : the other slot's team (hide from list to prevent duplicates)
    function buildOptions(currentTeam, excludeId) {
        let opts = `<option value="">— Select team —</option>`;

        // Keep current
        if (currentTeam) {
            opts += `<option value="keep:${sid(currentTeam.id)}" selected>` +
                    `✔ Keep current: ${escapeHTML(currentTeam.name)}</option>`;
        }

        // Unassigned pool
        const freeList = unassigned.filter(t => sid(t.id) !== excludeId);
        if (freeList.length) {
            opts += `<optgroup label="⚪ Unassigned teams">`;
            freeList.forEach(t => {
                opts += `<option value="free:${sid(t.id)}">${escapeHTML(t.name)}</option>`;
            });
            opts += `</optgroup>`;
        }

        // Teams already in other rooms
        const moveList = occupiedElsewhere.filter(({ team }) => sid(team.id) !== excludeId
            && sid(team.id) !== sid(currentTeam?.id));
        if (moveList.length) {
            opts += `<optgroup label="↔ Move from another room (swaps their slot)">`;
            moveList.forEach(({ team, rLabel, dIdx, side }) => {
                opts += `<option value="move:${sid(team.id)}:${dIdx}:${side}">` +
                        `${escapeHTML(team.name)} ← ${escapeHTML(rLabel)} (${side})</option>`;
            });
            opts += `</optgroup>`;
        }

        if (!currentTeam && !freeList.length && !moveList.length) {
            opts += `<option disabled>No teams available</option>`;
        }

        return opts;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;' +
        'z-index:9999;padding:20px;';

    modal.innerHTML = `
        <div style="background:white;border-radius:16px;max-width:540px;width:100%;
                    max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:24px;border-bottom:1px solid #e2e8f0;">
                <h2 style="margin:0 0 4px 0;color:#1e293b;">🔀 Assign Teams — ${escapeHTML(roomLabel)}</h2>
                <p style="margin:0;color:#64748b;font-size:14px;">
                    Assign from the free pool or move any team from an existing room.
                    Moved teams will swap with whatever was in this room's slot (or leave it empty).
                </p>
            </div>
            <div style="padding:24px;display:flex;flex-direction:column;gap:20px;">
                <div>
                    <label style="display:block;margin-bottom:8px;font-weight:600;
                                  color:#1e293b;font-size:14px;">🔵 Government (Proposition)</label>
                    <select id="assign-gov" style="width:100%;padding:12px;border-radius:8px;
                                                   border:1.5px solid #bfdbfe;font-size:14px;background:#eff6ff;">
                        ${buildOptions(currentGov, currentOppId)}
                    </select>
                </div>
                <div>
                    <label style="display:block;margin-bottom:8px;font-weight:600;
                                  color:#1e293b;font-size:14px;">🔴 Opposition</label>
                    <select id="assign-opp" style="width:100%;padding:12px;border-radius:8px;
                                                   border:1.5px solid #fbcfe8;font-size:14px;background:#fdf2f8;">
                        ${buildOptions(currentOpp, currentGovId)}
                    </select>
                </div>
                <div id="assign-warning" style="display:none;padding:10px 14px;
                     background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;
                     font-size:13px;color:#92400e;"></div>
            </div>
            <div style="padding:16px 24px;border-top:1px solid #e2e8f0;
                        display:flex;justify-content:space-between;align-items:center;">
                <button onclick="window.closeAllModals()" class="btn-secondary"
                        style="padding:10px 20px;border-radius:8px;">Cancel</button>
                <button onclick="window.executeAssignTeams(${roundIdx},${debateIdx})"
                        class="btn-primary" style="padding:10px 24px;border-radius:8px;font-weight:600;">
                    ✅ Confirm Assignment
                </button>
            </div>
        </div>
    `;

    // Warn if same team selected for both slots
    modal.addEventListener('change', () => {
        const gv = document.getElementById('assign-gov')?.value || '';
        const ov = document.getElementById('assign-opp')?.value || '';
        // encoded as "type:teamId:..." — extract the teamId part
        const gId = gv.split(':')[1];
        const oId = ov.split(':')[1];
        const warn = document.getElementById('assign-warning');
        if (!warn) return;
        if (gId && oId && gId === oId) {
            warn.style.display = 'block';
            warn.textContent   = '⚠️ Gov and Opp cannot be the same team.';
        } else {
            warn.style.display = 'none';
        }
    });

    modal.addEventListener('click', e => { if (e.target === modal) closeAllModals(); });
    document.body.appendChild(modal);
}

function executeAssignTeams(roundIdx, debateIdx) {
    const round  = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    const sid    = v => (v === null || v === undefined) ? null : String(v);

    const govVal = document.getElementById('assign-gov')?.value || '';
    const oppVal = document.getElementById('assign-opp')?.value || '';

    if (!govVal || !oppVal) {
        showNotification('Please select both Gov and Opp teams', 'error');
        return;
    }

    // Decode "type:teamId" or "type:teamId:srcDIdx:srcSide"
    function parse(val) {
        const p = val.split(':');
        return {
            type:     p[0],
            strId:    p[1],                                         // string ID from option value
            srcDIdx:  p[2] !== undefined ? parseInt(p[2]) : null,
            srcSide:  p[3] || null
        };
    }

    const govParsed = parse(govVal);
    const oppParsed = parse(oppVal);

    if (govParsed.strId === oppParsed.strId) {
        showNotification('Gov and Opp cannot be the same team', 'error');
        return;
    }

    // Resolve the ACTUAL team object (preserves original id type — number or string)
    function resolveTeam(strId) {
        return state.teams.find(t => sid(t.id) === strId) || null;
    }

    const govTeam = resolveTeam(govParsed.strId);
    const oppTeam = resolveTeam(oppParsed.strId);

    // What was previously in each slot of THIS room
    const prevGovId = debate.gov;  // original type preserved
    const prevOppId = debate.opp;

    // For "move" type: vacate the source room's slot.
    // Put THIS room's previous occupant into the vacated slot (swap logic).
    function applyMove(parsed, prevOccupantId) {
        if (parsed.type !== 'move') return;
        const srcDebate = round.debates[parsed.srcDIdx];
        if (!srcDebate || srcDebate.entered) return;
        // The moved team's old slot gets this room's previous occupant (or null)
        srcDebate[parsed.srcSide] = prevOccupantId ?? null;
        if (!srcDebate.attendance) srcDebate.attendance = { gov: true, opp: true };
        srcDebate.attendance[parsed.srcSide] = true;
        srcDebate.sidesPending = false;
    }

    // Handle "keep" — don't touch anything for that slot
    if (govParsed.type !== 'keep') applyMove(govParsed, prevGovId);
    if (oppParsed.type !== 'keep') applyMove(oppParsed, prevOppId);

    // Write back using the REAL team id (not the string from the option)
    debate.gov = govParsed.type === 'keep' ? prevGovId : (govTeam?.id ?? null);
    debate.opp = oppParsed.type === 'keep' ? prevOppId : (oppTeam?.id ?? null);

    if (!debate.attendance) debate.attendance = { gov: true, opp: true };
    debate.attendance.gov = true;
    debate.attendance.opp = true;
    debate.sidesPending   = round.sideMethod === 'manual';

    saveNow();
    closeAllModals();
    displayRounds();
    showNotification(
        `✅ Teams assigned to ${round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`}`,
        'success'
    );
}

export function executeMoveTeam(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    const srcDebate = round.debates[debateIdx];

    const movingSide = document.querySelector('input[name="move-team"]:checked')?.value;
    const targetVal  = document.getElementById('move-target-room')?.value;
    const targetSide = document.getElementById('move-target-side')?.value;

    if (!movingSide) { showNotification('Select a team to move', 'error'); return; }
    if (!targetVal)  { showNotification('Select a target room or unassigned team', 'error'); return; }

    const movingTeamId  = srcDebate[movingSide];
    const movingTeam    = state.teams.find(t => t.id === movingTeamId);
    const srcRoomLabel  = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    // ── Case 1: replacing with an unassigned (free) team 
    if (targetVal.startsWith('free:')) {
        const freeStrId  = targetVal.slice(5);
        const freeTeam   = state.teams.find(t => String(t.id) === freeStrId);
        if (!freeTeam) { showNotification('Team not found', 'error'); return; }

        // Moving team leaves source room (slot becomes null); free team takes its place
        srcDebate[movingSide] = freeTeam.id;

        if (!srcDebate.attendance) srcDebate.attendance = { gov: true, opp: true };
        srcDebate.attendance[movingSide] = true;
        srcDebate.sidesPending = false;

        saveNow();
        closeAllModals();
        displayRounds();
        showNotification(`✅ ${movingTeam?.name} removed · ${freeTeam.name} → ${srcRoomLabel} as ${movingSide}`, 'success');
        return;
    }

    // ── Case 2: swap with a team in another room
    if (!targetSide) { showNotification('Select which team to replace in the target room', 'error'); return; }

    const targetIdx  = parseInt(targetVal);
    const tgtDebate  = round.debates[targetIdx];

    if (!tgtDebate || tgtDebate.entered) { showNotification('Target room results already entered', 'error'); return; }

    const displacedTeamId = tgtDebate[targetSide];

    // Swap
    tgtDebate[targetSide] = movingTeamId;
    srcDebate[movingSide] = displacedTeamId;

    if (!srcDebate.attendance) srcDebate.attendance = { gov: true, opp: true };
    if (!tgtDebate.attendance) tgtDebate.attendance = { gov: true, opp: true };
    srcDebate.attendance[movingSide] = true;
    tgtDebate.attendance[targetSide] = true;
    srcDebate.sidesPending = false;
    tgtDebate.sidesPending = false;

    saveNow();
    closeAllModals();
    displayRounds();

    const displacedTeam   = state.teams.find(t => t.id === displacedTeamId);
    const targetRoomLabel = round.rooms?.[targetIdx] || `Room ${targetIdx + 1}`;
    showNotification(`✅ ${movingTeam?.name} → ${targetRoomLabel}, ${displacedTeam?.name} → ${srcRoomLabel}`, 'success');
}

// ============================================
// DRAG AND DROP ENGINE
// ============================================

// Shared drag state — stored on window so inline handlers can read it
// (innerHTML string templates cannot close over local variables)
window._dnd = {
    type: null,       // 'judge' | 'team'
    judgeId: null,    // judge being dragged
    fromRound: null,  // source round index
    fromDebate: null, // source debate index
    fromSide: null,   // 'gov' | 'opp' (teams only)
};

// ── Generic helpers 

export function dndDragEnd(event) {
    event.target.classList.remove('dragging');
    // Clear all drop-zone highlights
    document.querySelectorAll('.dnd-judge-zone, .dnd-team-zone').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-conflict', 'drag-over-warn');
    });
    window._dnd = { type: null, judgeId: null, fromRound: null, fromDebate: null, fromSide: null };
}

export function dndDragLeave(event) {
    // Only clear if leaving the zone itself (not a child)
    if (!event.currentTarget.contains(event.relatedTarget)) {
        event.currentTarget.classList.remove('drag-over', 'drag-over-conflict', 'drag-over-warn');
    }
}

// ── JUDGE drag handlers 

export function dndJudgeDragStart(event, judgeId, fromRound, fromDebate) {
    window._dnd = { type: 'judge', judgeId, fromRound, fromDebate, fromSide: null };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', judgeId); // required for Firefox
    event.currentTarget.classList.add('dragging');
}

export function dndJudgeDragOver(event, toRound, toDebate) {
    if (window._dnd.type !== 'judge') return;
    event.preventDefault();

    const zone = event.currentTarget;
    zone.classList.remove('drag-over', 'drag-over-conflict', 'drag-over-promote');

    const round = state.rounds[toRound];
    const debate = round?.debates[toDebate];
    if (!debate) return;

    const panelEntry = (debate.panel || []).find(p => String(p.id) === String(window._dnd.judgeId));
    if (panelEntry) {
        // Same panel — show "promote to chair" indicator only if they're currently a wing
        if (panelEntry.role !== 'chair' && debate.panel.length > 1) {
            zone.classList.add('drag-over-promote');
            event.dataTransfer.dropEffect = 'move';
        }
        return;
    }

    const conflictMap = buildConflictMap(state.judges);
    const conflict = hasConflict(conflictMap, window._dnd.judgeId, debate.gov) ||
                     hasConflict(conflictMap, window._dnd.judgeId, debate.opp);
    zone.classList.add(conflict ? 'drag-over-conflict' : 'drag-over');
    event.dataTransfer.dropEffect = 'move';
}

export function dndJudgeDrop(event, toRound, toDebate) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over', 'drag-over-conflict', 'drag-over-promote');

    const { judgeId, fromRound, fromDebate } = window._dnd;
    if (!judgeId || window._dnd.type !== 'judge') return;

    const round      = state.rounds[toRound];
    const toDebateObj = round?.debates[toDebate];
    if (!toDebateObj || toDebateObj.entered) {
        showNotification('Cannot move judge — target room results already entered', 'error');
        return;
    }

    const judge = (state.judges || []).find(j => String(j.id) === String(judgeId));

    // ── Same room: promote dropped judge to chair ─────────────────────────────
    if (fromRound === toRound && fromDebate === toDebate) {
        const entry = (toDebateObj.panel || []).find(p => String(p.id) === String(judgeId));
        if (entry && entry.role !== 'chair' && toDebateObj.panel.length > 1) {
            toDebateObj.panel.forEach(p => { if (p.role === 'chair') p.role = 'wing'; });
            entry.role = 'chair';
            saveNow();
            displayRounds();
            showNotification(`${judge?.name || 'Judge'} promoted to chair`, 'success');
        }
        return;
    }

    // ── Cross-room move ───────────────────────────────────────────────────────
    const fromDebateObj = state.rounds[fromRound]?.debates[fromDebate];
    const toRoomLabel   = round.rooms?.[toDebate]  || `Room ${toDebate + 1}`;
    const fromRoomLabel = state.rounds[fromRound]?.rooms?.[fromDebate] || `Room ${fromDebate + 1}`;

    const conflictMap = buildConflictMap(state.judges);
    const conflict = hasConflict(conflictMap, judgeId, toDebateObj.gov) ||
                     hasConflict(conflictMap, judgeId, toDebateObj.opp);

    const fromMsg       = fromDebateObj ? ` from ${fromRoomLabel}` : '';
    const conflictMsg   = conflict ? `\n\n⚠️ ${judge?.name} has a conflict with a team in ${toRoomLabel}.` : '';
    const removeMsg     = fromDebateObj ? `\n\nThis removes them from ${fromRoomLabel}.` : '';

    if (!confirm(`Move ${judge?.name || judgeId}${fromMsg} → ${toRoomLabel}?${removeMsg}${conflictMsg}\n\nConfirm?`)) return;

    // Remove from source panel
    if (fromDebateObj) {
        fromDebateObj.panel = (fromDebateObj.panel || []).filter(p => String(p.id) !== String(judgeId));
        if (fromDebateObj.panel.length > 0 && !fromDebateObj.panel.some(p => p.role === 'chair')) {
            fromDebateObj.panel[0].role = 'chair';
        }
    }

    // Add to target panel
    if (!toDebateObj.panel) toDebateObj.panel = [];
    if (!toDebateObj.panel.some(p => String(p.id) === String(judgeId))) {
        toDebateObj.panel.push({ id: judgeId, role: toDebateObj.panel.length === 0 ? 'chair' : 'wing' });
    }

    // Anti-double-booking safety net: strip from any other debate in this round
    round.debates.forEach((d, dIdx) => {
        if (dIdx === toDebate) return;
        const before = d.panel?.length || 0;
        d.panel = (d.panel || []).filter(p => String(p.id) !== String(judgeId));
        if (d.panel.length !== before && d.panel.length > 0 && !d.panel.some(p => p.role === 'chair')) {
            d.panel[0].role = 'chair';
        }
    });

    saveNow();
    displayRounds();
    showNotification(`${judge?.name} moved → ${toRoomLabel}${conflict ? ' (conflict noted)' : ''}`, conflict ? 'warning' : 'success');
}

// ── TEAM drag handlers 

export function dndTeamDragStart(event, fromRound, fromDebate, fromSide) {
    window._dnd = { type: 'team', judgeId: null, fromRound, fromDebate, fromSide };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${fromRound}-${fromDebate}-${fromSide}`);
    event.currentTarget.classList.add('dragging');
}

export function dndTeamDragOver(event, toRound, toDebate, toSide) {
    if (window._dnd.type !== 'team') return;
    event.preventDefault();

    const zone = event.currentTarget;
    zone.classList.remove('drag-over', 'drag-over-warn');

    const { fromRound, fromDebate, fromSide } = window._dnd;

    // Same slot — ignore
    if (fromRound === toRound && fromDebate === toDebate && fromSide === toSide) return;

    const srcDebate = state.rounds[fromRound]?.debates[fromDebate];
    const tgtDebate = state.rounds[toRound]?.debates[toDebate];
    if (!srcDebate || !tgtDebate) return;

    const movingTeamId = srcDebate[fromSide];
    const displacedTeamId = tgtDebate[toSide];

    // Check if the two teams have met before (rematch warning)
    const otherTeamInTarget = toSide === 'gov' ? tgtDebate.opp : tgtDebate.gov;
    const previousMeetings = getPreviousMeetings();
    const wouldRematch = previousMeetings[movingTeamId]?.[otherTeamInTarget] > 0
        || previousMeetings[otherTeamInTarget]?.[movingTeamId] > 0;

    zone.classList.add(wouldRematch ? 'drag-over-warn' : 'drag-over');
    event.dataTransfer.dropEffect = 'move';
}

export function dndTeamDrop(event, toRound, toDebate, toSide) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over', 'drag-over-warn');

    if (window._dnd.type !== 'team') return;

    const { fromRound, fromDebate, fromSide } = window._dnd;

    // Same slot — no-op
    if (fromRound === toRound && fromDebate === toDebate && fromSide === toSide) return;

    const round = state.rounds[toRound];
    const srcDebate = state.rounds[fromRound]?.debates[fromDebate];
    const tgtDebate = round?.debates[toDebate];

    if (!srcDebate || !tgtDebate) return;
    if (srcDebate.entered || tgtDebate.entered) {
        showNotification('Cannot move teams — one of the rooms has results entered', 'error');
        return;
    }

    const movingTeamId = srcDebate[fromSide];       // team being dragged
    const displacedTeamId = tgtDebate[toSide];      // team in the target slot

    const movingTeam = state.teams.find(t => t.id === movingTeamId);
    const displacedTeam = state.teams.find(t => t.id === displacedTeamId);

    const srcRoomLabel = state.rounds[fromRound]?.rooms?.[fromDebate] || `Room ${fromDebate + 1}`;
    const tgtRoomLabel = round.rooms?.[toDebate] || `Room ${toDebate + 1}`;

    // Rematch check
    const otherTeamInTarget = toSide === 'gov' ? tgtDebate.opp : tgtDebate.gov;
    const previousMeetings = getPreviousMeetings();
    const wouldRematch = previousMeetings[movingTeamId]?.[otherTeamInTarget] > 0
        || previousMeetings[otherTeamInTarget]?.[movingTeamId] > 0;

    const rematchMsg = wouldRematch
        ? `\n\n⚠️ This creates a REMATCH — these teams have debated before.`
        : '';

    // Same round cross-room swap
    const isCrossRoom = fromDebate !== toDebate || fromRound !== toRound;
    const swapMsg = isCrossRoom
        ? `\n\n${movingTeam?.name} (${fromSide.toUpperCase()}, ${srcRoomLabel}) will swap with ${displacedTeam?.name} (${toSide.toUpperCase()}, ${tgtRoomLabel}).`
        : `\n\nThis swaps ${movingTeam?.name} and ${displacedTeam?.name} within ${srcRoomLabel}.`;

    const confirmed = confirm(
        `Move ${movingTeam?.name || movingTeamId} to ${toSide.toUpperCase()} in ${tgtRoomLabel}?${swapMsg}${rematchMsg}\n\nConfirm?`
    );
    if (!confirmed) return;

    // Execute swap: the two slots exchange their team IDs
    srcDebate[fromSide] = displacedTeamId;
    tgtDebate[toSide] = movingTeamId;

    // Clear sidesPending flags on affected rooms
    srcDebate.sidesPending = false;
    tgtDebate.sidesPending = false;

    // Reset attendance for swapped slots to present
    if (!srcDebate.attendance) srcDebate.attendance = { gov: true, opp: true };
    if (!tgtDebate.attendance) tgtDebate.attendance = { gov: true, opp: true };
    srcDebate.attendance[fromSide] = true;
    tgtDebate.attendance[toSide] = true;

    saveNow();
    displayRounds();

    const actionLabel = isCrossRoom
        ? `${movingTeam?.name} → ${tgtRoomLabel} (${toSide}), ${displacedTeam?.name} → ${srcRoomLabel} (${fromSide})`
        : `${movingTeam?.name} and ${displacedTeam?.name} swapped sides`;

    showNotification(`✅ ${actionLabel}${wouldRematch ? ' ⚠️ Rematch!' : ''}`, wouldRematch ? 'warning' : 'success');
}

function toggleAttendance(roundIdx, debateIdx, side) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    
    if (!debate.attendance) {
        debate.attendance = { gov: true, opp: true };
    }
    
    debate.attendance[side] = !debate.attendance[side];
    
    saveNow();
    displayRounds();
    
    const team = state.teams.find(t => t.id === debate[side]);
    showNotification(
        `${team.name} marked as ${debate.attendance[side] ? 'present' : 'absent'}`,
        debate.attendance[side] ? 'success' : 'warning'
    );
}

// ============================================
// JUDGE ALLOCATION (NO DUPLICATES, CONFLICT-AWARE)
// ============================================

function allocateJudgesToDebates(debates, isKnockout = false) {
    if (!state.judges.length) return;

    // Clear all panels first
    debates.forEach(d => { d.panel = []; });

    const previousAllocations = getPreviousJudgeAllocations(isKnockout);
    const assignedInRound = new Set(); // judges already used in this round
    const conflictMap = buildConflictMap(state.judges);

    // Sort judges: higher rating first, then least-used, skip unavailable
    const judgesByHistory = [...state.judges]
        .filter(j => j.available !== false)
        .sort((a, b) => {
            const ra = b.rating || 5, rb = a.rating || 5;
            if (ra !== rb) return ra - rb;           // higher rating first
            return (previousAllocations[a.id] || 0) - (previousAllocations[b.id] || 0);
        });

    // Helper: pick the best available judge for a debate (no conflict, not yet used)
    function pickJudge(debate, excludeIds = new Set()) {
        return judgesByHistory.find(j =>
            !assignedInRound.has(j.id) &&
            !excludeIds.has(j.id) &&
            !hasConflict(conflictMap, j.id, debate.gov) &&
            !hasConflict(conflictMap, j.id, debate.opp)
        ) || null;
    }

    // ── PASS 1: guarantee every room gets exactly one chair ──────────────────

    debates.forEach(debate => {
        let chair = pickJudge(debate);

        if (!chair) {
            // Fallback: conflict-free not possible — pick any unused judge
            chair = judgesByHistory.find(j => !assignedInRound.has(j.id)) || null;
        }

        if (chair) {
            debate.panel.push({ id: chair.id, role: 'chair' });
            assignedInRound.add(chair.id);
        }
    });

    // ── PASS 2: fill wing judges with remaining unassigned judges 
    const maxWings = isKnockout ? 4 : 2; // additional wings beyond chair

    // Distribute remaining judges as wings, prioritising rooms needing more judges

    let debateOrder = debates.map((d, i) => i); // index order = room order (top rooms first)

    for (let wingSlot = 0; wingSlot < maxWings; wingSlot++) {
        debateOrder.forEach(idx => {
            const debate = debates[idx];
            if (debate.panel.length === 0) return; // skip rooms that got no chair

            const alreadyInPanel = new Set(debate.panel.map(p => p.id));
            const wing = pickJudge(debate, alreadyInPanel);

            if (wing) {
                debate.panel.push({ id: wing.id, role: 'wing' });
                assignedInRound.add(wing.id);
            }
        });
    }
}

// Helper: Get previous judge allocation counts
function getPreviousJudgeAllocations(isKnockout) {
    const allocations = {};
    
    state.rounds.forEach(round => {
        const matchesType = isKnockout ? round.type === 'knockout' : round.type !== 'knockout';
        if (!matchesType) return;
        
        round.debates.forEach(debate => {
            if (debate.panel) {
                debate.panel.forEach(p => {
                    allocations[p.id] = (allocations[p.id] || 0) + 1;
                });
            }
        });
    });
    
    return allocations;
}

// ============================================
// CREATE ROUND WITH ENHANCED FEATURES
// ============================================

function assignSides(teamA, teamB, sideMethod, seedRankA, sidePref = 'random') {
    // Get team's last side from all previous rounds
    const getLastSide = (teamId) => {
        let lastSide = null;
        for (let r = state.rounds.length - 1; r >= 0; r--) {
            for (const d of state.rounds[r].debates || []) {
                if (d.gov === teamId) { lastSide = 'gov'; break; }
                if (d.opp === teamId) { lastSide = 'opp'; break; }
            }
            if (lastSide) break;
        }
        return lastSide;
    };

    // Get count of rounds for each side
    const getSideCounts = (teamId) => {
        let gov = 0, opp = 0;
        for (const r of state.rounds) {
            for (const d of r.debates || []) {
                if (d.gov === teamId) gov++;
                if (d.opp === teamId) opp++;
            }
        }
        return { gov, opp };
    };

    // ALTERNATE: Prevent same side as last round
    if (sidePref === 'alternate') {
        const lastA = getLastSide(teamA.id);
        const lastB = getLastSide(teamB.id);

        if (lastA === 'gov') return { gov: teamB.id, opp: teamA.id }; // A was Gov → B is Gov
        if (lastA === 'opp') return { gov: teamA.id, opp: teamB.id }; // A was Opp → A is Gov
        if (lastB === 'gov') return { gov: teamA.id, opp: teamB.id }; // B was Gov → A is Gov
        if (lastB === 'opp') return { gov: teamB.id, opp: teamA.id }; // B was Opp → B is Gov
        // No history - use random
        return Math.random() < 0.5
            ? { gov: teamA.id, opp: teamB.id }
            : { gov: teamB.id, opp: teamA.id };
    }

    // BALANCED: Assign to even out counts over time
    if (sidePref === 'balanced') {
        const { gov: govA, opp: oppA } = getSideCounts(teamA.id);
        const { gov: govB, opp: oppB } = getSideCounts(teamB.id);
        const diffA = govA - oppA; // Positive = more Gov, Negative = more Opp
        const diffB = govB - oppB;

        // Team with lower count of Gov gets Gov
        if (diffA > diffB) return { gov: teamB.id, opp: teamA.id }; // A had more Gov, give B Gov
        if (diffB > diffA) return { gov: teamA.id, opp: teamB.id }; // B had more Gov, give A Gov
        // Equal - random
        return Math.random() < 0.5
            ? { gov: teamA.id, opp: teamB.id }
            : { gov: teamB.id, opp: teamA.id };
    }

    // RANDOM or default behavior
    if (sideMethod === 'seed-high-gov') {
        return { gov: teamA.id, opp: teamB.id };
    }
    if (sideMethod === 'seed-low-gov') {
        return { gov: teamB.id, opp: teamA.id };
    }
    if (sideMethod === 'manual') {
        return { gov: teamA.id, opp: teamB.id };
    }
    return Math.random() < 0.5
        ? { gov: teamA.id, opp: teamB.id }
        : { gov: teamB.id, opp: teamA.id };
}

// ============================================
// SHOW JUDGE MANAGEMENT MODAL
// ============================================

function showJudgeManagement(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    const isSpeechDebate = debate.format === 'speech';

    // For standard debates, look up gov/opp teams; for speech there are none
    const gov = isSpeechDebate ? null : state.teams.find(t => t.id === debate.gov);
    const opp = isSpeechDebate ? null : state.teams.find(t => t.id === debate.opp);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; overflow-y: auto; padding: 20px;';

    const currentPanel = debate.panel || [];

    // Build a map of judgeId → { debateIdx, roomName, role } for every other debate in this round
    const judgeAssignments = {}; // judgeId → { debateIdx, roomLabel, role }
    round.debates.forEach((d, dIdx) => {
        if (dIdx === debateIdx) return;
        (d.panel || []).forEach(p => {
            judgeAssignments[p.id] = {
                debateIdx: dIdx,
                roomLabel: round.rooms?.[dIdx] || `Room ${dIdx + 1}`,
                role: p.role
            };
        });
    });

    // Categorise all judges
    // For speech debates there are no team conflicts, so all unassigned judges are free
    const allJudges = state.judges;
    const inCurrentPanel = new Set(currentPanel.map(p => p.id));

    const freeJudges = [];
    const conflictedJudges = [];
    const assignedElsewhere = [];

    const conflictMap = buildConflictMap(state.judges);
    allJudges.forEach(j => {
        if (inCurrentPanel.has(j.id)) return;
        const hasC = isSpeechDebate ? false : (hasConflict(conflictMap, j.id, debate.gov) || hasConflict(conflictMap, j.id, debate.opp));
        const elsewhere = judgeAssignments[j.id];
        if (elsewhere) {
            assignedElsewhere.push({ judge: j, assignment: elsewhere, hasConflict: hasC });
        } else if (hasC) {
            conflictedJudges.push(j);
        } else {
            freeJudges.push(j);
        }
    });

    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    // Subtitle line: show teams for standard, speaker count for speech
    const modalSubtitle = isSpeechDebate
        ? `${(debate.roomSpeakers||[]).length} speakers`
        : `${escapeHTML(gov?.name || '?')} vs ${escapeHTML(opp?.name || '?')}`;

    modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 640px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
                <h2 style="margin: 0 0 4px 0; color: #1e293b;">${isSpeechDebate ? 'Judge Allocation' : ' Panel Management'}</h2>
                <p style="margin: 0; color: #64748b; font-size: 14px;">
                    <strong>${escapeHTML(roomLabel)}</strong>: ${modalSubtitle}
                </p>
            </div>

            <div style="padding: 24px;">
                <!-- Current Panel -->
                <div style="margin-bottom: 24px;">
                    <h3 style="margin: 0 0 12px 0; color: #1e293b; font-size: 16px;">Current Panel (${currentPanel.length})</h3>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${currentPanel.length === 0
                            ? '<p style="color: #94a3b8; font-style: italic; padding: 16px; text-align: center; background: #f8fafc; border-radius: 8px;">No judges assigned</p>'
                            : currentPanel.map(p => {
                                const judge = state.judges.find(j => j.id === p.id);
                                if (!judge) return '';
                                return `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid ${p.role === 'chair' ? '#3b82f6' : '#94a3b8'};">
                    <div>
                                            <strong style="color: #1e293b;">${escapeHTML(judge.name)}</strong>
                                            <span style="margin-left: 8px; background: ${p.role === 'chair' ? '#dbeafe' : '#f1f5f9'}; color: ${p.role === 'chair' ? '#1e40af' : '#475569'}; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase;">${p.role}</span>
                                        </div>
                                        <button onclick="window.removeJudgeFromPanel(${roundIdx}, ${debateIdx}, '${p.id}')"
                                                style="padding: 6px 12px; background: #fee2e2; color: #991b1b; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                            Remove
                                        </button>
                                    </div>`;
                            }).join('')
                        }
                    </div>
                </div>

                <!-- Free Judges -->
                ${freeJudges.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; color: #1e293b; font-size: 15px;">Available Judges (${freeJudges.length})</h3>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${freeJudges.map(j => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f0fdf4; border-radius: 8px; border-left: 3px solid #10b981;">
                                <strong style="color: #1e293b;">${escapeHTML(j.name)}</strong>
                                <button onclick="window.addJudgeToPanel(${roundIdx}, ${debateIdx}, '${j.id}')"
                                        style="padding: 6px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                    Add
                                </button>
                            </div>`).join('')}
                    </div>
                </div>` : '<p style="color: #94a3b8; font-style: italic; padding: 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 20px; text-align: center;">No free judges available</p>'}

                <!-- Judges in other rooms (can be moved) -->
                ${assignedElsewhere.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; color: #1e293b; font-size: 15px;">Judges in Other Rooms</h3>
                    <p style="margin: 0 0 10px 0; font-size: 12px; color: #64748b;">Click <strong>Move Here</strong> to pull a judge from their current room into this one.</p>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${assignedElsewhere.map(({ judge: j, assignment: a, hasConflict: hc }) => `
                            <div style="background: ${hc ? '#fff7ed' : '#f8fafc'}; border-radius: 8px; border-left: 3px solid ${hc ? '#f59e0b' : '#94a3b8'}; overflow: hidden;">
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px;">
                                    <div>
                                        <strong style="color: #1e293b;">${escapeHTML(j.name)}</strong>
                                        <span style="margin-left: 8px; color: #64748b; font-size: 12px;">currently in <strong>${escapeHTML(a.roomLabel)}</strong> as ${a.role}</span>
                                        ${hc ? '<span style="margin-left: 6px; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">⚠️ CONFLICT</span>' : ''}
                                    </div>
                                    ${!hc ? `
                                    <button onclick="
                                        var panel = document.getElementById('move-panel-${j.id}');
                                        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                                    " style="padding: 6px 14px; background: #8b5cf6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
                                        Move Here ▾
                                    </button>` : '<span style="font-size: 11px; color: #f59e0b; font-weight: 600;">Conflict — cannot assign</span>'}
                                </div>
                                ${!hc ? `
                                <div id="move-panel-${j.id}" style="display:none; padding: 0 12px 14px 12px;">
                                    <div style="background: #ede9fe; border-radius: 8px; padding: 14px;">
                                        <p style="margin: 0 0 10px 0; font-size: 13px; color: #4c1d95; font-weight: 600;">
                                            Move <strong>${escapeHTML(j.name)}</strong> from <strong>${escapeHTML(a.roomLabel)}</strong> → <strong>${escapeHTML(roomLabel)}</strong>
                                        </p>
                                        <p style="margin: 0 0 12px 0; font-size: 12px; color: #6d28d9;">
                                            They will be removed from ${escapeHTML(a.roomLabel)} and added to this panel.
                                            ${a.role === 'chair' ? ' A new chair will be auto-assigned in their old room.' : ''}
                                        </p>
                                        <div style="display: flex; gap: 8px;">
                                            <button onclick="window.moveJudgeToPanel(${roundIdx}, ${a.debateIdx}, ${debateIdx}, '${j.id}')"
                                                    style="padding: 8px 20px; background: #7c3aed; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700;">
                                                ✓ Confirm Move
                                            </button>
                                            <button onclick="document.getElementById('move-panel-${j.id}').style.display='none'"
                                                    style="padding: 8px 14px; background: white; color: #64748b; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; font-size: 13px;">
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                </div>` : ''}
                            </div>`).join('')}
                    </div>
                </div>` : ''}

                <!-- Conflicted judges (info only) -->
                ${conflictedJudges.length > 0 ? `
                <div>
                    <h3 style="margin: 0 0 10px 0; color: #64748b; font-size: 14px;">Unavailable (Conflicts)</h3>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${conflictedJudges.map(j => `
                            <span style="background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
                                ${escapeHTML(j.name)}
                            </span>`).join('')}
                    </div>
                </div>` : ''}
            </div>

            <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end;">
                <button onclick="window.closeAllModals()" class="btn-primary" style="padding: 10px 24px; border-radius: 8px;">
                    Done
                </button>
            </div>
        </div>
    `;

    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeAllModals();
    });

    document.body.appendChild(modal);
}

// ============================================
// ADD/REMOVE/MOVE JUDGE FROM PANEL
// ============================================

export function addJudgeToPanel(roundIdx, debateIdx, judgeId) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];

    if (!debate.panel) debate.panel = [];

    // Prevent double-booking: remove from any other debate in this round first
    round.debates.forEach((d, dIdx) => {
        if (dIdx === debateIdx) return;
        if (!d.panel) return;
        const was = d.panel.find(p => p.id === judgeId);
        if (was) {
            d.panel = d.panel.filter(p => p.id !== judgeId);
            // Re-assign chair if needed
            if (d.panel.length > 0 && !d.panel.some(p => p.role === 'chair')) {
                d.panel[0].role = 'chair';
            }
        }
    });

    // Don't add if already in this panel
    if (debate.panel.some(p => p.id === judgeId)) return;

    const role = debate.panel.length === 0 ? 'chair' : 'wing';
    debate.panel.push({ id: judgeId, role });

    saveNow();
    closeAllModals();
    setTimeout(() => showJudgeManagement(roundIdx, debateIdx), 100);
}

export function removeJudgeFromPanel(roundIdx, debateIdx, judgeId) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];

    debate.panel = debate.panel.filter(p => p.id !== judgeId);

    // Promote first wing to chair if chair was removed
    if (debate.panel.length > 0 && !debate.panel.some(p => p.role === 'chair')) {
        debate.panel[0].role = 'chair';
    }

    saveNow();
    closeAllModals();
    setTimeout(() => showJudgeManagement(roundIdx, debateIdx), 100);
}

// Toggle a judge's role (chair ↔ wing) within their current panel
export function toggleJudgeRole(roundIdx, debateIdx, judgeId) {
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    if (!isAdmin) return;
    const round  = state.rounds?.[roundIdx];
    const debate = round?.debates?.[debateIdx];
    if (!debate || debate.entered) return;

    const entry = (debate.panel || []).find(p => String(p.id) === String(judgeId));
    if (!entry) return;

    const j = (state.judges || []).find(j => String(j.id) === String(judgeId));

    if (entry.role === 'chair') {
        if (debate.panel.length <= 1) {
            showNotification('Cannot demote — panel only has one judge', 'info');
            return;
        }
        // Demote to wing; promote first other member to chair
        entry.role = 'wing';
        const nextChair = debate.panel.find(p => String(p.id) !== String(judgeId));
        if (nextChair) nextChair.role = 'chair';
        showNotification(`${j?.name || 'Judge'} demoted to wing`, 'info');
    } else {
        // Promote to chair; demote current chair to wing
        debate.panel.forEach(p => { if (p.role === 'chair') p.role = 'wing'; });
        entry.role = 'chair';
        showNotification(`${j?.name || 'Judge'} promoted to chair`, 'success');
    }

    saveNow();
    displayRounds();
}

// Move a judge from one debate panel to another within the same round
export function moveJudgeToPanel(roundIdx, fromDebateIdx, toDebateIdx, judgeId) {
    const round = state.rounds[roundIdx];
    const fromDebate = round.debates[fromDebateIdx];
    const toDebate = round.debates[toDebateIdx];

    if (!fromDebate || !toDebate) return;

    // Remove from source panel
    fromDebate.panel = (fromDebate.panel || []).filter(p => p.id !== judgeId);
    if (fromDebate.panel.length > 0 && !fromDebate.panel.some(p => p.role === 'chair')) {
        fromDebate.panel[0].role = 'chair';
    }

    // Add to destination panel
    if (!toDebate.panel) toDebate.panel = [];
    if (!toDebate.panel.some(p => p.id === judgeId)) {
        const role = toDebate.panel.length === 0 ? 'chair' : 'wing';
        toDebate.panel.push({ id: judgeId, role });
    }

    saveNow();
    closeAllModals();
    setTimeout(() => showJudgeManagement(roundIdx, toDebateIdx), 100);
}

// ============================================
// COPY ROOM URL
// ============================================

function copyRoomURL(roundIdx, debateIdx) {
    const roomURL = getOrCreateRoomURL(roundIdx, debateIdx);
    
    navigator.clipboard.writeText(roomURL).then(() => {
        showNotification('Room URL copied to clipboard!', 'success');
    }).catch(() => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = roomURL;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showNotification('Room URL copied!', 'success');
    });
}

// ============================================
// SPEAKER COMBO WIDGET
// ============================================

/** Build HTML for a speaker combo slot.
 *  @param {string}   id         - canonical element ID (hidden input); select gets id+'-sel', text gets id+'-txt'
 *  @param {Array}    speakers   - array of {name} objects for the team roster
 *  @param {string}   accentClr  - border colour for the "new name" text input
 *  @param {string}   badgeId    - id for the NEW badge span
 */
function _buildSpeakerCombo(id, speakers, accentClr, badgeId) {
    const opts = (speakers || [])
        .map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`)
        .join('');
    return `
    <div>
        <select id="${id}-sel"
                onchange="window._spkComboChange('${id}')"
                style="width:100%;padding:9px 10px;border-radius:8px;border:1.5px solid #cbd5e1;font-size:14px;box-sizing:border-box;background:white;cursor:pointer;">
            <option value="">— Select speaker —</option>
            ${opts}
            <option value="__new__">Enter New Speaker</option>
        </select>
        <input type="text" id="${id}-txt"
               placeholder="Type new speaker name…"
               oninput="window._spkComboNew('${id}')"
               style="display:none;width:100%;margin-top:5px;padding:9px 10px;border-radius:8px;border:1.5px solid ${accentClr};font-size:14px;box-sizing:border-box;">
        <input type="hidden" id="${id}" value="">
        <span id="${badgeId}" style="display:none;background:#dbeafe;color:#1e40af;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;margin-top:3px;">NEW</span>
    </div>`;
}

// Handles any speaker <select> changes
window._spkComboChange = function(id) {
    // ── Pattern A: hidden-input combo 
    const hidden = document.getElementById(id);
    if (hidden && hidden.type === 'hidden') {
        const sel = document.getElementById(id + '-sel');
        const txt = document.getElementById(id + '-txt');
        if (!sel) return;
        if (sel.value === '__new__') {
            if (txt) { txt.style.display = 'block'; txt.focus(); }
            hidden.value = '';
        } else {
            if (txt) { txt.style.display = 'none'; txt.value = ''; }
            hidden.value = sel.value;
        }
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
        return;
    }

    // ── Pattern B: ballot modal select 
    const select = document.getElementById(id);
    if (!select) return;
    if (select.value === '__new__') {
        const txtId = id + '-txt';
        let txt = document.getElementById(txtId);
        if (!txt) {
            txt = document.createElement('input');
            txt.type = 'text'; txt.id = txtId;
            txt.placeholder = 'Enter new speaker name...';
            Object.assign(txt.style, { display:'block', width:'100%', padding:'9px 10px',
                borderRadius:'8px', border:'1.5px solid #3b82f6', marginTop:'5px', boxSizing:'border-box' });
            txt.oninput = () => window._spkComboChange(id);
            select.parentElement.appendChild(txt);
        } else {
            txt.style.display = 'block';
        }
        txt.focus();
    } else {
        const txt = document.getElementById(id + '-txt');
        if (txt) txt.style.display = 'none';
    }
    // ── Live duplicate detection for ballot modal ────────────────────────────
    const m = id.match(/^(gov|opp)/);
    if (m) checkDuplicateSpeakers(m[1], id.includes('reply'));
};

// Called when the free-text input changes
window._spkComboNew = function(id) {
    const txt    = document.getElementById(id + '-txt');
    const hidden = document.getElementById(id);
    if (!txt || !hidden) return;
    hidden.value = txt.value.trim();
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Pre-populate a combo (used when editing existing results).
 *  If name is in the known roster → select it; otherwise → show text input. */
window._spkComboSetValue = function(id, name, knownSpeakers) {
    const sel    = document.getElementById(id + '-sel');
    const txt    = document.getElementById(id + '-txt');
    const hidden = document.getElementById(id);
    if (!hidden) return;
    hidden.value = name || '';
    if (!name) return;
    const isKnown = (knownSpeakers || []).some(s => s.name === name);
    if (isKnown && sel) {
        sel.value = name;
        if (txt) txt.style.display = 'none';
    } else if (sel) {
        sel.value = '__new__';
        if (txt) { txt.style.display = 'block'; txt.value = name; }
    }
};

// ============================================
// SHOW ENTER RESULTS MODAL
// ============================================

export function showEnterResults(roundIdx, debateIdx) {
    const rounds = state.rounds || [];
    const round  = rounds[roundIdx];
    
    if (!round) {
        console.error('showEnterResults: Round not found at index', roundIdx, rounds);
        showNotification('Round data missing. Try refreshing the page.', 'error');
        return;
    }

    const debates = round.debates || [];
    const debate  = debates[debateIdx];

    if (!debate) {
        console.error('showEnterResults: Debate not found at index', debateIdx, debates);
        showNotification('Debate data missing. Try refreshing the page.', 'error');
        return;
    }

    // ── Dispatch to BP ballot if this is a BP debate ─────────────────────────
    if (debate.format === 'bp')     { showBPEnterResults(roundIdx, debateIdx);     return; }
    if (debate.format === 'speech') { showSpeechEnterResults(roundIdx, debateIdx); return; }

    const gov = state.teams.find(t => t.id === debate.gov);
    const opp = state.teams.find(t => t.id === debate.opp);

    if (!gov || !opp) {
        showNotification('Teams not found', 'error');
        return;
    }

    const isAdmin  = state.auth?.currentUser?.role === 'admin';
    const isJudge  = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    const isMyRoom  = isJudge && (debate.panel||[]).some(p => String(p.id) === myJudgeId);

    // Only admin or the judge assigned to this room can submit
    if (!isAdmin && !isMyRoom) {
        showNotification('You are not assigned to this room', 'error');
        return;
    }

    // Check attendance
    const govPresent = debate.attendance?.gov !== false;
    const oppPresent = debate.attendance?.opp !== false;
    
    if (!govPresent || !oppPresent) {
        showNotification('Both teams must be marked present before entering results', 'error');
        return;
    }

    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay ballot-modal-overlay';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.4); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px; animation: fadeIn 0.2s ease;';
    
    // Check if reply speeches are disabled for this round
    const disableReply = round.disableReply || false;
    
    // Ensure speakers arrays exist
    const govSpeakers = gov.speakers || [];
    const oppSpeakers = opp.speakers || [];
    
    modal.innerHTML = `
        <div style="background:white;border-radius:14px;max-width:560px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 40px -8px rgba(0,0,0,0.22),0 0 0 1px rgba(255,255,255,0.15);overflow:hidden;animation:slideUp 0.25s cubic-bezier(0.16,1,0.3,1);">
            <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;position:sticky;top:0;background:rgba(255,255,255,0.97);backdrop-filter:blur(8px);z-index:10;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <h2 style="margin:0;color:#0f172a;font-size:15px;font-weight:800;letter-spacing:-0.01em;">Enter Results</h2>
                    <button onclick="window.closeAllModals()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0 2px;">✕</button>
                </div>
                <p style="margin:0;color:#64748b;font-size:11px;font-weight:500;">Round ${round.id} · ${escapeHTML(roomLabel)}: ${escapeHTML(round.motion)}</p>
                <div style="margin:6px 0 0;display:flex;align-items:center;gap:6px;font-size:11px;">
                    <span style="background:#eff6ff;color:#1e40af;padding:2px 7px;border-radius:6px;font-weight:700;">${escapeHTML(gov.name)}</span>
                    <span style="color:#94a3b8;font-weight:700;font-size:10px;">VS</span>
                    <span style="background:#fdf2f8;color:#be185d;padding:2px 7px;border-radius:6px;font-weight:700;">${escapeHTML(opp.name)}</span>
                </div>
            </div>

            <div style="padding:12px 16px;overflow-y:auto;flex:1;">
                <style>
                    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
                </style>
                <div id="results-error" style="display:none;background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:7px;margin-bottom:12px;font-size:12px;font-weight:600;"></div>

                <div class="modal-results-grid">
                    <!-- Government Team -->
                    <div style="background:#eff6ff;padding:12px;border-radius:10px;border:1.5px solid #bfdbfe;">
                        <h3 style="margin:0 0 10px;color:#1e40af;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;">
                            GOV: ${escapeHTML(gov.name)}
                        </h3>
                        
                        ${[1,2,3].map(i => `
                            <div style="margin-bottom:7px;">
                                <label style="display:block;margin-bottom:3px;font-weight:600;color:#1e293b;font-size:11px;">Speaker ${i} *</label>
                                <div style="display:grid;grid-template-columns:2fr 1fr;gap:5px;">
                                    <select id="gov-sel-${i-1}" onchange="window._spkComboChange('gov-sel-${i-1}')"
                                            style="width:100%;padding:5px 7px;border-radius:6px;border:1.5px solid #cbd5e1;font-size:12px;box-sizing:border-box;background:white;cursor:pointer;">
                                        <option value="">— Select —</option>
                                        ${govSpeakers.map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('')}
                                        <option value="__new__">✏️ New…</option>
                                    </select>
                                    <input type="number" id="gov-score-${i-1}" min="60" max="80" step="0.5" placeholder="60-80"
                                           style="padding:5px 6px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;align-self:start;">
                                </div>
                                <div id="gov-duplicate-${i-1}" style="display:none;color:#dc2626;font-size:10px;margin-top:2px;font-weight:600;">⚠️ Duplicate</div>
                            </div>`).join('')}

                        ${!disableReply ? `
                            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #bfdbfe;">
                                <label style="display:block;margin-bottom:3px;font-weight:600;color:#1e293b;font-size:11px;">Reply *</label>
                                <div style="display:grid;grid-template-columns:2fr 1fr;gap:5px;">
                                    <select id="gov-reply-sel" onchange="window._spkComboChange('gov-reply-sel')"
                                            style="width:100%;padding:5px 7px;border-radius:6px;border:1.5px solid #cbd5e1;font-size:12px;box-sizing:border-box;background:white;cursor:pointer;">
                                        <option value="">— Select —</option>
                                        ${govSpeakers.map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('')}
                                        <option value="__new__">✏️ New…</option>
                                    </select>
                                    <input type="number" id="gov-reply-score" min="30" max="40" step="0.5" placeholder="30-40"
                                           style="padding:5px 6px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;align-self:start;">
                                </div>
                                <div id="gov-reply-duplicate" style="display:none;color:#dc2626;font-size:10px;margin-top:2px;font-weight:600;">⚠️ Already a substantive speaker — best score used</div>
                            </div>
                        ` : '<p style="color:#64748b;font-size:11px;margin-top:8px;text-align:center;font-style:italic;">Reply disabled</p>'}
                    </div>

                    <!-- Opposition Team -->
                    <div style="background:#fdf2f8;padding:12px;border-radius:10px;border:1.5px solid #fbcfe8;">
                        <h3 style="margin:0 0 10px;color:#be185d;font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;">
                            OPP: ${escapeHTML(opp.name)}
                        </h3>

                        ${[1,2,3].map(i => `
                            <div style="margin-bottom:7px;">
                                <label style="display:block;margin-bottom:3px;font-weight:600;color:#1e293b;font-size:11px;">Speaker ${i} *</label>
                                <div style="display:grid;grid-template-columns:2fr 1fr;gap:5px;">
                                    <select id="opp-sel-${i-1}" onchange="window._spkComboChange('opp-sel-${i-1}')"
                                            style="width:100%;padding:5px 7px;border-radius:6px;border:1.5px solid #cbd5e1;font-size:12px;box-sizing:border-box;background:white;cursor:pointer;">
                                        <option value="">— Select —</option>
                                        ${oppSpeakers.map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('')}
                                        <option value="__new__">✏️ New…</option>
                                    </select>
                                    <input type="number" id="opp-score-${i-1}" min="60" max="80" step="0.5" placeholder="60-80"
                                           style="padding:5px 6px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;align-self:start;">
                                </div>
                                <div id="opp-duplicate-${i-1}" style="display:none;color:#dc2626;font-size:10px;margin-top:2px;font-weight:600;">⚠️ Duplicate</div>
                            </div>`).join('')}

                        ${!disableReply ? `
                            <div style="margin-top:8px;padding-top:8px;border-top:1px solid #fbcfe8;">
                                <label style="display:block;margin-bottom:3px;font-weight:600;color:#1e293b;font-size:11px;">Reply *</label>
                                <div style="display:grid;grid-template-columns:2fr 1fr;gap:5px;">
                                    <select id="opp-reply-sel" onchange="window._spkComboChange('opp-reply-sel')"
                                            style="width:100%;padding:5px 7px;border-radius:6px;border:1.5px solid #cbd5e1;font-size:12px;box-sizing:border-box;background:white;cursor:pointer;">
                                        <option value="">— Select —</option>
                                        ${oppSpeakers.map(s => `<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('')}
                                        <option value="__new__">✏️ New…</option>
                                    </select>
                                    <input type="number" id="opp-reply-score" min="30" max="40" step="0.5" placeholder="30-40"
                                           style="padding:5px 6px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;align-self:start;">
                                </div>
                                <div id="opp-reply-duplicate" style="display:none;color:#dc2626;font-size:10px;margin-top:2px;font-weight:600;">⚠️ Already listed</div>
                            </div>
                        ` : '<p style="color:#64748b;font-size:11px;margin-top:8px;text-align:center;font-style:italic;">Reply disabled</p>'}
                    </div>
                </div>

                <div style="background:#f8fafc;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0;margin-top:8px;">
                    <p style="margin:0;color:#64748b;font-size:11px;line-height:1.4;">
                        <strong style="color:#1e293b;">Scoring:</strong> 60–80 pts${!disableReply ? ' · Reply: 30–40' : ''}
                    </p>
                </div>

                <!-- Live totals bar -->
                <div id="ballot-totals-bar" style="margin-top:8px;background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                    <div>
                        <div style="font-size:9px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.04em">${escapeHTML(gov.name)}</div>
                        <div id="ballot-gov-total" style="font-size:15px;font-weight:800;color:#1e293b">—</div>
                    </div>
                    <div id="ballot-verdict" style="font-size:11px;font-weight:700;color:#64748b;text-align:center;flex-shrink:0;padding:3px 9px;border-radius:10px;background:#e2e8f0;white-space:nowrap">Enter scores</div>
                    <div style="text-align:right">
                        <div style="font-size:9px;font-weight:700;color:#be185d;text-transform:uppercase;letter-spacing:.04em">${escapeHTML(opp.name)}</div>
                        <div id="ballot-opp-total" style="font-size:15px;font-weight:800;color:#1e293b">—</div>
                    </div>
                </div>
            </div>

            <div style="padding:10px 16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;position:sticky;bottom:0;background:white;border-radius:0 0 14px 14px;">
                <button onclick="window.closeAllModals()" class="btn-secondary" style="padding:6px 14px;font-size:12px;font-weight:600;">Cancel</button>
                <button onclick="window.submitResults(${roundIdx}, ${debateIdx})" class="btn-primary" style="padding:6px 18px;font-size:13px;font-weight:700;">Submit Results</button>
            </div>
        </div>
    `;
    
    // Pre-populate if editing existing results
    if (debate.entered && debate.govResults && debate.oppResults) {
        setTimeout(() => {
            // Update modal title
            const titleEl = modal.querySelector('h2');
            if (titleEl) titleEl.textContent = 'Edit Ballot Results';
            const submitBtn = modal.querySelector('button[onclick*="submitResults"]');
            if (submitBtn) submitBtn.textContent = 'Save Changes';

            // Pre-fill government speakers
            for (let i = 0; i < 3; i++) {
                const speaker = debate.govResults.substantive?.[i];
                if (speaker) {
                    const select = document.getElementById(`gov-sel-${i}`);
                    if (select) {
                        // Check if speaker exists in roster
                        const exists = govSpeakers.some(s => s.name === speaker.speaker);
                        if (exists) {
                            select.value = speaker.speaker;
                        } else {
                            select.value = '__new__';
                            // Could add text input here if needed
                        }
                    }
                    const scoreInput = document.getElementById(`gov-score-${i}`);
                    if (scoreInput) scoreInput.value = speaker.score;
                }
            }
            
            // Pre-fill government reply
            if (debate.govResults.reply && !disableReply) {
                const replySelect = document.getElementById('gov-reply-sel');
                if (replySelect) {
                    const exists = govSpeakers.some(s => s.name === debate.govResults.reply.speaker);
                    if (exists) {
                        replySelect.value = debate.govResults.reply.speaker;
                    } else {
                        replySelect.value = '__new__';
                    }
                }
                const replyScore = document.getElementById('gov-reply-score');
                if (replyScore) replyScore.value = debate.govResults.reply.score;
            }

            // Pre-fill opposition speakers
            for (let i = 0; i < 3; i++) {
                const speaker = debate.oppResults.substantive?.[i];
                if (speaker) {
                    const select = document.getElementById(`opp-sel-${i}`);
                    if (select) {
                        const exists = oppSpeakers.some(s => s.name === speaker.speaker);
                        if (exists) {
                            select.value = speaker.speaker;
                        } else {
                            select.value = '__new__';
                        }
                    }
                    const scoreInput = document.getElementById(`opp-score-${i}`);
                    if (scoreInput) scoreInput.value = speaker.score;
                }
            }
            
            // Pre-fill opposition reply
            if (debate.oppResults.reply && !disableReply) {
                const replySelect = document.getElementById('opp-reply-sel');
                if (replySelect) {
                    const exists = oppSpeakers.some(s => s.name === debate.oppResults.reply.speaker);
                    if (exists) {
                        replySelect.value = debate.oppResults.reply.speaker;
                    } else {
                        replySelect.value = '__new__';
                    }
                }
                const replyScore = document.getElementById('opp-reply-score');
                if (replyScore) replyScore.value = debate.oppResults.reply.score;
            }
        }, 100);
    }
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            if (confirm('Discard unsaved results?')) {
                closeAllModals();
            }
        }
    });
    
    document.body.appendChild(modal);

    // ── Wire live score totals ────────────────────────────────────────────────
    function _updateBallotTotals() {
        let govTotal = 0, oppTotal = 0;
        let govFilled = 0, oppFilled = 0;

        for (let i = 0; i < 3; i++) {
            const g = parseFloat(document.getElementById(`gov-score-${i}`)?.value);
            const o = parseFloat(document.getElementById(`opp-score-${i}`)?.value);
            if (!isNaN(g)) { govTotal += g; govFilled++; }
            if (!isNaN(o)) { oppTotal += o; oppFilled++; }
        }
        if (!disableReply) {
            const gr = parseFloat(document.getElementById('gov-reply-score')?.value);
            const or = parseFloat(document.getElementById('opp-reply-score')?.value);
            if (!isNaN(gr)) { govTotal += gr; govFilled++; }
            if (!isNaN(or)) { oppTotal += or; oppFilled++; }
        }

        const maxSlots = disableReply ? 3 : 4;
        const govEl     = document.getElementById('ballot-gov-total');
        const oppEl     = document.getElementById('ballot-opp-total');
        const verdictEl = document.getElementById('ballot-verdict');
        if (!govEl || !oppEl || !verdictEl) return;

        govEl.textContent = govFilled > 0 ? govTotal.toFixed(1) : '—';
        oppEl.textContent = oppFilled > 0 ? oppTotal.toFixed(1) : '—';

        const bothComplete = govFilled === maxSlots && oppFilled === maxSlots;
        if (bothComplete) {
            const tie = Math.abs(govTotal - oppTotal) < 0.01;
            if (tie) {
                verdictEl.textContent = '\u26a0\ufe0f Tie — not allowed';
                verdictEl.style.background = '#fef3c7';
                verdictEl.style.color = '#92400e';
                govEl.style.color = '#1e293b';
                oppEl.style.color = '#1e293b';
            } else if (govTotal > oppTotal) {
                verdictEl.textContent = '\ud83c\udff7\ufe0f Government leads';
                verdictEl.style.background = '#dbeafe';
                verdictEl.style.color = '#1e40af';
                govEl.style.color = '#1e40af';
                oppEl.style.color = '#1e293b';
            } else {
                verdictEl.textContent = '\u2694\ufe0f Opposition leads';
                verdictEl.style.background = '#fce7f3';
                verdictEl.style.color = '#be185d';
                govEl.style.color = '#1e293b';
                oppEl.style.color = '#be185d';
            }
        } else {
            verdictEl.textContent = `${govFilled + oppFilled}/${maxSlots * 2} scores entered`;
            verdictEl.style.background = '#e2e8f0';
            verdictEl.style.color = '#64748b';
            govEl.style.color = '#1e293b';
            oppEl.style.color = '#1e293b';
        }
    }

    // Attach to all score inputs
    ['gov-score-0','gov-score-1','gov-score-2',
     'opp-score-0','opp-score-1','opp-score-2',
     ...(disableReply ? [] : ['gov-reply-score','opp-reply-score'])
    ].forEach(id => {
        document.getElementById(id)?.addEventListener('input', _updateBallotTotals);
    });

    // Run once immediately in case editing pre-populated results
    setTimeout(_updateBallotTotals, 150);
}


// Check for duplicate speakers.
function checkDuplicateSpeakers(side, includeReply = false) {
    const speakers = [];
    let hasDuplicate = false;

    for (let i = 0; i < 3; i++) {
        const select = document.getElementById(`${side}-sel-${i}`);
        const dupDiv = document.getElementById(`${side}-duplicate-${i}`);
        const speaker = select?.value?.trim();

        if (speaker && speakers.includes(speaker)) {
            hasDuplicate = true;
            if (dupDiv) dupDiv.style.display = 'block';
        } else {
            if (dupDiv) dupDiv.style.display = 'none';
        }

        if (speaker) speakers.push(speaker);
    }

    // Clear any stale reply-duplicate indicator (no longer checked here)
    const replyDupDiv = document.getElementById(`${side}-reply-duplicate`);
    if (replyDupDiv) replyDupDiv.style.display = 'none';

    return hasDuplicate;
}

// ============================================
// SUBMIT RESULTS 
// ============================================

export function submitResults(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    const gov = state.teams.find(t => t.id === debate.gov);
    const opp = state.teams.find(t => t.id === debate.opp);

    if (!gov || !opp) {
        showNotification('Teams not found', 'error');
        return;
    }

    const isAdmin   = state.auth?.currentUser?.role === 'admin';
    const isJudge   = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    const isMyRoom  = isJudge && (debate.panel||[]).some(p => String(p.id) === myJudgeId);

    if (!isAdmin && !isMyRoom) {
        showNotification('You are not authorised to submit this ballot', 'error');
        return;
    }
    
    const errorDiv = document.getElementById('results-error');
    const disableReply = round.disableReply || false;

    // ── Duplicate speaker warning 
    const govHasDup = checkDuplicateSpeakers('gov', false);
    const oppHasDup = checkDuplicateSpeakers('opp', false);
    if (govHasDup || oppHasDup) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = '⚠️ Duplicate speakers detected — the same name appears more than once in a team\'s substantive slots.';
        }
        const proceed = window.confirm(
            'Warning: duplicate speakers detected in this ballot.\n\n' +
            'The same speaker name appears more than once in a team\'s substantive slots.\n\n' +
            'Do you want to submit anyway?'
        );
        if (!proceed) return;
        if (errorDiv) errorDiv.style.display = 'none';
    }
    
    try {
        // Get government scores
        const govSpeakers = [];
        const govScores = [];
        
        for (let i = 0; i < 3; i++) {
            const select = document.getElementById(`gov-sel-${i}`);
            const textInput = document.getElementById(`gov-sel-${i}-txt`);
            
            // Get speaker name from either select or text input
            let speaker = '';
            if (textInput && textInput.style.display !== 'none') {
                speaker = textInput.value.trim();
            } else if (select) {
                speaker = select.value;
            }
            
            const score = parseFloat(document.getElementById(`gov-score-${i}`)?.value);
            
            if (!speaker || isNaN(score)) {
                throw new Error(`Please fill all government speaker ${i+1} fields`);
            }
            if (score < 60 || score > 80) {
                throw new Error(`Government speaker ${i+1} score must be 60-80`);
            }
            govSpeakers.push(speaker);
            govScores.push(score);
        }
        
        let govReply = null;
        let govReplyScore = 0;
        
        if (!disableReply) {
            const replySelect = document.getElementById('gov-reply-sel');
            const replyText = document.getElementById('gov-reply-sel-txt');
            
            if (replyText && replyText.style.display !== 'none') {
                govReply = replyText.value.trim();
            } else if (replySelect) {
                govReply = replySelect.value;
            }
            
            govReplyScore = parseFloat(document.getElementById('gov-reply-score')?.value);
            
            if (!govReply || isNaN(govReplyScore)) {
                throw new Error('Please fill government reply fields');
            }
            if (govReplyScore < 30 || govReplyScore > 40) {
                throw new Error('Government reply score must be 30-40');
            }
            
            // Check speaker 3 not doing reply
            if (govReply === govSpeakers[2]) {
                throw new Error('Government speaker 3 cannot give reply speech');
            }
        }
        
        // Get opposition scores
        const oppSpeakers = [];
        const oppScores = [];
        
        for (let i = 0; i < 3; i++) {
            const select = document.getElementById(`opp-sel-${i}`);
            const textInput = document.getElementById(`opp-sel-${i}-txt`);
            
            let speaker = '';
            if (textInput && textInput.style.display !== 'none') {
                speaker = textInput.value.trim();
            } else if (select) {
                speaker = select.value;
            }
            
            const score = parseFloat(document.getElementById(`opp-score-${i}`)?.value);
            
            if (!speaker || isNaN(score)) {
                throw new Error(`Please fill all opposition speaker ${i+1} fields`);
            }
            if (score < 60 || score > 80) {
                throw new Error(`Opposition speaker ${i+1} score must be 60-80`);
            }
            oppSpeakers.push(speaker);
            oppScores.push(score);
        }
        
        let oppReply = null;
        let oppReplyScore = 0;
        
        if (!disableReply) {
            const replySelect = document.getElementById('opp-reply-sel');
            const replyText = document.getElementById('opp-reply-sel-txt');
            
            if (replyText && replyText.style.display !== 'none') {
                oppReply = replyText.value.trim();
            } else if (replySelect) {
                oppReply = replySelect.value;
            }
            
            oppReplyScore = parseFloat(document.getElementById('opp-reply-score')?.value);
            
            if (!oppReply || isNaN(oppReplyScore)) {
                throw new Error('Please fill opposition reply fields');
            }
            if (oppReplyScore < 30 || oppReplyScore > 40) {
                throw new Error('Opposition reply score must be 30-40');
            }
            
            // Check speaker 3 not doing reply
            if (oppReply === oppSpeakers[2]) {
                throw new Error('Opposition speaker 3 cannot give reply speech');
            }
        }
        
        // Calculate totals
        const govTotal = govScores.reduce((a,b) => a + b, 0) + (govReplyScore || 0);
        const oppTotal = oppScores.reduce((a,b) => a + b, 0) + (oppReplyScore || 0);
        
        if (Math.abs(govTotal - oppTotal) < 0.01) {
            throw new Error('Ties are not allowed - please adjust scores');
        }
        
        // Determine winner
        const govWon = govTotal > oppTotal;
        const winner = govWon ? gov : opp;
        const loser = govWon ? opp : gov;

        // ── Auto-create any new speakers typed into the ballot 
        function ensureSpeaker(team, name) {
            if (!name) return;
            const trimmed = name.trim();
            if (!trimmed) return;
            if (!team.speakers) team.speakers = [];
            
            // Check if speaker already exists (case-insensitive)
            const exists = team.speakers.some(s => s.name.toLowerCase() === trimmed.toLowerCase());
            if (!exists) {
                // Create new speaker object with proper structure
                const newSpeaker = {
                    name: trimmed,
                    substantiveTotal: 0,
                    substantiveCount: 0,
                    substantiveScores: {},
                    replyTotal: 0,
                    replyCount: 0,
                    replyScores: {}
                };
                team.speakers.push(newSpeaker);
                showNotification(`Added "${trimmed}" to ${team.name} roster`, 'info');
            }
        }
        
        govSpeakers.forEach(n => ensureSpeaker(gov, n));
        if (govReply) ensureSpeaker(gov, govReply);
        oppSpeakers.forEach(n => ensureSpeaker(opp, n));
        if (oppReply) ensureSpeaker(opp, oppReply);
        
        // Reverse previous stats if this debate was already entered (editing a result)
        if (debate.entered) {
            const prevGov = state.teams.find(t => t.id === debate.gov);
            const prevOpp = state.teams.find(t => t.id === debate.opp);
            const pg = debate.govResults;
            const po = debate.oppResults;

            if (prevGov && pg) {
                prevGov.wins = Math.max(0, (prevGov.wins || 0) - (pg.total > po.total ? 1 : 0));
                prevGov.total = Math.max(0, (prevGov.total || 0) - pg.total);
                delete prevGov.roundScores?.[round.id];
                
                // Subtract speaker stats
                pg.substantive.forEach(s => {
                    const sp = prevGov.speakers.find(x => x.name === s.speaker);
                    if (sp) {
                        sp.substantiveTotal = Math.max(0, (sp.substantiveTotal || 0) - s.score);
                        sp.substantiveCount = Math.max(0, (sp.substantiveCount || 0) - 1);
                        delete sp.substantiveScores?.[round.id];
                    }
                });
                if (pg.reply) {
                    const sp = prevGov.speakers.find(x => x.name === pg.reply.speaker);
                    if (sp) {
                        sp.replyTotal = Math.max(0, (sp.replyTotal || 0) - pg.reply.score);
                        sp.replyCount = Math.max(0, (sp.replyCount || 0) - 1);
                        delete sp.replyScores?.[round.id];
                    }
                }
            }

            if (prevOpp && po) {
                prevOpp.wins = Math.max(0, (prevOpp.wins || 0) - (po.total > pg.total ? 1 : 0));
                prevOpp.total = Math.max(0, (prevOpp.total || 0) - po.total);
                delete prevOpp.roundScores?.[round.id];
                
                po.substantive.forEach(s => {
                    const sp = prevOpp.speakers.find(x => x.name === s.speaker);
                    if (sp) {
                        sp.substantiveTotal = Math.max(0, (sp.substantiveTotal || 0) - s.score);
                        sp.substantiveCount = Math.max(0, (sp.substantiveCount || 0) - 1);
                        delete sp.substantiveScores?.[round.id];
                    }
                });
                if (po.reply) {
                    const sp = prevOpp.speakers.find(x => x.name === po.reply.speaker);
                    if (sp) {
                        sp.replyTotal = Math.max(0, (sp.replyTotal || 0) - po.reply.score);
                        sp.replyCount = Math.max(0, (sp.replyCount || 0) - 1);
                        delete sp.replyScores?.[round.id];
                    }
                }
            }

            // Restore elimination state if editing a knockout result
            if (round.type === 'knockout') {
                const prevLoser = pg.total > po.total ? prevOpp : prevGov;
                if (prevLoser) prevLoser.eliminated = false;
            }
        }

        // Update team stats
        gov.wins = (gov.wins || 0) + (govWon ? 1 : 0);
        opp.wins = (opp.wins || 0) + (govWon ? 0 : 1);
        
        gov.total = (gov.total || 0) + govTotal;
        opp.total = (opp.total || 0) + oppTotal;
        
        gov.roundScores = gov.roundScores || {};
        opp.roundScores = opp.roundScores || {};
        gov.roundScores[round.id] = govTotal;
        opp.roundScores[round.id] = oppTotal;
        
        // Update speaker stats - find speakers by name (case-insensitive)
        for (let i = 0; i < 3; i++) {
            const govSpeaker = gov.speakers.find(s => s.name.toLowerCase() === govSpeakers[i].toLowerCase());
            if (govSpeaker) {
                govSpeaker.substantiveTotal = (govSpeaker.substantiveTotal || 0) + govScores[i];
                govSpeaker.substantiveScores = govSpeaker.substantiveScores || {};
                govSpeaker.substantiveScores[round.id] = govScores[i];
                govSpeaker.substantiveCount = (govSpeaker.substantiveCount || 0) + 1;
            }
            
            const oppSpeaker = opp.speakers.find(s => s.name.toLowerCase() === oppSpeakers[i].toLowerCase());
            if (oppSpeaker) {
                oppSpeaker.substantiveTotal = (oppSpeaker.substantiveTotal || 0) + oppScores[i];
                oppSpeaker.substantiveScores = oppSpeaker.substantiveScores || {};
                oppSpeaker.substantiveScores[round.id] = oppScores[i];
                oppSpeaker.substantiveCount = (oppSpeaker.substantiveCount || 0) + 1;
            }
        }
        
        if (!disableReply) {
            const govReplySpeaker = gov.speakers.find(s => s.name.toLowerCase() === govReply.toLowerCase());
            if (govReplySpeaker) {
                govReplySpeaker.replyTotal = (govReplySpeaker.replyTotal || 0) + govReplyScore;
                govReplySpeaker.replyScores = govReplySpeaker.replyScores || {};
                govReplySpeaker.replyScores[round.id] = govReplyScore;
                govReplySpeaker.replyCount = (govReplySpeaker.replyCount || 0) + 1;
            }
            
            const oppReplySpeaker = opp.speakers.find(s => s.name.toLowerCase() === oppReply.toLowerCase());
            if (oppReplySpeaker) {
                oppReplySpeaker.replyTotal = (oppReplySpeaker.replyTotal || 0) + oppReplyScore;
                oppReplySpeaker.replyScores = oppReplySpeaker.replyScores || {};
                oppReplySpeaker.replyScores[round.id] = oppReplyScore;
                oppReplySpeaker.replyCount = (oppReplySpeaker.replyCount || 0) + 1;
            }
        }
        
        // Mark debate as entered
        debate.entered = true;
        debate.govResults = {
            teamName: gov.name,
            substantive: govSpeakers.map((name, i) => ({ speaker: name, score: govScores[i] })),
            reply: disableReply ? null : { speaker: govReply, score: govReplyScore },
            total: govTotal
        };
        debate.oppResults = {
            teamName: opp.name,
            substantive: oppSpeakers.map((name, i) => ({ speaker: name, score: oppScores[i] })),
            reply: disableReply ? null : { speaker: oppReply, score: oppReplyScore },
            total: oppTotal
        };

        // For knockout rounds: eliminate the losing team immediately
        if (round.type === 'knockout') {
            loser.eliminated = true;
            
            // Check if this is the final (only one debate)
            if (round.debates.length === 1) {
                showNotification(`🏆 Champion: ${winner.name}!`, 'success');
            }
        }
        
        saveNow();
        
        closeAllModals();
        renderDraw();
        renderStandings();
        
        // Force refresh of speaker standings
        if (typeof window.renderSpeakerStandings === 'function') {
            setTimeout(() => window.renderSpeakerStandings(), 100);
        }
        
        showNotification(
            `✅ Results saved! Winner: ${winner.name} (${Math.max(govTotal, oppTotal).toFixed(1)} - ${Math.min(govTotal, oppTotal).toFixed(1)})`, 
            'success'
        );
        
    } catch (error) {
        if (errorDiv) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = '❌ ' + error.message;
            errorDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

// ============================================================================
// SPEECH DRAW CARD
// ============================================================================

function renderSpeechDebateCard(round, debate, roundIdx, debateIdx) {
    const isAdmin   = state.auth?.currentUser?.role === 'admin';
    const isJudge   = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    const isMyRoom  = isJudge && (debate.panel || []).some(p => String(p.id) === myJudgeId);
    const isBlinded = round.blinded || false;
    const room      = round.rooms?.[debateIdx] || (`Room ${debateIdx + 1}`);
    const speakers  = debate.roomSpeakers || [];

    const statusDot   = debate.entered ? '#10b981' : (debate.panel?.length ? '#f59e0b' : '#ef4444');
    const statusLabel = debate.entered ? '✅ Scored' : '⏳ Pending';

    const judgeNames = (debate.panel || []).map(p => {
        const j = (state.judges || []).find(j => j.id == p.id);
        return j ? escapeHTML(j.name) : '';
    }).filter(Boolean).join(', ');

    const speakerRows = speakers.map((spk, idx) => {
        let scoreHtml = '';
        if (debate.entered && debate.speechResults && !isBlinded) {
            const res   = debate.speechResults.find(r => r.speakerName === spk.speakerName && r.teamId === spk.teamId);
            const score = res?.score;
            const rank  = res?.rank;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ('#' + rank);
            scoreHtml = score != null
                ? '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px;font-weight:800;color:#1e293b">' + score.toFixed(1) + '</span><span style="font-size:13px;color:#64748b">' + medal + '</span></div>'
                : '';
        }
        const bg = idx % 2 === 0 ? '#f8fafc' : 'white';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:' + bg + ';border-radius:8px;margin-bottom:4px">' +
            '<div>' +
            '<div style="font-weight:700;color:#1e293b;font-size:14px">' + escapeHTML(spk.speakerName) + '</div>' +
            '<div style="font-size:11px;color:#94a3b8;margin-top:1px">' + escapeHTML(spk.teamName) + '</div>' +
            '</div>' + scoreHtml + '</div>';
    }).join('');

    const availableJudges = (state.judges || []).filter(j => !(debate.panel || []).some(p => p.id == j.id));
    const freeJudges      = availableJudges.filter(j => !round.debates.some((d, di) => di !== debateIdx && (d.panel || []).some(p => p.id == j.id)));
    const otherJudges     = availableJudges.filter(j =>  round.debates.some((d, di) => di !== debateIdx && (d.panel || []).some(p => p.id == j.id)));

    const judgeChips = (debate.panel || []).map(p => {
        const j = (state.judges || []).find(j => j.id == p.id);
        if (!j) return '';
        const isChairS = p.role === 'chair';
        const roleTitleS = isAdmin && !debate.entered ? (isChairS ? 'Chair — click to make wing' : 'Wing — click to make chair') : p.role;
        return '<span class="dnd-judge-chip"' +
            (!debate.entered && isAdmin ? ' draggable="true" ondragstart="window.dndJudgeDragStart(event,\'' + j.id + '\',' + roundIdx + ',' + debateIdx + ')" ondragend="window.dndDragEnd(event)"' : '') + '>' +
            '<span class="chip-role' + (isChairS ? ' chair' : '') + '" title="' + roleTitleS + '"' +
            (!debate.entered && isAdmin ? ' onclick="event.stopPropagation();window.toggleJudgeRole(' + roundIdx + ',' + debateIdx + ',\'' + j.id + '\')"' : '') + '>' +
            p.role + '</span>' +
            escapeHTML(j.name) +
            (!debate.entered && isAdmin ? '<button class="chip-remove" onclick="window.removeJudgeFromPanel(' + roundIdx + ',' + debateIdx + ',\'' + j.id + '\')">×</button>' : '') +
            '</span>';
    }).join('');

    const freeOpts  = freeJudges.map(j  => '<option value="' + j.id + '">' + escapeHTML(j.name) + ' (' + j.role + ')</option>').join('');
    const otherOpts = otherJudges.map(j => '<option value="' + j.id + '">' + escapeHTML(j.name) + ' (' + j.role + ')</option>').join('');
    const addJudgeDropdown = (!debate.entered && isAdmin && availableJudges.length > 0)
        ? '<select class="judge-add-select" onchange="if(this.value){window.addJudgeToPanel(' + roundIdx + ',' + debateIdx + ',this.value);this.value=\'\'}">' +
          '<option value="">+ Add Judge</option>' +
          (freeOpts  ? '<optgroup label="Available">'    + freeOpts  + '</optgroup>' : '') +
          (otherOpts ? '<optgroup label="In other rooms">' + otherOpts + '</optgroup>' : '') +
          '</select>'
        : '';

    const canScore = !debate.entered && (isAdmin || isMyRoom);
    const canEdit  = debate.entered && !isBlinded;
    const managePanelBtn = (!debate.entered && isAdmin)
        ? '<button onclick="window.showJudgeManagement(' + roundIdx + ',' + debateIdx + ')" class="btn-secondary" style="padding:4px 10px;font-size:12px" title="Manage judge panel">⚙️ Panel</button>'
        : '';
    const btnHtml  = canScore
        ? managePanelBtn + '<button onclick="window.showEnterResults(' + roundIdx + ',' + debateIdx + ')" class="btn-primary" style="padding:4px 12px;font-size:12px' + (isMyRoom && !isAdmin ? ';background:#7c3aed' : '') + '">📝 ' + (isAdmin ? 'Enter Scores' : 'Submit Scores') + '</button>'
        : (canEdit
            ? '<button onclick="window.viewDebateDetails(' + roundIdx + ',' + debateIdx + ')" class="btn-secondary" style="padding:4px 10px;font-size:12px">📊 Details</button>' +
              (isAdmin ? '<button onclick="window.editResults(' + roundIdx + ',' + debateIdx + ')" class="btn-secondary" style="padding:4px 10px;font-size:12px">Edit</button>' : '')
            : '');

    return '<div class="draw-room ' + (debate.entered ? 'done' : 'pending-partial') + '" style="background:white;border-radius:10px;border-left:4px solid ' + statusDot + ';padding:14px;margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                '<strong style="font-size:14px;color:#1e293b">' + escapeHTML(room) + '</strong>' +
                '<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">🎤 SPEECH</span>' +
                '<span style="font-size:12px;font-weight:600;color:' + (debate.entered ? '#10b981' : '#f59e0b') + '">' + statusLabel + '</span>' +
                '<span style="font-size:12px;color:#94a3b8">' + speakers.length + ' speakers</span>' +
            _judgePillHtml(debate, "🎯") +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' + btnHtml + '</div>' +
        '</div>' +
        '<div style="margin-bottom:10px">' + speakerRows + '</div>' +
        '<div style="border-top:1px solid #f1f5f9;padding-top:10px;display:flex;flex-wrap:wrap;align-items:center;gap:6px">' +
            '<span style="font-size:11px;color:#94a3b8;font-weight:600">JUDGE</span>' +
            '<div class="dnd-judge-zone" style="flex:1"' +
            (!debate.entered && isAdmin ? ' ondragover="window.dndJudgeDragOver(event,' + roundIdx + ',' + debateIdx + ')" ondragleave="window.dndDragLeave(event)" ondrop="window.dndJudgeDrop(event,' + roundIdx + ',' + debateIdx + ')"' : '') + '>' +
            (judgeChips || '<span style="font-size:12px;color:' + (isAdmin ? '#ef4444' : '#94a3b8') + ';font-style:italic">' + (isAdmin ? 'No judge assigned' : '—') + '</span>') +
            addJudgeDropdown +
            '</div>' +
        '</div>' +
    '</div>';
}


// ============================================================================
// SPEECH ENTER SCORES MODAL
// ============================================================================

function showSpeechEnterResults(roundIdx, debateIdx) {
    const round   = state.rounds[roundIdx];
    const debate  = round.debates[debateIdx];
    const isAdmin   = state.auth?.currentUser?.role === 'admin';
    const isJudge   = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    const isMyRoom  = isJudge && (debate.panel || []).some(p => String(p.id) === myJudgeId);

    if (!isAdmin && !isMyRoom) { showNotification('You are not assigned to this room', 'error'); return; }
    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    const speakers = debate.roomSpeakers || [];
    const modal    = document.createElement('div');
    modal.className = 'modal-overlay ballot-modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';

    const speakerFields = speakers.map((spk, idx) => {
        const existing = debate.speechResults?.find(r => r.speakerName === spk.speakerName && r.teamId === spk.teamId);
        return '<div style="display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:10px 14px;background:' + (idx % 2 === 0 ? '#f8fafc' : 'white') + ';border-radius:6px;border:1px solid #e2e8f0;margin-bottom:6px">' +
            '<div>' +
            '<div style="font-weight:700;color:#1e293b;font-size:13px">' + escapeHTML(spk.speakerName) + '</div>' +
            '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + escapeHTML(spk.teamName) + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
            '<label style="font-size:10px;font-weight:700;color:#64748b;white-space:nowrap">Score</label>' +
            '<input type="number" id="speech-score-' + idx + '" min="0" max="100" step="0.5"' +
            ' value="' + (existing?.score ?? '') + '" placeholder="0–100"' +
            ' style="width:70px;padding:7px 8px;border-radius:6px;border:1px solid #cbd5e1;font-size:14px;font-weight:700;text-align:center">' +
            '</div>' +
            '</div>';
    }).join('');

    modal.innerHTML =
        '<div style="background:white;border-radius:14px;max-width:450px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
        '<div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;border-radius:14px 14px 0 0;flex-shrink:0;">' +
        '<h2 style="margin:0 0 4px;color:#1e293b;font-size:16px">Speech Scores</h2>' +
        '<p style="margin:0;color:#64748b;font-size:11px">Round ' + round.id + ' · ' + escapeHTML(roomLabel) + (round.motion ? ' · ' + escapeHTML(round.motion) : '') + '</p>' +
        '</div>' +
        '<div style="padding:14px 18px;overflow-y:auto;flex:1;">' +
        '<div id="speech-score-error" style="display:none;background:#fee2e2;color:#991b1b;padding:8px 10px;border-radius:6px;margin-bottom:10px;font-weight:600;font-size:12px"></div>' +
        '<p style="margin:0 0 10px;font-size:11px;color:#94a3b8">Score each speaker (0–100)</p>' +
        speakerFields +
        '</div>' +
        '<div style="padding:10px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;border-radius:0 0 14px 14px;background:white;flex-shrink:0;">' +
        '<button onclick="window.closeAllModals()" class="btn-secondary" style="padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px">Cancel</button>' +
        '<button onclick="window.submitSpeechResults(' + roundIdx + ',' + debateIdx + ')" class="btn-primary" style="padding:10px 20px;border-radius:6px;font-weight:600;font-size:13px">Save</button>' +
        '</div>' +
        '</div>';

    modal.addEventListener('click', e => { if (e.target === modal && confirm('Discard unsaved scores?')) closeAllModals(); });
    document.body.appendChild(modal);
}


// ============================================================================
// SPEECH SUBMIT SCORES
// ============================================================================

function submitSpeechResults(roundIdx, debateIdx) {
    const round    = state.rounds[roundIdx];
    const debate   = round.debates[debateIdx];
    const speakers = debate.roomSpeakers || [];
    const errorDiv = document.getElementById('speech-score-error');

    try {
        const results = speakers.map((spk, idx) => {
            const raw   = document.getElementById('speech-score-' + idx)?.value;
            const score = parseFloat(raw);
            if (raw === '' || raw == null || isNaN(score)) throw new Error('Please enter a score for ' + spk.speakerName);
            if (score < 0 || score > 100)                  throw new Error('Score for ' + spk.speakerName + ' must be 0–100');
            return { ...spk, score };
        });

        // Rank within room (1 = highest)
        const sorted = [...results].sort((a, b) => b.score - a.score);
        results.forEach(r => { r.rank = sorted.indexOf(r) + 1; });

        // Reverse previous stats if re-scoring
        if (debate.entered && debate.speechResults) {
            debate.speechResults.forEach(prev => {
                const team = (state.teams || []).find(t => t.id === prev.teamId);
                if (!team) return;
                const spk = (team.speakers || []).find(s => s.name === prev.speakerName);
                if (!spk) return;
                spk.substantiveTotal = Math.max(0, (spk.substantiveTotal || 0) - prev.score);
                spk.substantiveCount = Math.max(0, (spk.substantiveCount || 0) - 1);
                if (spk.substantiveScores) delete spk.substantiveScores[round.id];
            });
        }

        // Write scores to speaker objects
        results.forEach(r => {
            const team = (state.teams || []).find(t => t.id === r.teamId);
            if (!team) return;
            if (!team.speakers) team.speakers = [];
            let spk = team.speakers.find(s => s.name === r.speakerName);
            if (!spk) {
                spk = { name: r.speakerName, substantiveTotal: 0, substantiveCount: 0, substantiveScores: {}, replyTotal: 0, replyCount: 0, replyScores: {} };
                team.speakers.push(spk);
            }
            spk.substantiveTotal  = (spk.substantiveTotal || 0) + r.score;
            spk.substantiveCount  = (spk.substantiveCount || 0) + 1;
            spk.substantiveScores = spk.substantiveScores || {};
            spk.substantiveScores[round.id] = r.score;
        });

        debate.entered       = true;
        debate.speechResults = results;

        saveNow();
        closeAllModals();
        renderDraw();
        if (typeof window.renderSpeechTab        === 'function') window.renderSpeechTab('speech-tab-body');
        if (typeof window.renderSpeakerStandings === 'function') setTimeout(() => window.renderSpeakerStandings(), 100);

        const topScore = Math.max(...results.map(r => r.score));
        const winner   = results.find(r => r.score === topScore);
        showNotification('✅ Scores saved! Top: ' + (winner?.speakerName || '') + ' (' + topScore.toFixed(1) + ')', 'success');

    } catch (err) {
        if (errorDiv) { errorDiv.style.display = 'block'; errorDiv.textContent = '❌ ' + err.message; errorDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
}
window.submitSpeechResults    = submitSpeechResults;
window.showSpeechEnterResults = showSpeechEnterResults;

// ============================================================================
// BP BALLOT — enter results for a 4-team British Parliamentary room
// ============================================================================

function showBPEnterResults(roundIdx, debateIdx) {
    const round  = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];

    const isAdmin  = state.auth?.currentUser?.role === 'admin';
    const isJudge  = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;
    const isMyRoom  = isJudge && (debate.panel||[]).some(p => String(p.id) === myJudgeId);

    if (!isAdmin && !isMyRoom) { showNotification('You are not assigned to this room', 'error'); return; }
    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;

    const positions = [
        { key:'og', label:'OG', fullLabel:'Opening Government', color:'#1e40af', bg:'#eff6ff', border:'#bfdbfe' },
        { key:'oo', label:'OO', fullLabel:'Opening Opposition',  color:'#3118be', bg:'#fdf2f8', border:'#fbcfe8' },
        { key:'cg', label:'CG', fullLabel:'Closing Government',  color:'#065f46', bg:'#f0fdf4', border:'#86efac' },
        { key:'co', label:'CO', fullLabel:'Closing Opposition',  color:'#7c3aed', bg:'#faf5ff', border:'#e9d5ff' },
    ];

    // Build speaker combos per position
    function speakerPanel(pos) {
        const team = state.teams.find(t => t.id === debate[pos.key]);
        if (!team) return '';
        // BP: always exactly 2 speakers per team
        const panels = [0, 1].map(i => `
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px;margin-bottom:6px;align-items:start;">
                ${_buildSpeakerCombo(`bp-sel-${pos.key}-${i}`, team.speakers, pos.color, `bp-new-${pos.key}-${i}`)}
                <input type="number" id="bp-score-${pos.key}-${i}" min="50" max="100" step="0.5" placeholder="50–100"
                       oninput="window._bpUpdateLive()"
                       style="padding:7px;border-radius:6px;border:1px solid #cbd5e1;font-size:12px;">
            </div>`).join('');
        return `
        <div style="background:${pos.bg};border:2px solid ${pos.border};border-radius:8px;padding:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="font-weight:700;color:${pos.color};font-size:12px;">${pos.label} — ${escapeHTML(team.name)}</div>
                <div id="bp-auto-rank-${pos.key}" style="font-size:11px;font-weight:700;color:#94a3b8;background:#f1f5f9;padding:2px 8px;border-radius:10px;">— pts</div>
            </div>
            <label style="font-size:10px;font-weight:700;color:#64748b;display:block;margin-bottom:3px;text-transform:uppercase;">Speakers</label>
            ${panels}
        </div>`;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay ballot-modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.4);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;animation:fadeIn 0.2s ease;';

    modal.innerHTML = `
    <div style="background:white;border-radius:16px;max-width:650px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.2);overflow:hidden;transform:translateY(0);animation:slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
        <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;position:sticky;top:0;background:rgba(255,255,255,0.95);backdrop-filter:blur(8px);z-index:10;">
            <h2 style="margin:0 0 4px;color:#0f172a;font-size:16px;font-weight:800;letter-spacing:-0.02em;">BP Ballot — Round ${round.id} · ${escapeHTML(roomLabel)}</h2>
            <p style="margin:0;color:#64748b;font-size:11px;font-weight:500;">${escapeHTML(round.motion||'')}</p>
        </div>
        <div style="padding:14px 18px;overflow-y:auto;flex:1;">
            <div id="bp-results-error" style="display:none;background:#fee2e2;color:#991b1b;padding:10px;border-radius:6px;margin-bottom:12px;font-weight:600;font-size:12px;"></div>

            <!-- Live ranking summary -->
            <div id="bp-live-summary" background:#f8fafc;border:2px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:14px;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:6px;">Auto Rankings</div>
                <div id="bp-rank-display" style="display:flex;gap:8px;flex-wrap:wrap;">
                    <span style="color:#94a3b8;font-size:11px;font-style:italic;">Enter scores…</span>
                </div>
            </div>

        <div class="modal-results-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            ${positions.map(pos => speakerPanel(pos)).join('')}
        </div>
        </div>
        <div style="padding:10px 18px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;position:sticky;bottom:0;background:white;border-radius:0 0 16px 16px;">
            <button onclick="window.closeAllModals()" class="btn-secondary" style="padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px;">Cancel</button>
            <button onclick="window.submitBPResults(${roundIdx},${debateIdx})" class="btn-primary" style="padding:10px 24px;border-radius:6px;font-weight:600;font-size:13px;">Submit</button>
        </div>
    </div>`;

    // Pre-fill if editing
    if (debate.entered && debate.bpRanks) {
        setTimeout(() => {
            positions.forEach(pos => {
                const team = state.teams.find(t => t.id === debate[pos.key]);
                (debate.bpSpeakers?.[pos.key] || []).forEach((s, i) => {
                    // Primary: stored speaker name. Fallbacks for older ballots.
                    let name = s.speaker || '';
                    if (!name && s.speakerId) {
                        const spkObj = (team?.speakers || []).find(x => String(x.id) === String(s.speakerId));
                        name = spkObj?.name || '';
                    }
                    if (!name && team?.speakers?.length) {
                        const sp = (team.speakers || []).find(x => x.substantiveScores?.[round.id] === s.score);
                        name = sp?.name || '';
                    }
                    if (name) window._spkComboSetValue(`bp-sel-${pos.key}-${i}`, name, team?.speakers || []);
                    const inp = document.getElementById(`bp-score-${pos.key}-${i}`);
                    if (inp && s.score != null) { inp.value = s.score; inp.dispatchEvent(new Event('input',{bubbles:true})); }
                });
            });
            window._bpUpdateLive();
        }, 350);
    }

    // Wire up BP score inputs to also fire _bpUpdateLive (combos dispatch 'input' on hidden inputs — scores use oninput inline)
    modal.addEventListener('click', e => { if (e.target===modal && confirm('Discard unsaved results?')) closeAllModals(); });
    document.body.appendChild(modal);

    // Wire NEW badges for BP combos after DOM is ready
    setTimeout(() => {
        positions.forEach(pos => {
            const team = state.teams.find(t => t.id === debate[pos.key]);
            const knownNames = new Set((team?.speakers||[]).map(s => s.name.toLowerCase()));
            for (let i = 0; i < 2; i++) {
                const hidden = document.getElementById(`bp-sel-${pos.key}-${i}`);
                const badge  = document.getElementById(`bp-new-${pos.key}-${i}`);
                if (hidden && badge) {
                    hidden.addEventListener('input', () => {
                        const v = hidden.value.trim();
                        badge.style.display = (v && !knownNames.has(v.toLowerCase())) ? 'inline-block' : 'none';
                    });
                }
            }
        });
    }, 50);

    window._bpUpdateLive = function() {
        const display = document.getElementById('bp-rank-display');
        if (!display) return;

        const rankLabels = { 1:'🥇 1st', 2:'🥈 2nd', 3:'🥉 3rd', 4:'4th' };

        // Compute totals for each position from the 2 speaker scores
        const totals = {};
        positions.forEach(pos => {
            let sum = 0, filled = 0;
            for (let i = 0; i < 2; i++) {
                const v = parseFloat(document.getElementById(`bp-score-${pos.key}-${i}`)?.value);
                if (!isNaN(v)) { sum += v; filled++; }
            }
            totals[pos.key] = { sum, filled };
        });

        const allFilled = positions.every(p => totals[p.key].filled === 2);

        if (!allFilled) {
            // Show partial totals on each card badge
            positions.forEach(pos => {
                const badge = document.getElementById(`bp-auto-rank-${pos.key}`);
                if (!badge) return;
                const t = totals[pos.key];
                badge.textContent = t.filled > 0 ? `${t.sum.toFixed(1)} pts` : '— pts';
                badge.style.background = '#f1f5f9';
                badge.style.color = '#94a3b8';
            });
            display.innerHTML = '<span style="color:#94a3b8;font-size:13px;font-style:italic;">Enter all scores to see rankings…</span>';
            return;
        }

        // Sort positions by total descending to assign ranks
        const sorted = [...positions].sort((a, b) => totals[b.key].sum - totals[a.key].sum);
        const rankColors = ['#f59e0b','#94a3b8','#b45309','#64748b'];
        const rankBgs    = ['#fef3c7','#f1f5f9','#fef3c7','#f1f5f9'];

        sorted.forEach((pos, rankIdx) => {
            const rank = rankIdx + 1;
            const badge = document.getElementById(`bp-auto-rank-${pos.key}`);
            if (!badge) return;
            badge.textContent = `${rankLabels[rank]} · ${totals[pos.key].sum.toFixed(1)}`;
            badge.style.background = rankBgs[rankIdx];
            badge.style.color = rankColors[rankIdx];
            badge.style.border = `1px solid ${rankColors[rankIdx]}`;
        });

        // Update summary bar
        display.innerHTML = sorted.map((pos, i) => {
            const team = state.teams.find(t => t.id === debate[pos.key]);
            return `<span style="padding:6px 12px;border-radius:16px;background:${pos.bg};border:1px solid ${pos.border};color:${pos.color};font-size:12px;font-weight:700;">${rankLabels[i+1]} · ${escapeHTML(team?.name||pos.label)} (${totals[pos.key].sum.toFixed(1)})</span>`;
        }).join('');
    };
}

function submitBPResults(roundIdx, debateIdx) {
    const round  = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    const errorDiv = document.getElementById('bp-results-error');

    const positions = ['og','oo','cg','co'];
    const PTS_FOR_RANK = {1:3, 2:2, 3:1, 4:0};

    try {
        // Collect and validate speaker scores — always exactly 2 per team
        const speakers = {};
        const teamScoreTotals = {};
        positions.forEach(pos => {
            const team = state.teams.find(t => t.id === debate[pos]);
            if (!team) return;
            speakers[pos] = [];
            let posTotal = 0;
            for (let i = 0; i < 2; i++) {
                const spk = document.getElementById(`bp-sel-${pos}-${i}`)?.value?.trim();
                const scr = parseFloat(document.getElementById(`bp-score-${pos}-${i}`)?.value);
                if (!spk) throw new Error(`Enter speaker ${i+1} name for ${pos.toUpperCase()}`);
                if (isNaN(scr) || scr < 50 || scr > 100) throw new Error(`${pos.toUpperCase()} speaker ${i+1} score must be 50–100`);
                const speakerObj = team.speakers.find(s => s.name === spk);

                speakers[pos].push({
                    speaker:   spk,              // ← required for standings + pre-fill
                    speakerId: speakerObj?.id,
                    score:     scr
                });
                                posTotal += scr;
            }
            teamScoreTotals[pos] = posTotal;
        });

        // Auto-derive ranks from speaker totals — highest total = 1st, no low-point wins
        const sortedByScore = [...positions].sort((a, b) => teamScoreTotals[b] - teamScoreTotals[a]);
        const ranks = {};
        sortedByScore.forEach((pos, i) => { ranks[pos] = i + 1; });

        // Detect ties — two teams with identical totals get the same numeric rank; warn
        const totalsArr = positions.map(p => teamScoreTotals[p]);
        const hasTiedTotal = totalsArr.some((v, i) => totalsArr.indexOf(v) !== i);
        if (hasTiedTotal) {
            throw new Error('Two or more teams have identical speaker totals — adjust scores to break the tie');
        }

        // Revert previous BP stats if editing
        if (debate.entered && debate.bpRanks) {
            positions.forEach(pos => {
                const team = state.teams.find(t => t.id === debate[pos]);
                if (!team) return;
                const oldRank = debate.bpRanks[pos];
                team.wins  = Math.max(0, (team.wins  || 0) - (oldRank <= 2 ? 1 : 0));
                team.total = Math.max(0, (team.total || 0) - (debate[`${pos}Score`] || 0));
                delete team.roundScores?.[round.id];
                (debate.bpSpeakers?.[pos] || []).forEach(s => {
                    const sp = team.speakers.find(x => x.name === s.speaker);
                    if (sp) {
                        sp.substantiveTotal = Math.max(0, (sp.substantiveTotal||0) - s.score);
                        sp.substantiveCount = Math.max(0, (sp.substantiveCount||0) - 1);
                        delete sp.substantiveScores?.[round.id];
                    }
                });
            });
        }

        // Auto-create any new speakers typed into the ballot
        positions.forEach(pos => {
            const team = state.teams.find(t => t.id === debate[pos]);
            if (!team) return;
            team.speakers = team.speakers || [];
            (speakers[pos] || []).forEach(s => {
                const trimmed = s.speaker?.trim();
                if (trimmed && !team.speakers.some(sp => sp.name === trimmed)) {
                    team.speakers.push({ name: trimmed });
                    showNotification(`Added "${trimmed}" to ${team.name} roster`, 'info');
                }
            });
        });

        // Apply new stats — rank awarded by score order (no low-point wins)
        positions.forEach(pos => {
            const team = state.teams.find(t => t.id === debate[pos]);
            if (!team) return;
            const spkTotal = teamScoreTotals[pos];
            // In BP, "wins" = count of 1st or 2nd place finishes (not raw points)
            team.wins  = (team.wins  || 0) + (ranks[pos] <= 2 ? 1 : 0);
            team.total = (team.total || 0) + spkTotal;
            team.roundScores = team.roundScores || {};
            team.roundScores[round.id] = spkTotal;
            speakers[pos].forEach(s => {
                const sp = team.speakers.find(x => x.name === s.speaker);
                if (sp) {
                    sp.substantiveTotal = (sp.substantiveTotal || 0) + s.score;
                    sp.substantiveCount = (sp.substantiveCount || 0) + 1;
                    sp.substantiveScores = sp.substantiveScores || {};
                    sp.substantiveScores[round.id] = s.score;
                }
            });
        });

        // Save results onto debate object
        debate.entered    = true;
        debate.bpRanks    = ranks;
        debate.bpSpeakers = speakers;
        positions.forEach(pos => { debate[`${pos}Score`] = teamScoreTotals[pos]; });

        saveNow();
        closeAllModals();
        renderDraw();
        renderStandings();
        if (typeof window.renderSpeakerStandings === 'function') window.renderSpeakerStandings();

        const winner = state.teams.find(t => t.id === debate[Object.keys(ranks).find(p => ranks[p]===1)]);
        showNotification(`✅ Ballot saved! 1st: ${winner?.name||'?'}`, 'success');

    } catch(err) {
        if (errorDiv) { errorDiv.style.display='block'; errorDiv.textContent='❌ '+err.message; errorDiv.scrollIntoView({behavior:'smooth',block:'nearest'}); }
    }
}
window.submitBPResults = submitBPResults;

// ============================================
// VIEW DEBATE DETAILS
// ============================================

function viewDebateDetails(roundIdx, debateIdx) {
    const round = state.rounds[roundIdx];
    const debate = round.debates[debateIdx];
    const gov = state.teams.find(t => t.id === debate.gov);
    const opp = state.teams.find(t => t.id === debate.opp);
    
    if (!debate.entered) {
        showNotification('No results entered yet', 'info');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 20px;';
    
    modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 700px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding: 24px; border-bottom: 1px solid #e2e8f0; flex-shrink: 0;">
                <h2 style="margin: 0 0 8px 0; color: #1e293b;">📊 Debate Results</h2>
                <p style="margin: 0; color: #64748b; font-size: 14px;">Round ${round.id}: ${escapeHTML(round.motion)}</p>
            </div>
            
            <div style="padding: 24px; overflow-y: auto; flex: 1;">
                <div class="modal-results-grid" style="margin-bottom: 24px;">
                    <div style="text-align: center; padding: 20px; background: ${debate.govResults.total > debate.oppResults.total ? '#d1fae5' : '#f8fafc'}; border-radius: 12px; border: 2px solid ${debate.govResults.total > debate.oppResults.total ? '#10b981' : '#e2e8f0'};">
                        <h3 style="margin: 0 0 8px 0; color: #1e40af; font-size: 18px;">${escapeHTML(gov.name)}</h3>
                        <div style="font-size: 36px; font-weight: 700; color: #1e293b;">${debate.govResults.total.toFixed(1)}</div>
                        ${debate.govResults.total > debate.oppResults.total ? '<div style="margin-top: 8px; color: #10b981; font-weight: 600; font-size: 14px;">🏆 WINNER</div>' : ''}
                    </div>
                    
                    <div style="text-align: center; padding: 20px; background: ${debate.oppResults.total > debate.govResults.total ? '#d1fae5' : '#f8fafc'}; border-radius: 12px; border: 2px solid ${debate.oppResults.total > debate.govResults.total ? '#10b981' : '#e2e8f0'};">
                        <h3 style="margin: 0 0 8px 0; color: #be185d; font-size: 18px;">${escapeHTML(opp.name)}</h3>
                        <div style="font-size: 36px; font-weight: 700; color: #1e293b;">${debate.oppResults.total.toFixed(1)}</div>
                        ${debate.oppResults.total > debate.govResults.total ? '<div style="margin-top: 8px; color: #10b981; font-weight: 600; font-size: 14px;">🏆 WINNER</div>' : ''}
                    </div>
                </div>
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 12px;">
                    <h4 style="margin: 0 0 12px 0; color: #1e293b;">Speaker Breakdown</h4>
                    
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 2px solid #e2e8f0;">
                                <th style="padding: 8px; text-align: left; color: #64748b; font-size: 12px;">Speaker</th>
                                <th style="padding: 8px; text-align: center; color: #64748b; font-size: 12px;">Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${debate.govResults.substantive.map((s, i) => `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 10px; color: #1e293b;">${escapeHTML(s.speaker)} (G${i+1})</td>
                                    <td style="padding: 10px; text-align: center; font-weight: 600;">${s.score.toFixed(1)}</td>
                                 </tr>
                            `).join('')}
                            ${debate.govResults.reply ? `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 10px; color: #1e293b;">${escapeHTML(debate.govResults.reply.speaker)} (Reply)</td>
                                    <td style="padding: 10px; text-align: center; font-weight: 600;">${debate.govResults.reply.score.toFixed(1)}</td>
                                 </tr>
                            ` : ''}
                            ${debate.oppResults.substantive.map((s, i) => `
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 10px; color: #1e293b;">${escapeHTML(s.speaker)} (O${i+1})</td>
                                    <td style="padding: 10px; text-align: center; font-weight: 600;">${s.score.toFixed(1)}</td>
                                 </tr>
                            `).join('')}
                            ${debate.oppResults.reply ? `
                                 <tr>
                                    <td style="padding: 10px; color: #1e293b;">${escapeHTML(debate.oppResults.reply.speaker)} (Reply)</td>
                                    <td style="padding: 10px; text-align: center; font-weight: 600;">${debate.oppResults.reply.score.toFixed(1)}</td>
                                 </tr>
                            ` : ''}
                        </tbody>
                     </table>
                </div>
                
                ${debate.panel?.length > 0 ? `
                    <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; font-size: 13px; color: #64748b;">
                        <strong style="color: #1e293b;">Panel:</strong> ${debate.panel.map(p => {
                            const judge = state.judges.find(j => j.id === p.id);
                            return judge ? judge.name : '';
                        }).filter(Boolean).join(', ')}
                    </div>
                ` : ''}
            </div>
            
            <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; flex-shrink: 0; background: white; border-radius: 0 0 16px 16px;">
                <button onclick="window.closeAllModals()" class="btn-primary" style="padding: 10px 24px; border-radius: 8px;">
                    Close
                </button>
            </div>
        </div>
    `;
    
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeAllModals();
    });
    
    document.body.appendChild(modal);
}

// ============================================
// EDIT RESULTS (RE-OPEN RESULTS MODAL)
// ============================================

function editResults(roundIdx, debateIdx) {
    if (!confirm('Editing results will recalculate team and speaker stats. Continue?')) {
        return;
    }
    
    // Re-open the results modal
    showEnterResults(roundIdx, debateIdx);
}


// ============================================
// EDIT MOTION MODAL
// ============================================

function showEditMotionModal(roundIdx) {
    const round = state.rounds[roundIdx];
    if (!round) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    modal.innerHTML = `
        <div style="background:white;border-radius:16px;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);">
            <div style="padding:24px;border-bottom:1px solid #e2e8f0;flex-shrink:0;">
                <h2 style="margin:0 0 4px;color:#1e293b;">Edit Round ${round.id} Motion</h2>
                <p style="margin:0;color:#64748b;font-size:14px;">Update the motion and optional info slide for this round.</p>
            </div>
            <div style="padding:24px;overflow-y:auto;flex:1;">
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:6px;font-size:14px;">Motion *</label>
                    <textarea id="edit-motion-text" rows="3" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;">${escapeHTML(round.motion||'')}</textarea>
                </div>
                <div>
                    <label style="display:block;font-weight:600;color:#1e293b;margin-bottom:6px;font-size:14px;">Info Slide <span style="font-weight:400;color:#64748b;">(optional)</span></label>
                    <textarea id="edit-motion-infoslide" rows="3" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;">${escapeHTML(round.infoslide||'')}</textarea>
                </div>
            </div>
            <div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;flex-shrink:0;background:white;border-radius:0 0 16px 16px;">
                <button onclick="window.closeAllModals()" class="btn-secondary" style="padding:10px 20px;border-radius:8px;">Cancel</button>
                <button onclick="window._saveMotion(${roundIdx})" class="btn-primary" style="padding:10px 24px;border-radius:8px;font-weight:600;">Save Motion</button>
            </div>
        </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) closeAllModals(); });
    document.body.appendChild(modal);
}

window._saveMotion = function(roundIdx) {
    const round = state.rounds[roundIdx];
    if (!round) return;
    const motion = document.getElementById('edit-motion-text')?.value.trim();
    const infoslide = document.getElementById('edit-motion-infoslide')?.value.trim();
    if (!motion) { showNotification('Motion cannot be empty', 'error'); return; }
    round.motion = motion;
    round.infoslide = infoslide || null;
    saveNow();
    closeAllModals();
    displayRounds();
    // Also refresh motions tab if visible
    if (typeof window.renderMotions === 'function') window.renderMotions();
    showNotification(`✅ Round ${round.id} motion updated`, 'success');
};

window.showEditMotionModal = showEditMotionModal;

// ============================================================================
// ADMIN FAST DRAW — displayAdminRounds()
// ============================================================================
function displayAdminRounds() {
    const list = document.getElementById('rounds-list');
    if (!list) return;

    const filter = document.getElementById('round-filter')?.value || 'all';
    const rounds = state.rounds || [];

    let filtered = rounds.slice().reverse();
    if (filter === 'pending')   filtered = filtered.filter(r => r.debates.some(d => !d.entered));
    if (filter === 'completed') filtered = filtered.filter(r => r.debates.every(d => d.entered));
    if (filter === 'blinded')   filtered = filtered.filter(r => r.blinded);

    if (filtered.length === 0) {
        list.innerHTML = rounds.length === 0
            ? `<div style="padding:32px;text-align:center;color:#94a3b8">No rounds yet — create one on the left.</div>`
            : `<div style="padding:32px;text-align:center;color:#94a3b8">No rounds match this filter.</div>`;
        return;
    }

    // Build team lookup once — O(teams), not repeated per debate
    const teamMap = Object.fromEntries((state.teams || []).map(t => [t.id, t]));

    const html = filtered.map(round => {
        const actualIdx = rounds.findIndex(r => r.id === round.id);
        const done  = round.debates.filter(d => d.entered).length;
        const total = round.debates.length;
        const pct   = total > 0 ? Math.round(done / total * 100) : 0;
        const allDone = done === total && total > 0;

        const rows = round.debates.map((debate, di) => {
            const room    = round.rooms?.[di] || `Room ${di + 1}`;
            const entered = debate.entered;
            const panelNames = (debate.panel || []).map(p => {
                const j = (state.judges||[]).find(j => j.id == p.id);
                return j ? escapeHTML(j.name) : '';
            }).filter(Boolean).join(', ');

            // ── Speech format ──────────────────────────────────────────────
            if (debate.format === 'speech') {
                const speakers = (debate.roomSpeakers || []);
                const speakerSummary = speakers.slice(0, 3).map(s => escapeHTML(s.speakerName)).join(', ') +
                    (speakers.length > 3 ? ` +${speakers.length - 3} more` : '');
                const topResult = debate.entered && debate.speechResults
                    ? debate.speechResults.reduce((best, r) => (!best || r.score > best.score) ? r : best, null)
                    : null;

                return `<div style="display:grid;grid-template-columns:90px 1fr auto auto;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;${entered?'background:#f0fdf4':''}">
                    <div style="display:flex;align-items:center;gap:5px">
                        <span style="width:7px;height:7px;border-radius:50%;background:${entered?'#10b981':'#f59e0b'};flex-shrink:0;display:inline-block"></span>
                        <span style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap">${escapeHTML(room)}</span>
                    </div>
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                            <span style="background:#f0fdf4;color:#16a34a;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">🎤 SPEECH</span>
                            <span style="color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;font-size:12px">${speakerSummary || '<em style="color:#94a3b8">No speakers</em>'}</span>
                            ${topResult && !round.blinded ? `<span style="font-size:11px;font-weight:700;color:#10b981;white-space:nowrap">Top: ${escapeHTML(topResult.speakerName)} (${topResult.score.toFixed(1)})</span>` : ''}
                        </div>
                    </div>
                    <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">
                        ${panelNames ? `🎯 ${panelNames}` : '<span style="color:#ef4444;font-style:italic">No judge</span>'}
                    </div>
                    <div>
                        ${entered
                            ? `<button onclick="window.editResults(${actualIdx},${di})" class="btn-secondary" style="padding:3px 8px;font-size:11px">✏️ Edit</button>`
                            : `<button onclick="window.showEnterResults(${actualIdx},${di})" class="btn-primary" style="padding:3px 8px;font-size:11px">📝 Scores</button>`}
                    </div>
                </div>`;
            }

            // ── BP format ──────────────────────────────────────────────────
            if (debate.format === 'bp') {
                const positions = ['og','oo','cg','co'];
                const teamNames = positions.map(pos => {
                    const t = teamMap[debate[pos]];
                    return t ? escapeHTML(t.name) : '—';
                }).join(' · ');
                const winner = debate.entered && debate.bpRanks
                    ? teamMap[debate[Object.keys(debate.bpRanks).find(p => debate.bpRanks[p]===1)]]
                    : null;
                return `<div style="display:grid;grid-template-columns:90px 1fr auto auto;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;${entered?'background:#f0fdf4':''}">
                    <div style="display:flex;align-items:center;gap:5px">
                        <span style="width:7px;height:7px;border-radius:50%;background:${entered?'#10b981':'#f59e0b'};flex-shrink:0;display:inline-block"></span>
                        <span style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap">${escapeHTML(room)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;min-width:0">
                        <span style="background:#dbeafe;color:#1e40af;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">BP</span>
                        <span style="color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;font-size:12px">${teamNames}</span>
                        ${winner && !round.blinded ? `<span style="font-size:11px;font-weight:700;color:#10b981">🥇 ${escapeHTML(winner.name)}</span>` : ''}
                    </div>
                    <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">
                        ${panelNames ? `${panelNames}` : '<span style="color:#ef4444;font-style:italic">No judges</span>'}
                    </div>
                    <div>
                        ${entered
                            ? `<button onclick="window.editResults(${actualIdx},${di})" class="btn-secondary" style="padding:3px 8px;font-size:11px">Override Ballot</button>`
                            : `<button onclick="window.showEnterResults(${actualIdx},${di})" class="btn-primary" style="padding:3px 8px;font-size:11px">Enter Results</button>`}
                    </div>
                </div>`;
            }

            // ── Standard (WSDC) format ─────────────────────────────────────
            const gov = teamMap[debate.gov];
            const opp = teamMap[debate.opp];
            if (!gov || !opp) return '';
            const govScore = entered ? (debate.govResults?.total?.toFixed(1) ?? '?') : null;
            const oppScore = entered ? (debate.oppResults?.total?.toFixed(1) ?? '?') : null;
            const govWon  = entered && (debate.govResults?.total ?? 0) > (debate.oppResults?.total ?? 0);

            return `<div style="display:grid;grid-template-columns:90px 1fr auto auto;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;${entered?'background:#f0fdf4':''}">
                <div style="display:flex;align-items:center;gap:5px">
                    <span style="width:7px;height:7px;border-radius:50%;background:${entered?'#10b981':'#f59e0b'};flex-shrink:0;display:inline-block"></span>
                    <span style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap">${escapeHTML(room)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <span style="font-weight:${govWon?700:500};color:${govWon?'#10b981':'#1e293b'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${escapeHTML(gov.name)}</span>
                    ${entered && !round.blinded
                        ? `<span style="font-size:12px;font-weight:700;white-space:nowrap">${govScore} — ${oppScore}</span>`
                        : (()=>{ try{ const pm=getPreviousMeetings(); const k=[debate.gov,debate.opp].sort().join('-'); const m=pm[k]||0; return m>0?'<span style="background:#f97316;color:white;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700">🔄×'+m+'</span>':'<span style="font-size:11px;color:#94a3b8">vs</span>'; }catch(e){return '<span style="font-size:11px;color:#94a3b8">vs</span>';} })()}
                    <span style="font-weight:${!govWon&&entered?700:500};color:${!govWon&&entered?'#10b981':'#1e293b'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${escapeHTML(opp.name)}</span>
                </div>
                <div style="font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">
                    ${panelNames ? `${panelNames}` : '<span style="color:#ef4444;font-style:italic">No judges</span>'}
                </div>
                <div>
                    ${entered
                        ? `<button onclick="window.editResults(${actualIdx},${di})" class="btn-secondary" style="padding:3px 8px;font-size:11px">Override Ballot</button>`
                        : `<button onclick="window.showEnterResults(${actualIdx},${di})" class="btn-primary" style="padding:3px 8px;font-size:11px">Enter Results</button>`}
                </div>
            </div>`;
        }).join('');

        return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;gap:10px;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <strong>Round ${round.id}</strong>
                    ${round.type==='knockout'?'<span style="background:#fee2e2;color:#991b1b;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:700">KO</span>':''}
                    ${round.blinded?'<span style="background:#f1f5f9;color:#475569;padding:1px 8px;border-radius:20px;font-size:11px;font-weight:700">Blind</span>':''}
                    ${round.motion?`<span style="font-size:12px;color:#64748b;font-style:italic">${escapeHTML(round.motion.substring(0,60))}${round.motion.length>60?'…':''}</span>`:''}
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:12px;font-weight:700;color:${allDone?'#10b981':'#f59e0b'}">${done}/${total}</span>
                    <button onclick="window.switchTab('draw')" class="btn-secondary" style="padding:3px 8px;font-size:11px">Full Edit →</button>
                </div>
            </div>
            <div style="height:3px;background:#e2e8f0"><div style="height:100%;width:${pct}%;background:#10b981;transition:width .4s"></div></div>
            ${rows}
        </div>`;
    }).join('');

    list.innerHTML = html;
}
window.displayAdminRounds = displayAdminRounds;

// ============================================================================
// RENAME SPEAKER ACROSS ALL BALLOT RECORDS
// ============================================================================
function renameSpeakerInBallots(teamId, oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    
    const tid = String(teamId); // normalise to string for safe comparison
    let changed = 0;

    // Track which rounds were modified
    const modifiedRoundIds = new Set();

    (state.rounds || []).forEach(round => {
        let roundModified = false;
        
        (round.debates || []).forEach(debate => {
            if (!debate.entered) return;
            let debateModified = false;

            // ── WSDC format ───────────────────────────────────────────────
            // Check government results
            if (debate.govResults && String(debate.gov) === tid) {
                // Update substantive speakers
                (debate.govResults.substantive || []).forEach(s => {
                    if (s.speaker === oldName) { 
                        s.speaker = newName; 
                        changed++; 
                        debateModified = true;
                    }
                });
                
                // Update reply speaker
                if (debate.govResults.reply && debate.govResults.reply.speaker === oldName) {
                    debate.govResults.reply.speaker = newName; 
                    changed++;
                    debateModified = true;
                }
            }

            // Check opposition results
            if (debate.oppResults && String(debate.opp) === tid) {
                // Update substantive speakers
                (debate.oppResults.substantive || []).forEach(s => {
                    if (s.speaker === oldName) { 
                        s.speaker = newName; 
                        changed++; 
                        debateModified = true;
                    }
                });
                
                // Update reply speaker
                if (debate.oppResults.reply && debate.oppResults.reply.speaker === oldName) {
                    debate.oppResults.reply.speaker = newName; 
                    changed++;
                    debateModified = true;
                }
            }

            // ── BP format ─────────────────────────────────────────────────
            if (debate.bpSpeakers) {
                ['og','oo','cg','co'].forEach(pos => {
                    if (String(debate[pos]) === tid) {
                        (debate.bpSpeakers[pos] || []).forEach(s => {
                            if (s.speaker === oldName) { 
                                s.speaker = newName; 
                                changed++;
                                debateModified = true;
                            }
                        });
                    }
                });
            }
            
            if (debateModified) roundModified = true;
        });
        
        if (roundModified) modifiedRoundIds.add(round.id);
    });

    if (changed > 0) {
        console.log(`✅ Renamed speaker "${oldName}" → "${newName}" in ${changed} ballot entries`);
        
        // Force UI refresh - call ALL render functions to ensure everything updates
        setTimeout(() => {
            // Refresh speaker standings
            if (typeof window.renderSpeakerStandings === 'function') {
                window.renderSpeakerStandings();
            }
            
            // Refresh draw view
            if (typeof window.displayRounds === 'function') {
                window.displayRounds();
            }
            if (typeof window.renderDraw === 'function') {
                window.renderDraw();
            }
            
            // Refresh admin view if visible
            if (typeof window.displayAdminRounds === 'function') {
                window.displayAdminRounds();
            }
            
            // Refresh any other views that might show speaker names
            if (typeof window.renderResults === 'function') {
                window.renderResults();
            }
            if (typeof window.renderParticipants === 'function') {
                window.renderParticipants();
            }
        }, 10); // Small delay to ensure all updates are processed
    }
    
    return changed;
}
window.renameSpeakerInBallots = renameSpeakerInBallots;
// Debounced render — prevents double-firing when both 'rounds' and 'teams' change together
let _drawRenderTimer = null;
function _debouncedRenderDraw() {
    clearTimeout(_drawRenderTimer);
    _drawRenderTimer = setTimeout(() => {
        // Only re-render if the draw tab is currently visible to avoid wasted work
        if (document.getElementById('draw')?.offsetParent !== null) renderDraw();
    }, 30);
}
watch('rounds', renderStandings);
watch('teams',  renderStandings);
watch('rounds', _debouncedRenderDraw);
watch('teams',  _debouncedRenderDraw);

// ============================================================================
// BACKFILL — patch rounds created before rooms array was initialized
// Runs once on module load; silently adds default room names to any round
// that is missing them, then saves so the fix persists across reloads.
// ============================================================================
function _backfillRoomNames() {
    const rounds = state.rounds || [];
    let dirty = false;
    rounds.forEach(round => {
        const debates = round.debates || [];
        if (!Array.isArray(round.rooms) || round.rooms.length !== debates.length) {
            round.rooms = debates.map((_, i) => `Room ${i + 1}`);
            dirty = true;
        }
    });
    if (dirty) saveNow();
}
document.addEventListener('DOMContentLoaded', _backfillRoomNames);

// ============================================================================
// EXPORTS - functions exported at function-level above
// ============================================================================

// Register all interactive functions on window so inline onclick handlers work
// ── Rename a room inline ──────────────────────────────────────────────────────
function renameRoom(roundIdx, debateIdx) {
    const round = (state.rounds || [])[roundIdx];
    if (!round) return;
    const current = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;
    const next = prompt('Rename room:', current);
    if (!next?.trim() || next.trim() === current) return;
    if (!Array.isArray(round.rooms)) {
        round.rooms = (round.debates || []).map((_, i) =>
            `Room ${i + 1}`
        );
    }
    round.rooms[debateIdx] = next.trim();
    saveNow();
    showNotification(`Room renamed to "${next.trim()}"`, 'success');
    displayRounds();
}

// ── Delete a single debate/room from a round ──────────────────────────────────
function deleteDebate(roundIdx, debateIdx) {
    const round = (state.rounds || [])[roundIdx];
    if (!round) return;
    const roomLabel = round.rooms?.[debateIdx] || `Room ${debateIdx + 1}`;
    const d = round.debates?.[debateIdx];
    if (d?.entered) {
        if (!confirm(`"${roomLabel}" already has results entered. Delete it anyway? This cannot be undone.`)) return;
    } else {
        if (!confirm(`Delete "${roomLabel}"? The two teams will be unassigned.`)) return;
    }
    round.debates.splice(debateIdx, 1);
    if (Array.isArray(round.rooms)) round.rooms.splice(debateIdx, 1);
    saveNow();
    showNotification(`${roomLabel} removed`, 'info');
    displayRounds();
}
function addDebate(roundIdx, debateIdx) {
    const round = (state.rounds || [])[roundIdx];
    if (!round) return;

    // New room always goes after the clicked room; ballots already submitted are no barrier
    const newIdx = debateIdx + 1;
    const newRoomNumber = round.debates.length + 1;
    const newRoomLabel = `Room ${newRoomNumber}`;

    if (!confirm(`Add "${newRoomLabel}" after Room ${debateIdx + 1}? Teams will be unassigned.`)) return;

    // Build a blank debate matching the round's format
    let newDebate;
    if (round.format === 'bp') {
        newDebate = { format: 'bp', og: null, oo: null, cg: null, co: null, entered: false, panel: [] };
    } else if (round.format === 'speech') {
        newDebate = { format: 'speech', roomSpeakers: [], entered: false, panel: [], speechResults: null };
    } else {
        newDebate = { gov: null, opp: null, entered: false, panel: [], attendance: { gov: true, opp: true }, sidesPending: round.sideMethod === 'manual' };
    }

    // Insert debate and a matching persistent room label
    round.debates.splice(newIdx, 0, newDebate);
    if (!Array.isArray(round.rooms)) {
        round.rooms = round.debates.map((_, i) => `Room ${i + 1}`);
    } else {
        round.rooms.splice(newIdx, 0, newRoomLabel);
    }

    saveNow();
    showNotification(`${newRoomLabel} added`, 'info');
    displayRounds();
}

function _toggleDrawView() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const current = prefs['miniView'] || false;
    prefs['miniView'] = !current;
    localStorage.setItem('orion_draw_prefs', JSON.stringify(prefs));
    
    const btn = document.getElementById('draw-view-toggle');
    if (btn) {
        btn.textContent = current ? '📋 Mini' : '📑 Full';
    }
    displayRounds();
}

window.displayRounds        = displayRounds;
window._setNameDisplay      = _setNameDisplay;
window._toggleDrawView      = _toggleDrawView;
window.renderRoundMiniTable = renderRoundMiniTable;

window._toggleRoundSettings = function(roundId) {
    const menu = document.getElementById(`round-settings-${roundId}`);
    if (!menu) return;
    const wasOpen = menu.style.display !== 'none';
    document.querySelectorAll('.round-settings-menu').forEach(m => { m.style.display = 'none'; });
    menu.style.display = wasOpen ? 'none' : 'block';
};
window._closeRoundSettings = function() {
    document.querySelectorAll('.round-settings-menu').forEach(m => { m.style.display = 'none'; });
};
if (!window._roundSettingsListenerBound) {
    document.addEventListener('click', () => {
        document.querySelectorAll('.round-settings-menu').forEach(m => { m.style.display = 'none'; });
    });
    window._roundSettingsListenerBound = true;
}
window.showEnterResults     = showEnterResults;
window.submitResults        = submitResults;
window.editResults          = editResults;
window.viewDebateDetails    = viewDebateDetails;
window.redrawRound          = redrawRound;
window.swapTeams            = swapTeams;
window.toggleBlindRound     = toggleBlindRound;
window.toggleAttendance     = toggleAttendance;
window.copyRoomURL          = copyRoomURL;
window.renameRoom           = renameRoom;
window.deleteDebate         = deleteDebate;
window.addDebate            = addDebate ;
window.showMoveTeamModal    = showMoveTeamModal;
window.showAssignTeamsModal = showAssignTeamsModal;
window.executeAssignTeams   = executeAssignTeams;
window.executeMoveTeam      = executeMoveTeam;
window.addJudgeToPanel      = addJudgeToPanel;
window.removeJudgeFromPanel = removeJudgeFromPanel;
window.moveJudgeToPanel     = moveJudgeToPanel;
window.toggleJudgeRole      = toggleJudgeRole;
window.dndJudgeDragStart    = dndJudgeDragStart;
window.dndJudgeDragOver     = dndJudgeDragOver;
window.dndJudgeDrop         = dndJudgeDrop;
window.dndTeamDragStart     = dndTeamDragStart;
window.dndTeamDragOver      = dndTeamDragOver;
window.dndTeamDrop          = dndTeamDrop;
window.dndDragEnd           = dndDragEnd;
window.dndDragLeave         = dndDragLeave;
window.showJudgeManagement  = showJudgeManagement;

function _avoidPreviousMeetingPairs(pairs) {
    if (pairs.length < 2) return pairs;
    const prev = getPreviousMeetings();
    const hasMet = (a, b) => (prev[a.id]?.[b.id] || 0) + (prev[b.id]?.[a.id] || 0) > 0;
    let improved = true;
    const limit = pairs.length * pairs.length;
    let iter = 0;
    while (improved && iter++ < limit) {
        improved = false;
        for (let i = 0; i < pairs.length && !improved; i++) {
            for (let j = i + 1; j < pairs.length && !improved; j++) {
                const [a, b] = pairs[i];
                const [c, d] = pairs[j];
                const before = (hasMet(a,b)?1:0) + (hasMet(c,d)?1:0);
                const s1 = (hasMet(a,c)?1:0) + (hasMet(b,d)?1:0);
                const s2 = (hasMet(a,d)?1:0) + (hasMet(b,c)?1:0);
                if (s1 < before) { pairs[i]=[a,c]; pairs[j]=[b,d]; improved=true; }
                else if (s2 < before) { pairs[i]=[a,d]; pairs[j]=[b,c]; improved=true; }
            }
        }
    }
    return pairs;
}

export function createRound(params) {
    const motion         = params?.motion         ?? document.getElementById('cr-motion')?.value.trim()        ?? 'Debate Round';
    const method         = params?.method         ?? document.getElementById('cr-pair')?.value                  ?? 'random';
    const sideMethod     = params?.sideMethod     ?? document.getElementById('cr-sides')?.value                ?? 'random';
    const sidePref       = params?.sidePref       ?? document.getElementById('cr-side-pref')?.value             ?? 'random';
    const autoAllocate   = params?.autoAllocate   ?? document.getElementById('cr-autojudge')?.checked          ?? true;
    const blind          = params?.blind          ?? document.getElementById('cr-blind')?.checked               ?? false;
    const disableReply   = params?.disableReply   ?? document.getElementById('cr-disable-reply')?.checked       ?? false;
    const avoidMeetings  = params?.avoidMeetings  ?? document.getElementById('cr-avoid-meetings')?.checked     ?? true;
    const roomSize       = params?.roomSize       ?? parseInt(document.getElementById('cr-room-size')?.value || '4', 10);
    const isKnockout   = method === 'knockout';
    const isRoundRobin = method === 'roundrobin';
    const bpMode       = isBP();

    const activeTeams = (state.teams||[]).filter(t => !t.eliminated);
    const minTeams = bpMode ? 4 : 2;
    if (activeTeams.length < minTeams) {
        showNotification(`Need at least ${minTeams} active teams${bpMode ? ' for BP' : ''}`, 'error');
        return;
    }

    let debates = [];

    // ── BP: group teams into rooms of 4 (OG / OO / CG / CO) ─────────────────
    if (bpMode && !isKnockout) {
        let tc = [...activeTeams];
        if (method === 'power' || method === 'fold') {
            tc.sort((a,b) => (b.wins||0)-(a.wins||0) || (b.total||0)-(a.total||0));
        } else if (method === 'roundrobin') {
            // try to avoid repeat matchups across all 4 positions
            tc.sort((a,b) => (b.wins||0)-(a.wins||0) || (b.total||0)-(a.total||0));
        } else {
            tc.sort(() => Math.random() - 0.5);
        }
        const rem = tc.length % 4;
        if (rem !== 0) {
            showNotification(`${rem} team${rem>1?'s':''} given a bye (BP needs multiples of 4)`, 'warning');
            tc = tc.slice(0, tc.length - rem);
        }
        for (let i = 0; i < tc.length; i += 4) {
            let [og, oo, cg, co] = tc.slice(i, i+4);
            // For power/fold: interleave — 1st/3rd as Gov bench, 2nd/4th as Opp bench
            if (method === 'fold') {
                // fold: 1st vs mid-high in same room
                const positions = [tc[i], tc[tc.length-1-i/4*2], tc[i+1], tc[tc.length-1-(i/4*2+1)]];
                [og, oo, cg, co] = positions;
            }
            debates.push({ format:'bp', og:og.id, oo:oo.id, cg:cg.id, co:co.id, entered:false, panel:[] });
        }
        if (autoAllocate) allocateJudgesToDebates(debates, false);
        const roundId = state.rounds.length > 0 ? Math.max(...state.rounds.map(r=>r.id))+1 : 1;
        const rooms = debates.map((_, i) => `Room ${i + 1}`);
        state.rounds.push({ id:roundId, motion, debates, rooms, format:'bp', type:'prelim', blinded:blind, sideMethod:'bp', nextRoundCreated:false });
        saveNow();
        const label = method.charAt(0).toUpperCase() + method.slice(1);
        showNotification(`Round ${roundId} BP (${label}) — ${debates.length} rooms created${blind?' [BLINDED]':''}`, 'success');
        renderDraw();
        return;
    }

    // ── BP: knockout round (4-team rooms) ────────────────────────────────────
    if (bpMode && isKnockout) {
        let tc = [...activeTeams].sort((a,b) => (b.wins||0)-(a.wins||0)||(b.total||0)-(a.total||0));
        const rem = tc.length % 4;
        if (rem !== 0) {
            showNotification(`${rem} team${rem>1?'s':''} given a bye (BP knockout needs multiples of 4)`, 'warning');
            tc = tc.slice(0, tc.length - rem);
        }
        for (let i = 0; i < tc.length; i += 4) {
            const [og, oo, cg, co] = tc.slice(i, i+4);
            debates.push({ format:'bp', og:og.id, oo:oo.id, cg:cg.id, co:co.id, entered:false, panel:[] });
        }
        if (autoAllocate) allocateJudgesToDebates(debates, true);
        const roundId = state.rounds.length > 0 ? Math.max(...state.rounds.map(r=>r.id))+1 : 1;
        const rooms = debates.map((_, i) => `Room ${i + 1}`);
        state.rounds.push({ id:roundId, motion, debates, rooms, format:'bp', type:'knockout', blinded:blind, sideMethod:'bp', nextRoundCreated:false });
        saveNow();
        showNotification(`Round ${roundId} BP Knockout — ${debates.length} rooms created${blind?' [BLINDED]':''}`, 'success');
        renderDraw();
        return;
    }

    // ── SPEECH mode: pair individual speakers into rooms ────────────────────
    if (isSpeech()) {
        const allSpks = [];
        (state.teams || []).forEach(team => {
            (team.speakers || []).forEach(spk => {
                if (spk.name) allSpks.push({
                    speakerId:   spk.id || null,
                    speakerName: spk.name,
                    teamId:      team.id,
                    teamName:    team.name,
                    total:       spk.substantiveTotal || 0
                });
            });
        });

        if (allSpks.length < roomSize) {
            showNotification('Need at least ' + roomSize + ' registered speakers for a speech round', 'error');
            return;
        }

        let ordered = [...allSpks];
        if (method === 'power') {
            ordered.sort((a, b) => b.total - a.total);
        } else if (method === 'fold') {
            ordered.sort((a, b) => b.total - a.total);
            const n = ordered.length;
            const result = [];
            for (let i = 0; i < Math.ceil(n / 2); i++) {
                result.push(ordered[i]);
                if (n - 1 - i !== i) result.push(ordered[n - 1 - i]);
            }
            ordered = result;
        } else {
            ordered.sort(() => Math.random() - 0.5);
        }

        const rem = ordered.length % roomSize;
        if (rem !== 0) {
            showNotification(rem + ' speaker' + (rem > 1 ? 's' : '') + ' given a bye (need multiples of ' + roomSize + ')', 'warning');
            ordered = ordered.slice(0, ordered.length - rem);
        }

        const speechDebates = [];
        for (let i = 0; i < ordered.length; i += roomSize) {
            speechDebates.push({
                format:       'speech',
                roomSpeakers: ordered.slice(i, i + roomSize),
                entered:      false,
                panel:        [],
                speechResults: null
            });
        }

        if (autoAllocate) allocateJudgesToDebates(speechDebates, false);

        const roundId = state.rounds.length > 0
            ? Math.max(...state.rounds.map(r => r.id)) + 1 : 1;
        const rooms = speechDebates.map((_, i) => `Room ${i + 1}`);

        state.rounds.push({
            id:               roundId,
            motion,
            debates:          speechDebates,
            rooms,
            format:           'speech',
            type:             'prelim',
            blinded:          blind,
            nextRoundCreated: false,
            roomSize
        });
        saveNow();

        const label = method === 'power' ? 'Power' : method === 'fold' ? 'Balanced' : 'Random';
        showNotification(
            'Round ' + roundId + ' Speech (' + label + ') — ' + speechDebates.length +
            ' room' + (speechDebates.length !== 1 ? 's' : '') + ', ' + ordered.length +
            ' speakers' + (blind ? ' [BLINDED]' : ''),
            'success'
        );
        renderDraw();
        return;
    }

    let pairs = [];

    if (isKnockout) {
        let tc = [...activeTeams].sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.total||0)-(a.total||0));
        if (tc.length % 2 !== 0) tc.pop();
        const half   = Math.floor(tc.length/2);
        const top    = tc.slice(0, half);
        const bottom = tc.slice(half).reverse();
        for (let i=0;i<top.length;i++) pairs.push([top[i], bottom[i]]);
    } else if (isRoundRobin) {
        pairs = generateRoundRobinPairs(activeTeams, state.rounds);
        if (pairs.length === 0) {
            showNotification('Could not generate fresh round robin pairs, using power pairing', 'warning');
            let tc = [...activeTeams].sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.total||0)-(a.total||0));
            if (tc.length % 2 !== 0) tc.pop();
            for (let i=0;i<tc.length;i+=2) pairs.push([tc[i],tc[i+1]]);
        }
    } else if (method === 'fold') {
        let tc = [...activeTeams].sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.total||0)-(a.total||0));
        if (tc.length%2!==0){ showNotification(`Odd teams — bye given`,'warning'); tc.pop(); }
        const mid=Math.floor(tc.length/2);
        for (let i=0;i<mid;i++) pairs.push([tc[i], tc[tc.length-1-i]]);
    } else if (method === 'power') {
        let tc = [...activeTeams].sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.total||0)-(a.total||0));
        if (tc.length%2!==0){ showNotification(`Odd teams — bye given`,'warning'); tc.pop(); }
        for (let i=0;i<tc.length;i+=2) pairs.push([tc[i],tc[i+1]]);
    } else {
        let tc = [...activeTeams].sort(()=>Math.random()-.5);
        if (tc.length%2!==0){ showNotification(`Odd teams — bye given`,'warning'); tc.pop(); }
        for (let i=0;i<tc.length;i+=2) pairs.push([tc[i],tc[i+1]]);
    }

    if (avoidMeetings && !isKnockout && !isRoundRobin) {
        pairs = _avoidPreviousMeetingPairs(pairs);
    }

    debates = pairs.map(([tA,tB],idx) => {
        const {gov,opp} = assignSides(tA,tB,sideMethod,idx,sidePref);
        return { gov, opp, entered:false, panel:[], attendance:{gov:true,opp:true}, sidesPending:sideMethod==='manual' };
    });

    if (autoAllocate) allocateJudgesToDebates(debates, isKnockout);

    const roundId = state.rounds.length > 0 ? Math.max(...state.rounds.map(r=>r.id))+1 : 1;
    const rooms = debates.map((_, i) => `Room ${i + 1}`);
    state.rounds.push({ id:roundId, motion, debates, rooms, type:isKnockout?'knockout':'prelim', blinded:blind, disableReply, sideMethod, nextRoundCreated:false });
    saveNow();

    const label = isKnockout ? 'Knockout' : isRoundRobin ? 'Round Robin' : (method||'random').charAt(0).toUpperCase()+(method||'random').slice(1);
    showNotification(`Round ${roundId} (${label}) created with ${debates.length} debates${blind?' [BLINDED]':''}`, 'success');

    renderDraw();   // refresh the draw tab
}


export function displayRounds() {
    const list = document.getElementById('rounds-list');
    if (!list) return;


    try {

    const filter   = document.getElementById('round-filter')?.value || 'all';
    window._saveDrawPref?.('round-filter', filter);
    const isJudge  = state.auth?.currentUser?.role === 'judge';
    const myJudgeId = isJudge ? String(state.auth?.currentUser?.associatedId ?? '') : null;

    // Shallow copy rounds and ensure each has a debates array
    let filteredRounds = (state.rounds || []).map(r => {
        const copy = { ...r };
        if (!Array.isArray(copy.debates)) copy.debates = [];
        return copy;
    });

    if (filter === 'pending') {
        filteredRounds = filteredRounds.filter(r => (r.debates || []).some(d => !d.entered));
    } else if (filter === 'completed') {
        filteredRounds = filteredRounds.filter(r => (r.debates || []).every(d => d.entered));
    } else if (filter === 'blinded') {
        filteredRounds = filteredRounds.filter(r => r.blinded);
    }

    // ── Judge portal: show only the debates this judge is allocated to ────────
    if (isJudge && myJudgeId) {
        filteredRounds = filteredRounds
            .map(r => ({
                ...r,
                debates: (r.debates || []).filter(d =>
                    (d.panel || []).some(p => String(p.id) === myJudgeId)
                )
            }))
            .filter(r => r.debates.length > 0);

        if (filteredRounds.length === 0) {
            list.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b">
                <div style="font-size:48px;margin-bottom:12px">📋</div>
                <h3 style="margin:0 0 8px;color:#1e293b">No Assignments Yet</h3>
                <p style="margin:0">You have not been allocated to any rounds yet. Check back after the draw is published.</p>
            </div>`;
            return;
        }
    }

    if (filteredRounds.length === 0) {
        list.innerHTML = '<p style="color: #64748b; text-align: center; padding: 40px;">No rounds match the current filter</p>';
        return;
    }

    const previousMeetings = getPreviousMeetings();
    
    // Check mini view preference
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const isMiniView = prefs['miniView'] || false;

    // Update button text
    const viewBtn = document.getElementById('draw-view-toggle');
    if (viewBtn) viewBtn.textContent = isMiniView ? '📑 Full' : '📋 Mini';

    // Group rounds by bracket for knockout rounds
    const knockoutRounds = filteredRounds.filter(r => r.type === 'knockout');
    const prelimRounds   = filteredRounds.filter(r => r.type !== 'knockout').slice().reverse();

    let html = '';

    // ── Judge banner ──────────────────────────────────────────────────────────
    if (isJudge && myJudgeId) {
        const myJudge = (state.judges || []).find(j => String(j.id) === myJudgeId);
        html += `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
            <span style="font-size:28px">⚖️</span>
            <div>
                <div style="font-weight:700;color:#1e40af;font-size:15px">Welcome, ${escapeHTML(myJudge?.name || 'Judge')}</div>
                <div style="font-size:13px;color:#3b82f6">Showing only your assigned rooms. Submit ballots using the button in each room.</div>
            </div>
        </div>`;
    }

    // Display prelim rounds — newest first
    prelimRounds.forEach(round => {
        if (isMiniView) {
            html += renderRoundMiniTable(round);
        } else {
            html += renderRoundCard(round, state.rounds.findIndex(r => r.id === round.id), previousMeetings);
        }
    });

    // Display knockout rounds in bracket format
    if (knockoutRounds.length > 0) {
        html += renderKnockoutBracket(knockoutRounds);
    }

    // Render jump pills (all prelim rounds, newest first mirrors display order)
    const pillsEl = document.getElementById('draw-jump-pills');
    if (pillsEl) {
        const allPrelim = (state.rounds || []).filter(r => r.type !== 'knockout');
        if (allPrelim.length > 1) {
            pillsEl.innerHTML = allPrelim.slice().reverse().map(r => {
                const done = (r.debates || []).every(d => d.entered) && (r.debates||[]).length > 0;
                const clr  = done ? 'background:#d1fae5;border-color:#6ee7b7;color:#065f46'
                                  : 'background:#fff;border-color:#e2e8f0;color:#334155';
                return `<button class="draw-jump-pill" style="${clr}"
                            onclick="document.getElementById('round-card-${r.id}')?.scrollIntoView({behavior:'smooth',block:'start'})">
                            R${r.id}${done?' ✓':''}
                        </button>`;
            }).join('');
        } else {
            pillsEl.innerHTML = '';
        }
    }

    list.innerHTML = html;
    } catch (error) {
        console.error('[draw] displayRounds error:', error);
        list.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b">
                <div style="font-size:48px;margin-bottom:12px">❌</div>
                <h3 style="margin:0 0 8px;color:#1e293b">Display Error</h3>
                <p style="margin:0">Failed to load draw. Check console for details.</p>
                <button onclick="window.displayRounds()" style="margin-top:12px;padding:8px 16px;border:1px solid #e2e8f0;border-radius:6px;background:white;">Retry</button>
            </div>`;
    }
}


export function renderRoundCard(round, actualRoundIdx, previousMeetings) {
    const debates = round.debates || [];
    const entered = debates.filter(d => d.entered).length;
    const total   = debates.length;
    const isBlinded = round.blinded || false;
    const isNoReply = round.disableReply || false;
    const isAdmin = state.auth?.currentUser?.role === 'admin';
    let _dp = {}; try { _dp = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const _displayMode = _dp['display'] || 'names';
    const allDone = entered === total && total > 0;
    const badgeStyle = allDone
        ? 'background:#d1fae5;color:#065f46'
        : 'background:#fef3c7;color:#92400e';

    const collapseKey = `orion_round_open_${round.id}`;
    const isOpen = localStorage.getItem(collapseKey) !== 'false';

    return `
    <div id="round-card-${round.id}" class="round-card-wrap">
        <div class="round-card-hdr" onclick="window._toggleRoundCard(${round.id})">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0">
                <span id="round-chevron-${round.id}" class="round-chevron${isOpen?' open':''}">▶</span>
                <strong style="font-size:16px;color:#1e293b">Round ${round.id}</strong>
                ${round.type==='knockout'?'<span style="background:#fee2e2;color:#991b1b;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">🏆 KNOCKOUT</span>':''}
                ${isBlinded?'<span style="background:#f1f5f9;color:#475569;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">🔒 BLIND</span>':''}
                ${isNoReply?'<span style="background:#fff7ed;color:#c2410c;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">🚫 NO REPLY</span>':''}
                <span style="font-size:13px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px">${escapeHTML(round.motion||'')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap" onclick="event.stopPropagation()">
                <span style="${badgeStyle};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">${entered}/${total} results</span>
                ${isAdmin ? `<div class="round-settings-wrap" style="position:relative; display:inline-block;">
                    <button class="draw-settings-trigger adm-btn secondary sm" onclick="window._toggleRoundSettings(${round.id})"
                            title="Round settings">⚙️ Draw Settings</button>
                    <div id="round-settings-${round.id}" class="round-settings-menu" style="display:none">
                        <button class="draw-settings-item" onclick="window.allocateJudgesForRound(${actualRoundIdx});window._closeRoundSettings()">Re-allocate Judges</button>
                        <button class="draw-settings-item" onclick="window.redrawRound(${actualRoundIdx})" ${entered>0?'disabled title="Results already entered"':''}>🔀 Redraw</button>
                        <button class="draw-settings-item" onclick="window.addDebate(${actualRoundIdx},${total-1});window._closeRoundSettings()">Add Room</button>
                        <button class="draw-settings-item" onclick="window._showRepeatMeetingsReport(${round.id})">🔄 Repeat Meetings</button>
                        <button class="draw-settings-item" onclick="window.toggleTeamNamesDisplay();window._closeRoundSettings()">${_displayMode === 'codes' ? '👁 Show Names' : '🙈 Hide Names'}</button>
                        <button class="draw-settings-item danger" onclick="window._closeRoundSettings();window.adminDeleteRound(${round.id})">Delete Round</button>
                    </div>
                </div>` : ''}
            </div>
        </div>
        <div id="round-mini-${round.id}" class="round-mini-summary${isOpen?' hidden':''}">
            <table class="round-mini-table">
                <thead><tr>
                    <th>Room</th><th>Teams</th><th>Chair</th><th>Wings</th><th>T</th><th></th>
                </tr></thead>
                <tbody>
                ${debates.map((debate, i) => {
                    const room = round.rooms?.[i] || `Room ${i+1}`;
                    let teamsHtml = '';
                    if (debate.format === 'bp') {
                        const og = (state.teams||[]).find(t=>t.id==debate.og);
                        const oo = (state.teams||[]).find(t=>t.id==debate.oo);
                        const cg = (state.teams||[]).find(t=>t.id==debate.cg);
                        const co = (state.teams||[]).find(t=>t.id==debate.co);
                        teamsHtml = `${escapeHTML(og?.name||'?')}/${escapeHTML(oo?.name||'?')} vs ${escapeHTML(cg?.name||'?')}/${escapeHTML(co?.name||'?')}`;
                    } else if (debate.format === 'speech') {
                        teamsHtml = `${(debate.roomSpeakers||[]).length} speakers`;
                    } else {
                        const gov = (state.teams||[]).find(t=>t.id==debate.gov);
                        const opp = (state.teams||[]).find(t=>t.id==debate.opp);
                        teamsHtml = `${escapeHTML(gov?.name||'TBD')} vs ${escapeHTML(opp?.name||'TBD')}`;
                    }
                    const panel = debate.panel || [];
                    const chairEntry     = panel.find(p => p.role === 'chair');
                    const wingEntries    = panel.filter(p => p.role !== 'chair' && p.role !== 'trainee');
                    const traineeEntries = panel.filter(p => p.role === 'trainee');
                    const chairJudge     = chairEntry ? (state.judges||[]).find(j=>j.id==chairEntry.id) : null;
                    const wingNames      = wingEntries.map(p=>(state.judges||[]).find(j=>j.id==p.id)?.name||'').filter(Boolean);
                    const traineeNames   = traineeEntries.map(p=>(state.judges||[]).find(j=>j.id==p.id)?.name||'').filter(Boolean);
                    const status = debate.entered ? '✅' : panel.length ? '⏳' : '⚠️';
                    const chairHtml = chairJudge
                        ? `${escapeHTML(chairJudge.name)}<span class="rmt-c">(c)</span>`
                        : `<span style="color:#94a3b8">—</span>`;
                    return `<tr>
                        <td class="rmt-room">${escapeHTML(room)}</td>
                        <td class="rmt-teams">${teamsHtml}</td>
                        <td class="rmt-chair">${chairHtml}</td>
                        <td class="rmt-wings">${wingNames.length ? escapeHTML(wingNames.join(', ')) : '<span style="color:#94a3b8">—</span>'}</td>
                        <td class="rmt-trainee">${traineeNames.length ? escapeHTML(traineeNames.join(', ')) : '<span style="color:#94a3b8">—</span>'}</td>
                        <td class="rmt-status">${status}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>
        <div id="round-body-${round.id}" class="round-card-body${isOpen?'':' collapsed'}">
            <div style="display:grid;gap:14px">
                ${debates.map((debate, i) => renderDebateCard(round, debate, actualRoundIdx, i, previousMeetings)).join('')}
            </div>
        </div>
    </div>`;
}

function renderRoundMiniTable(round) {
    const debates = round.debates || [];
    const rooms = round.rooms || [];
    
    const rows = debates.map((debate, i) => {
        const room = rooms[i] || `Room ${i+1}`;
        let teamsHtml = '';
        if (debate.format === 'bp') {
            const og = (state.teams||[]).find(t=>t.id==debate.og);
            const oo = (state.teams||[]).find(t=>t.id==debate.oo);
            const cg = (state.teams||[]).find(t=>t.id==debate.cg);
            const co = (state.teams||[]).find(t=>t.id==debate.co);
            teamsHtml = `${escapeHTML(og?.name||'?')}/${escapeHTML(oo?.name||'?')} vs ${escapeHTML(cg?.name||'?')}/${escapeHTML(co?.name||'?')}`;
        } else if (debate.format === 'speech') {
            teamsHtml = `${(debate.roomSpeakers||[]).length} speakers`;
        } else {
            const gov = (state.teams||[]).find(t=>t.id==debate.gov);
            const opp = (state.teams||[]).find(t=>t.id==debate.opp);
            teamsHtml = `${escapeHTML(gov?.name||'TBD')} vs ${escapeHTML(opp?.name||'TBD')}`;
        }
        const panel = debate.panel || [];
        const chairEntry     = panel.find(p => p.role === 'chair');
        const wingEntries    = panel.filter(p => p.role !== 'chair' && p.role !== 'trainee');
        const traineeEntries = panel.filter(p => p.role === 'trainee');
        const chairJudge     = chairEntry ? (state.judges||[]).find(j=>j.id==chairEntry.id) : null;
        const wingNames      = wingEntries.map(p=>(state.judges||[]).find(j=>j.id==p.id)?.name||'').filter(Boolean);
        const traineeNames   = traineeEntries.map(p=>(state.judges||[]).find(j=>j.id==p.id)?.name||'').filter(Boolean);
        const status = debate.entered ? '✅' : panel.length ? '⏳' : '⚠️';
        const chairHtml = chairJudge
            ? `${escapeHTML(chairJudge.name)}<span class="rmt-c">(c)</span>`
            : `<span style="color:#94a3b8">—</span>`;
        return `<tr>
            <td class="rmt-room">${escapeHTML(room)}</td>
            <td class="rmt-teams">${teamsHtml}</td>
            <td class="rmt-chair">${chairHtml}</td>
            <td class="rmt-wings">${wingNames.length ? escapeHTML(wingNames.join(', ')) : '<span style="color:#94a3b8">—</span>'}</td>
            <td class="rmt-trainee">${traineeNames.length ? escapeHTML(traineeNames.join(', ')) : '<span style="color:#94a3b8">—</span>'}</td>
            <td class="rmt-status">${status}</td>
        </tr>`;
    }).join('');

    return `
    <div style="margin-bottom:16px;">
        <div style="background:#f8fafc;padding:8px 12px;border-radius:6px 6px 0 0;border:1px solid #e2e8f0;border-bottom:none;">
            <strong style="font-size:14px;color:#1e293b;">Round ${round.id}</strong>
            ${round.type==='knockout'?'<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-left:8px;">🏆 KO</span>':''}
            ${round.blinded?'<span style="background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-left:8px;">🔒 Blind</span>':''}
            <span style="font-size:12px;color:#64748b;margin-left:12px;">${debates.filter(d=>d.entered).length}/${debates.length} results</span>
        </div>
        <table class="round-mini-table" style="border-radius:0 0 6px 6px;border-top:none;">
            <thead><tr>
                <th>Room</th><th>Teams</th><th>Chair</th><th>Wings</th><th>T</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

window._toggleRoundCard = function(roundId) {
    const body    = document.getElementById(`round-body-${roundId}`);
    const mini    = document.getElementById(`round-mini-${roundId}`);
    const chevron = document.getElementById(`round-chevron-${roundId}`);
    if (!body) return;
    body.classList.toggle('collapsed');
    const open = !body.classList.contains('collapsed');
    if (chevron) chevron.classList.toggle('open', open);
    if (mini) mini.classList.toggle('hidden', open);
    localStorage.setItem(`orion_round_open_${roundId}`, open ? 'true' : 'false');
};

// Toggle whether a given debate is marked as a repeat meeting
window.toggleRepeatMeetingForDebate = function(roundId, debateArg) {
  const rounds = state.rounds || [];
  const r = rounds.find(ro => ro.id === roundId);
  if (!r) return;
  let d = null;
  // debateArg may be an index (debate position on the round) or an actual debate id
  if (typeof debateArg === 'number') {
    d = (r.debates || [])[debateArg];
  } else {
    d = (r.debates || []).find(db => db.id === debateArg);
  }
  if (!d) return;
  d.repeatMeeting = !d.repeatMeeting;
  showNotification('Repeat meeting toggled', 'info');
  // Re-render the draw to reflect the change
  if (typeof displayRounds === 'function') displayRounds();
};

// Quick toggle for team name display (names vs codes) using existing prefs
window.toggleTeamNamesDisplay = function() {
    let savedPrefs = {};
    try { savedPrefs = JSON.parse(localStorage.getItem('orion_draw_prefs') || '{}'); } catch(e) {}
    const current = savedPrefs['display'] || 'names';
    savedPrefs['display'] = current === 'names' ? 'codes' : 'names';
    localStorage.setItem('orion_draw_prefs', JSON.stringify(savedPrefs));
    displayRounds();
};

// Scan a round for repeat meetings (only counts prior rounds, not the current one)
window._showRepeatMeetingsReport = function(roundId) {
    window._closeRoundSettings();
    const rounds = state.rounds || [];
    const round = rounds.find(r => r.id === roundId);
    if (!round) return;

    // Build cumulative meetings map excluding the current round
    const prev = {};
    rounds.forEach(r => {
        if (r.id === roundId) return;
        (r.debates || []).forEach(d => {
            const gov = d.gov, opp = d.opp;
            if (!gov || !opp) return;
            if (!prev[gov]) prev[gov] = {};
            if (!prev[opp]) prev[opp] = {};
            prev[gov][opp] = (prev[gov][opp] || 0) + 1;
            prev[opp][gov] = (prev[opp][gov] || 0) + 1;
        });
    });

    const rematches = [];
    (round.debates || []).forEach((d, i) => {
        const gov = d.gov, opp = d.opp;
        if (!gov || !opp) return;
        const count = prev[gov]?.[opp] || 0;
        if (count > 0) {
            const govTeam = (state.teams || []).find(t => t.id === gov);
            const oppTeam = (state.teams || []).find(t => t.id === opp);
            const room = round.rooms?.[i] || `Room ${i + 1}`;
            rematches.push({ room, gov: govTeam?.name || '?', opp: oppTeam?.name || '?', count });
        }
    });

    if (rematches.length === 0) {
        showNotification('No repeat meetings in this round ✅', 'success');
        return;
    }

    // Show a modal listing each rematch
    const rows = rematches.map(rm =>
        `<tr>
            <td style="padding:6px 12px;font-size:12px;color:#64748b;font-weight:700">${escapeHTML(rm.room)}</td>
            <td style="padding:6px 12px;font-size:13px;font-weight:600">${escapeHTML(rm.gov)}</td>
            <td style="padding:6px 4px;font-size:11px;color:#94a3b8;text-align:center">vs</td>
            <td style="padding:6px 12px;font-size:13px;font-weight:600">${escapeHTML(rm.opp)}</td>
            <td style="padding:6px 12px;text-align:center">
                <span style="background:#f97316;color:white;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700">×${rm.count}</span>
            </td>
        </tr>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div style="background:white;border-radius:16px;padding:24px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;font-size:17px">🔄 Repeat Meetings — Round ${round.id}</h3>
                <button onclick="this.closest('[style*=fixed]').remove()"
                    style="background:none;border:none;font-size:20px;cursor:pointer;color:#64748b;padding:0 4px">✕</button>
            </div>
            <table style="width:100%;border-collapse:collapse">
                <thead>
                    <tr style="border-bottom:2px solid #f1f5f9">
                        <th style="padding:6px 12px;font-size:11px;color:#94a3b8;text-align:left;font-weight:700">ROOM</th>
                        <th style="padding:6px 12px;font-size:11px;color:#94a3b8;text-align:left;font-weight:700">GOV</th>
                        <th></th>
                        <th style="padding:6px 12px;font-size:11px;color:#94a3b8;text-align:left;font-weight:700">OPP</th>
                        <th style="padding:6px 12px;font-size:11px;color:#94a3b8;text-align:center;font-weight:700">TIMES MET</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center">${rematches.length} rematch${rematches.length > 1 ? 'es' : ''} detected</p>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
};

window.createRound          = createRound;
window.renameSpeakerInBallots = renameSpeakerInBallots;

// BP-specific DnD dragover (og/oo/cg/co positions, no gov/opp assumption)
window.dndBPTeamDragOver = function(event, toRound, toDebate, toSide) {
    if (window._dnd?.type !== 'team') return;
    event.preventDefault();
    const zone = event.currentTarget;
    zone.classList.remove('drag-over', 'drag-over-warn');
    zone.classList.add('drag-over');
    event.dataTransfer.dropEffect = 'move';
};

// Reallocate judges for any round (respects rating + availability)
window.allocateJudgesForRound = function(roundIdx) {
    const round = state.rounds?.[roundIdx];
    if (!round) return;
    allocateJudgesToDebates(round.debates, round.type === 'knockout');
    saveNow();
    displayRounds();
    showNotification(`Judges reallocated for Round ${round.id}`, 'success');
};

// Set judge quality rating (1-10)
window.setJudgeRating = function(judgeId, rating) {
    const judge = (state.judges || []).find(j => String(j.id) === String(judgeId));
    if (!judge) return;
    judge.rating = Math.max(1, Math.min(10, parseInt(rating) || 5));
    saveNow();
    showNotification(`${judge.name} rated ${judge.rating}/10`, 'success');
};

// Toggle judge availability for auto-allocation
window.toggleJudgeAvailability = function(judgeId) {
    const judge = (state.judges || []).find(j => String(j.id) === String(judgeId));
    if (!judge) return;
    judge.available = judge.available === false ? true : false;
    saveNow();
    showNotification(`${judge.name} marked ${judge.available === false ? 'unavailable' : 'available'}`, 'info');
    document.querySelectorAll(`[data-judge-avail="${judgeId}"]`).forEach(btn => {
        btn.textContent = judge.available === false ? '❌ Unavailable' : '✅ Available';
        btn.style.background = judge.available === false ? '#fee2e2' : '#dcfce7';
        btn.style.color = judge.available === false ? '#dc2626' : '#10b981';
    });
};

export const swapSides      = swapTeams;
export const openJudgeModal = showJudgeManagement;
export const enterResults   = showEnterResults;

// ─── ADD MISSING EXPORT for admin.js ──────────────────────────────────────────
export { displayAdminRounds, showJudgeManagement };
