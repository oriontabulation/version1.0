// ============================================================
// FILE-MANAGER.JS — Import / Export (refactored)
//
// KEY CHANGES:
//   - importTeams() / importJudges() use api.bulkCreateTeams/Judges
//   - exportData() exports from Supabase state (no localStorage)
//   - fullReset() calls api.fullTournamentWipe()
//   - preview rendering uses DOM methods for team/judge names
// ============================================================

import { state }                          from './state.js';
import { api }                            from './api.js';
import { buildTeamByNameMap }             from './maps.js';
import { showNotification, escapeHTML }   from './utils.js';
import { registerActions }                from './router.js';

// ── renderImport ─────────────────────────────────────────────────────────────
export function renderImport() {
    const container = document.getElementById('import-container');
    if (!container) return;

    // Static HTML scaffold — no user data interpolated
    container.innerHTML = `
        <div class="section">
            <h2>Export Data</h2>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn btn-primary" data-action="exportData">Export Tournament (JSON)</button>
                <button class="btn btn-secondary" data-action="exportStandings">Export Standings (CSV)</button>
                <button class="btn btn-secondary" data-action="exportSpeakerStandings">Export Speakers (CSV)</button>
            </div>
        </div>

        <div class="section">
            <h2>Import Teams</h2>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin-bottom:16px;font-size:13px;color:#1e40af;">
                <strong>Format:</strong> Team Name, CODE (optional), Speaker 1, Speaker 2, Speaker 3
            </div>
            <div style="background:#f8fafc;padding:20px;border-radius:12px;margin-bottom:20px;">
                <input type="file" id="teamFileInput" accept=".txt,.csv"
                       style="flex:1;padding:10px;border:2px solid #e2e8f0;border-radius:8px;margin-bottom:12px;width:100%;box-sizing:border-box;">
                <textarea id="teamCsv" rows="7"
                          placeholder="Harvard Debate, John Smith, Emma Wilson, Michael Chen&#10;Oxford Union, OXF, Sarah Jones, David Brown"
                          style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:8px;font-family:monospace;font-size:12px;box-sizing:border-box;"></textarea>
                <div style="display:flex;gap:10px;margin-top:15px;flex-wrap:wrap;">
                    <button class="btn btn-secondary" data-action="previewTeams">Preview</button>
                    <button class="btn btn-primary"   data-action="importTeams">Import Teams</button>
                    <button class="btn btn-secondary" data-action="clearTeamImport">Clear</button>
                </div>
            </div>
            <div id="teamPreview" style="margin-top:15px;display:none;background:white;padding:20px;border-radius:12px;border:2px solid #e2e8f0;"></div>
        </div>

        <div class="section">
            <h2>Import Judges</h2>
            <p style="color:#64748b;margin-bottom:15px;font-size:13px;">
                Format: <code>Judge Name, Role (chair/panellist), Conflict Team 1, Conflict Team 2, ...</code>
            </p>
            <div style="background:#f8fafc;padding:20px;border-radius:12px;margin-bottom:20px;">
                <input type="file" id="judgeFileInput" accept=".txt,.csv"
                       style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:8px;margin-bottom:12px;box-sizing:border-box;">
                <textarea id="judgeCsv" rows="6"
                          placeholder="Robert Johnson, chair, Harvard Debate, Oxford Union&#10;Maria Garcia, panellist, Sydney United"
                          style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:8px;font-family:monospace;box-sizing:border-box;"></textarea>
                <div style="display:flex;gap:10px;margin-top:15px;flex-wrap:wrap;">
                    <button class="btn btn-secondary" data-action="previewJudges">Preview</button>
                    <button class="btn btn-primary"   data-action="importJudges">Import Judges</button>
                    <button class="btn btn-secondary" data-action="clearJudgeImport">Clear</button>
                </div>
            </div>
            <div id="judgePreview" style="margin-top:15px;display:none;background:white;padding:20px;border-radius:12px;border:2px solid #e2e8f0;"></div>
        </div>`;

    // File input listeners
    setTimeout(() => {
        document.getElementById('teamFileInput')
            ?.addEventListener('change', function() { loadTeamFile(this); });
        document.getElementById('judgeFileInput')
            ?.addEventListener('change', function() { loadJudgeFile(this); });
    }, 0);
}

