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

// ── renderImport ─────────────────────────────────────────────────────
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

// ── File upload helpers ──────────────────────────────────────────────
function loadTeamFile(input) {
    if (!input.files?.length) return;
    const reader = new FileReader();
    reader.onload = () => {
        document.getElementById('teamCsv').value = reader.result;
        previewTeams();
    };
    reader.readAsText(input.files[0]);
}

function loadJudgeFile(input) {
    if (!input.files?.length) return;
    const reader = new FileReader();
    reader.onload = () => {
        document.getElementById('judgeCsv').value = reader.result;
        previewJudges();
    };
    reader.readAsText(input.files[0]);
}

// ── Preview ─────────────────────────────────────────────────────────
export function previewTeams() {
    const text = document.getElementById('teamCsv')?.value.trim();
    const preview = document.getElementById('teamPreview');
    if (!preview) return;
    if (!text) { preview.style.display = 'none'; return; }

    const lines = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseTeamLine).filter(Boolean);
    if (!parsed.length) {
        preview.style.display = 'none';
        return;
    }

    preview.style.display = 'block';
    preview.innerHTML = `
        <h3>Preview (${parsed.length} teams)</h3>
        <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;">
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Name</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">CODE</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Speakers</th>
            </tr></thead>
            <tbody>
                ${parsed.map((t, i) => `
                    <tr style="${i % 2 === 0 ? 'background:#f8fafc;' : ''}">
                        <td style="padding:8px;border:1px solid #e2e8f0;">${escapeHTML(t.name)}</td>
                        <td style="padding:8px;border:1px solid #e2e8f0;">${escapeHTML(t.code || '—')}</td>
                        <td style="padding:8px;border:1px solid #e2e8f0;">${escapeHTML(t.speakers.join(', '))}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

