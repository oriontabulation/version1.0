// ============================================
// UTILS.JS - Helper functions used everywhere
// ============================================

import { state } from './state.js';

// Escape HTML to prevent XSS
function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#039;');
}

// Show notification
function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; top: 16px; right: 16px; padding: 7px 13px;
        background: ${type === 'success' ? '#2e7d32' : type === 'error' ? '#dc2626' : '#1a73e8'};
        color: white; border-radius: 8px; z-index: 10001; animation: slideIn 0.3s;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18); font-size: 12px; font-weight: 600;
        max-width: 260px; line-height: 1.4;
    `;
    notif.textContent = message;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// Close all modals
function closeAllModals() {
    document.querySelectorAll('.modal-overlay, .modal').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
}

// Update public counts
function updatePublicCounts() {
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('public-team-count',  state.teams.length);
    set('public-judge-count', state.judges.length);
    set('public-round-count', state.rounds.filter(r => r.type === 'prelim').length);
}

// Update header tournament name
function updateHeaderTournamentName() {
    const el = document.getElementById('header-tournament-name');
    if (el && state.activeTournamentId) {
        const t = state.tournaments.find(t => t.id === state.activeTournamentId);
        el.textContent = t?.name ? `| ${t.name}` : '';
    }
}

// Get previous meetings
function getPreviousMeetings() {
    const meetings = {};
    (state.rounds || []).forEach(round => {
        const debates = round.debates || [];
        debates.forEach(debate => {
            const gov = debate.gov;
            const opp = debate.opp;
            if (!gov || !opp) return;
            if (!meetings[gov]) meetings[gov] = {};
            if (!meetings[opp]) meetings[opp] = {};
            meetings[gov][opp] = (meetings[gov][opp] || 0) + 1;
            meetings[opp][gov] = (meetings[opp][gov] || 0) + 1;
        });
    });
    return meetings;
}

// Factory for a blank speaker record
function createSpeakerObj(name) {
    return {
        id: crypto.randomUUID(),
        name,
        substantiveTotal:  0,
        substantiveCount:  0,
        substantiveScores: {},
        replyTotal:        0,
        replyCount:        0,
        replyScores:       {}
    };
}

// Debounce — used by state.js (save) and speakers.js
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Returns the team's code. If no code is set, derives a short consistent
 * code from the team name (initials of each word, up to 5 chars) with an
 * ID-based suffix to avoid collisions.
 */
export function teamCode(team) {
    if (!team) return '';
    if (team.code) return team.code;

    const words = (team.name || '').trim().split(/\s+/).filter(Boolean);
    let derived = '';
    if (words.length === 1) {
        derived = words[0].substring(0, 4).toUpperCase();
    } else {
        // Take up to 2 chars per word until we have 4–5 chars
        for (const w of words) {
            derived += w.substring(0, words.length <= 2 ? 2 : 1).toUpperCase();
            if (derived.length >= 4) break;
        }
    }

    // Append last 2 chars of the id for uniqueness if name-based prefix is short
    const idSuffix = String(team.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-2).toUpperCase();
    derived = (derived + idSuffix).substring(0, 6);

    return derived || 'TEAM';
}

export {
    escapeHTML,
    showNotification,
    closeAllModals,
    updatePublicCounts,
    updateHeaderTournamentName,
    getPreviousMeetings,
    createSpeakerObj,
    debounce,
};