// ── File loaders ──────────────────────────────────────────────────────────────
export function loadTeamFile(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const ta = document.getElementById('teamCsv');
        if (ta) ta.value = e.target.result;
    };
    reader.readAsText(file);
}

export function loadJudgeFile(input) {
    const file = input?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const ta = document.getElementById('judgeCsv');
        if (ta) ta.value = e.target.result;
    };
    reader.readAsText(file);
}

export function clearTeamImport() {
    const ta = document.getElementById('teamCsv');
    const fi = document.getElementById('teamFileInput');
    const pr = document.getElementById('teamPreview');
    if (ta) ta.value = '';
    if (fi) fi.value = '';
    if (pr) { pr.innerHTML = ''; pr.style.display = 'none'; }
}

export function clearJudgeImport() {
    const ta = document.getElementById('judgeCsv');
    const fi = document.getElementById('judgeFileInput');
    const pr = document.getElementById('judgePreview');
    if (ta) ta.value = '';
    if (fi) fi.value = '';
    if (pr) { pr.innerHTML = ''; pr.style.display = 'none'; }
}

// ── CSV parsers ───────────────────────────────────────────────────────────────
function _parseTeamLine(line) {
    const raw = line.split(',').map(s => s.trim()).filter(Boolean);
    if (!raw.length) return null;
    const teamName = raw[0];
    let cursor = 1;
    let teamCode = teamName.substring(0, 3).toUpperCase();
    if (/^[A-Z]{2,4}$/.test(raw[cursor] || '')) teamCode = raw[cursor++];
    const speakers = [];
    while (cursor < raw.length) {
        const token = raw[cursor];
        if (!isNaN(parseFloat(token)) && isFinite(token)) {
            if (speakers.length > 0) speakers[speakers.length - 1].scores.push(parseFloat(token));
            cursor++;
        } else {
            speakers.push({ name: token, scores: [] });
            cursor++;
        }
    }
    if (speakers.length === 0) return null;
    return { name: teamName, code: teamCode, speakers };
}

function _parseJudgeLine(line) {
    const parts = line.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 1) return null;
    const name   = parts[0];
    const roleRaw = (parts[1] || '').toLowerCase();
    let role = 'panellist';
    if (roleRaw.includes('chair')) role = 'chair';
    const affiliations = parts.slice(2);
    return { name, role, affiliations };
}

// ── Preview ───────────────────────────────────────────────────────────────────
export function previewTeams() {
    const text    = document.getElementById('teamCsv')?.value.trim();
    const preview = document.getElementById('teamPreview');
    if (!text) { showNotification('Paste team data first', 'error'); return; }

    const lines  = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseTeamLine).filter(Boolean);

    // Build table with DOM — team names via textContent
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;';
    const thead = document.createElement('thead');
    const htr   = document.createElement('tr');
    for (const h of ['Team', 'Code', 'Speakers']) {
        const th = document.createElement('th');
        th.style.cssText = 'text-align:left;padding:10px;border-bottom:2px solid #e2e8f0;background:#f1f5f9;';
        th.textContent = h;
        htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const team of parsed) {
        const tr = document.createElement('tr');
        const tdName  = document.createElement('td'); tdName.style.padding  = '10px;border-bottom:1px solid #e2e8f0;'; tdName.textContent  = team.name;
        const tdCode  = document.createElement('td'); tdCode.style.padding  = '10px;border-bottom:1px solid #e2e8f0;'; tdCode.textContent  = team.code;
        const tdSpks  = document.createElement('td'); tdSpks.style.padding  = '10px;border-bottom:1px solid #e2e8f0;'; tdSpks.textContent  = team.speakers.map(s => s.name).join(', ');
        tr.appendChild(tdName); tr.appendChild(tdCode); tr.appendChild(tdSpks);
        tbody.appendChild(tr);
    }
    if (parsed.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td'); td.colSpan = 3; td.style.cssText = 'padding:20px;text-align:center;color:#64748b;'; td.textContent = 'No valid teams found — check the format';
        tr.appendChild(td); tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    preview.innerHTML = '';
    const title = document.createElement('h3');
    title.style.cssText = 'margin-top:0;margin-bottom:15px;';
    title.textContent   = '📋 Preview';
    preview.appendChild(title);
    preview.appendChild(table);
    const note = document.createElement('p');
    note.style.cssText = 'margin-top:15px;color:#64748b;';
    note.textContent   = `Found ${parsed.length} team(s). Click "Import Teams" to add them.`;
    preview.appendChild(note);
    preview.style.display = 'block';
}