export function previewJudges() {
    const text = document.getElementById('judgeCsv')?.value.trim();
    const preview = document.getElementById('judgePreview');
    if (!preview) return;
    if (!text) { preview.style.display = 'none'; return; }

    const lines = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseJudgeLine).filter(Boolean);
    if (!parsed.length) {
        preview.style.display = 'none';
        return;
    }

    const teamByName = buildTeamByNameMap(state.teams || []);
    preview.style.display = 'block';
    preview.innerHTML = `
        <h3>Preview (${parsed.length} judges)</h3>
        <table style="width:100%;border-collapse:collapse;">
            <thead><tr style="background:#f8fafc;">
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Name</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Role</th>
                <th style="padding:8px;text-align:left;border:1px solid #e2e8f0;">Conflicts</th>
            </tr></thead>
            <tbody>
                ${parsed.map((j, i) => `
                    <tr style="${i % 2 === 0 ? 'background:#f8fafc;' : ''}">
                        <td style="padding:8px;border:1px solid #e2e8f0;">${escapeHTML(j.name)}</td>
                        <td style="padding:8px;border:1px solid #e2e8f0;">${escapeHTML(j.role)}</td>
                        <td style="padding:8px;border:1px solid #e2e8f0;">${(j.conflicts || []).map(c => teamByName[c]?.name || c).join(', ')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

// ── Parse lines ────────────────────────────────────────────────────
function _parseTeamLine(raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const [name, code, ...speakerParts] = parts;
    const speakers = speakerParts.length
        ? speakerParts
        : name.split(/\s+/).slice(1); // fallback: treat words after first as speakers
    return { name: parts[0], code: code || '', speakers: speakers.map((s, i) => ({ name: s, position: i + 1 })) };
}

function _parseJudgeLine(raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const [name, role, ...conflictParts] = parts;
    return {
        name,
        role: ['chair', 'panellist', 'observer'].includes(role?.toLowerCase())
            ? role.toLowerCase()
            : 'panellist',
        conflicts: conflictParts.filter(Boolean),
    };
}

// ── importTeams ───────────────────────────────────────────────────────
export async function importTeams() {
    console.log('[file-manager] importTeams() called');
    const text = document.getElementById('teamCsv')?.value.trim();
    if (!text) { showNotification('No data to import', 'error'); return; }

    const lines = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseTeamLine).filter(Boolean);
    if (!parsed.length) { showNotification('No valid teams found — check the format', 'error'); return; }

    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }

    showNotification(`Importing ${parsed.length} teams…`, 'info');

    try {
        const result = await api.bulkCreateTeams(tournId, parsed);
        const teamErrMsg = result.errors.length ? ` — ${result.errors.map(e => e.error).join('; ')}` : '';
        showNotification(
            result.imported > 0
                ? `Imported ${result.imported} team(s)${result.skipped ? ` (${result.skipped} skipped)` : ''}${result.errors.length ? ` ⚠️ ${result.errors.length} error(s)${teamErrMsg}` : ''}`
                : `Import failed${teamErrMsg}`,
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

// ── importJudges ──────────────────────────────────────────────────────
export async function importJudges() {
    const text = document.getElementById('judgeCsv')?.value.trim();
    if (!text) { showNotification('No data to import', 'error'); return; }

    const lines = text.split('\n').filter(l => l.trim());
    const parsed = lines.map(_parseJudgeLine).filter(Boolean);
    if (!parsed.length) { showNotification('No valid judges found', 'error'); return; }

    const tournId   = state.activeTournamentId;
    const teamByName = buildTeamByNameMap(state.teams || []);

    showNotification(`Importing ${parsed.length} judges…`, 'info');

    try {
        const result = await api.bulkCreateJudges(tournId, parsed);
        showNotification(
            `✅ Imported ${result.imported} judge(s)${result.skipped ? ` (${result.skipped} skipped)` : ''}`,
            result.imported > 0 ? 'success' : 'error'
        );

        if (result.imported > 0) {
            clearJudgeImport();
            // Reload judges into cache
            const judges = await api.getJudges(tournId);
            state.judges = judges;
            window.updateNavDropdowns?.();
        }
    } catch (e) {
        showNotification(`Import failed: ${e.message}`, 'error');
    }
}

// ── Clear imports ───────────────────────────────────────────────────
export function clearTeamImport() {
    const ta = document.getElementById('teamCsv');
    if (ta) ta.value = '';
    const preview = document.getElementById('teamPreview');
    if (preview) preview.style.display = 'none';
}

export function clearJudgeImport() {
    const ta = document.getElementById('judgeCsv');
    if (ta) ta.value = '';
    const preview = document.getElementById('judgePreview');
    if (preview) preview.style.display = 'none';
}

// ── Export ──────────────────────────────────────────────────────────
export async function exportData() {
    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }

    showNotification('Exporting…', 'info');
    try {
        const [teams, judges, rounds] = await Promise.all([
            api.getTeams(tournId),
            api.getJudges(tournId),
            api.getRounds(tournId),
        ]);
        const blob = new Blob([
            JSON.stringify({ teams, judges, rounds }, null, 2)
        ], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `orion-backup-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Export complete', 'success');
    } catch (e) {
        showNotification(`Export failed: ${e.message}`, 'error');
    }
}

export function exportStandings() {
    const teams = state.teams || [];
    if (!teams.length) { showNotification('No teams to export', 'error'); return; }
    const header = 'Rank,Team,Total,P1,P2,P3\n';
    const rows = teams
        .sort((a, b) => (b.total || 0) - (a.total || 0))
        .map((t, i) => {
            const p = [1,2,3].map(n => t[`p${n}`] ?? '');
            return `${i+1},"${t.name}",${t.total||0},${p.join(',')}`;
        });
    _downloadCsv(header + rows.join('\n'), 'standings.csv');
}

export function exportSpeakerStandings() {
    const teams = state.teams || [];
    let rows = [];
    teams.forEach(t => {
        (t.speakers || []).forEach(s => {
            rows.push({ name: s.name, team: t.name, total: s.total || 0, teamRank: 0 });
        });
    });
    rows.sort((a, b) => b.total - a.total);
    rows.forEach((r, i) => r.rank = i + 1);
    if (!rows.length) { showNotification('No speakers to export', 'error'); return; }
    const header = 'Rank,Speaker,Team,Total\n';
    const body = rows.map(r => `${r.rank},"${r.name}","${r.team}",${r.total}`).join('\n');
    _downloadCsv(header + body, 'speaker-standings.csv');
}

function _downloadCsv(content, filename) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ── fullReset ─────────────────────────────────────────────────────────
export async function fullReset() {
    if (!confirm('⚠️ This will wipe ALL tournament data. This cannot be undone. Continue?')) return;
    const tournId = state.activeTournamentId;
    if (!tournId) { showNotification('No active tournament', 'error'); return; }
    try {
        await api.fullTournamentWipe(tournId);
        showNotification('Tournament wiped. Reloading…', 'info');
        setTimeout(() => location.reload(), 1000);
    } catch (e) {
        showNotification(`Wipe failed: ${e.message}`, 'error');
    }
}

// ── Register actions ─────────────────────────────────────────────────
registerActions({
    renderImport,
    importTeams, importJudges,
    previewTeams, previewJudges,
    clearTeamImport, clearJudgeImport,
    exportData, exportStandings, exportSpeakerStandings,
    fullReset,
});