export function previewJudges() {
    const text    = document.getElementById('judgeCsv')?.value.trim();
    const preview = document.getElementById('judgePreview');
    if (!text) { showNotification('Paste judge data first', 'error'); return; }

    const lines  = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseJudgeLine).filter(Boolean);

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;';
    const thead = document.createElement('thead');
    const htr   = document.createElement('tr');
    for (const h of ['Name', 'Role', 'Conflicts']) {
        const th = document.createElement('th'); th.style.cssText = 'text-align:left;padding:10px;border-bottom:2px solid #e2e8f0;background:#f1f5f9;'; th.textContent = h; htr.appendChild(th);
    }
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const j of parsed) {
        const tr = document.createElement('tr');
        const tdN = document.createElement('td'); tdN.style.padding = '10px;border-bottom:1px solid #e2e8f0;'; tdN.textContent = j.name;
        const tdR = document.createElement('td'); tdR.style.padding = '10px;border-bottom:1px solid #e2e8f0;'; tdR.textContent = j.role;
        const tdC = document.createElement('td'); tdC.style.padding = '10px;border-bottom:1px solid #e2e8f0;'; tdC.textContent = j.affiliations.join(', ') || 'None';
        tr.appendChild(tdN); tr.appendChild(tdR); tr.appendChild(tdC); tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    preview.innerHTML = '';
    const title = document.createElement('h3'); title.style.cssText = 'margin-top:0;margin-bottom:15px;'; title.textContent = '📋 Preview'; preview.appendChild(title);
    preview.appendChild(table);
    const note = document.createElement('p'); note.style.cssText = 'margin-top:15px;color:#64748b;'; note.textContent = `Found ${parsed.length} judge(s). Click "Import Judges" to add them.`; preview.appendChild(note);
    preview.style.display = 'block';
}

// ── importTeams ───────────────────────────────────────────────────────────────
export async function importTeams() {`n    console.log(`[file-manager] importTeams() called`);`n    debugger; // Pause here for debugging
    const text = document.getElementById('teamCsv')?.value.trim();
    if (!text) { showNotification('No data to import', 'error'); return; }

    const lines  = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseTeamLine).filter(Boolean);
    if (!parsed.length) { showNotification('No valid teams found — check the format', 'error'); return; }

    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }

    showNotification(`Importing ${parsed.length} teams…`, 'info');

    try {
        const result = await api.bulkCreateTeams(tournId, parsed);
        showNotification(
            `✅ Imported ${result.imported} team(s)${result.skipped ? ` (${result.skipped} skipped — duplicates)` : ''}${result.errors.length ? ` ⚠️ ${result.errors.length} errors` : ''}`,
            result.imported > 0 ? 'success' : 'error'
        );

        if (result.imported > 0) {
            clearTeamImport();
            // Reload teams into cache
            const teams = await api.getTeams(tournId);
            state.teams = teams;
            window.updateNavDropdowns?.();
        }
    } catch (e) {
        showNotification(`Import failed: ${e.message}`, 'error');
    }
}

// ── importJudges ──────────────────────────────────────────────────────────────
export async function importJudges() {
    const text = document.getElementById('judgeCsv')?.value.trim();
    if (!text) { showNotification('No data to import', 'error'); return; }

    const lines  = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseJudgeLine).filter(Boolean);
    if (!parsed.length) { showNotification('No valid judges found', 'error'); return; }

    const tournId   = state.activeTournamentId;
    const teamByName = buildTeamByNameMap(state.teams || []);

    showNotification(`Importing ${parsed.length} judges…`, 'info');

    try {
        const result = await api.bulkCreateJudges(tournId, parsed, teamByName);
        showNotification(
            `✅ Imported ${result.imported} judge(s)${result.skipped ? ` (${result.skipped} skipped)` : ''}`,
            result.imported > 0 ? 'success' : 'error'
        );

        if (result.imported > 0) {
            clearJudgeImport();
            const judges = await api.getJudges(tournId);
            state.judges = judges;
        }
    } catch (e) {
        showNotification(`Import failed: ${e.message}`, 'error');
    }
}

// ── Export functions ──────────────────────────────────────────────────────────
function _download(filename, content, mimeType = 'text/csv;charset=utf-8;') {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

export function exportData() {
    // Export the in-memory state (which mirrors Supabase data)
    const exportObj = {
        exportedAt: new Date().toISOString(),
        tournamentId: state.activeTournamentId,
        teams:   state.teams   || [],
        judges:  state.judges  || [],
        rounds:  state.rounds  || [],
        publish: state.publish || {}
    };
    _download(
        `orion_tournament_${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(exportObj, null, 2),
        'application/json;charset=utf-8;'
    );
    showNotification('Tournament data exported', 'success');
}

export function exportStandings() {
    const teams  = [...(state.teams || [])].sort((a, b) => ((b.wins || 0) - (a.wins || 0)) || ((b.total_points || 0) - (a.total_points || 0)));
    const rounds = (state.rounds || []).filter(r => r?.type === 'prelim').sort((a, b) => (a.round_number || 0) - (b.round_number || 0));
    if (!teams.length) { showNotification('No teams to export', 'warning'); return; }

    let csv = 'Rank,Team Name,Team Code';
    for (const r of rounds) csv += `,Round ${r.round_number}`;
    csv += ',Wins,Total Points,Status\n';

    teams.forEach((t, i) => {
        let row = `${i + 1},${(t.name || '').replace(/,/g, ' ')},${t.code || ''}`;
        for (const r of rounds) {
            const key = `${t.id}:${r.id}`;
            row += `,—`;    // Round scores now in ballot_speaker_scores — simplified export
        }
        const status = t.eliminated ? 'Eliminated' : t.broke ? 'Breaking' : 'Active';
        row += `,${t.wins || 0},${(t.total_points || 0).toFixed(1)},${status}`;
        csv += row + '\n';
    });
    _download(`standings_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showNotification('Standings exported', 'success');
}

export function exportSpeakerStandings() {
    if (typeof window.exportSpeakerStandings === 'function') {
        window.exportSpeakerStandings();
    } else {
        showNotification('Speaker export not available', 'error');
    }
}

export function exportTeams() {
    const teams = state.teams || [];
    if (!teams.length) { showNotification('No teams to export', 'warning'); return; }
    let csv = 'Team Name,Code,Speakers,Wins,Points,Status\n';
    for (const t of teams) {
        const spks   = (t.speakers || []).map(s => s.name || '').join('; ').replace(/,/g, ';');
        const name   = (t.name || '').replace(/,/g, ' ');
        const status = t.eliminated ? 'Eliminated' : t.broke ? 'Breaking' : 'Active';
        csv += `"${name}",${t.code || ''},"${spks}",${t.wins || 0},${(t.total_points || 0).toFixed(1)},${status}\n`;
    }
    _download(`teams_${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showNotification(`${teams.length} teams exported`, 'success');
}

// ── fullReset ─────────────────────────────────────────────────────────────────
export async function fullReset() {
    if (!confirm('⚠️ This will permanently delete ALL tournament data. Are you absolutely sure?')) return;
    const tournId = state.activeTournamentId;
    if (!tournId) return;

    try {
        await api.fullTournamentWipe(tournId);
        state.teams   = [];
        state.judges  = [];
        state.rounds  = [];
        state.publish = {};
        showNotification('Tournament data wiped', 'info');
        window.switchTab?.('public');
    } catch (e) {
        showNotification(`Reset failed: ${e.message}`, 'error');
    }
}

// ── Register actions ──────────────────────────────────────────────────────────
registerActions({
    renderImport,
    previewTeams, previewJudges,
    importTeams,  importJudges,
    clearTeamImport, clearJudgeImport,
    exportData, exportStandings, exportSpeakerStandings, exportTeams,
    fullReset
});


