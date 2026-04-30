// ============================================
// SAMPLE DATA GENERATOR FOR TESTING
// Standalone module — no modal, renders inline via admin.js _sectionSample()
// Supports: standard (2-team), BP (4-team), speech modes
// ============================================

import { state, save } from './state.js';
import { showNotification } from './utils.js';

let renderSpeakerStandings = null;
try {
    const speakersModule = await import('./speakers.js');
    renderSpeakerStandings = speakersModule.renderSpeakerStandings;
} catch (e) {
    console.log('Speaker module not available yet');
}

// ============================================
// READ CONFIG FROM INLINE FORM & GENERATE
// ============================================
function generateCustomSampleData() {
    const teamCount       = parseInt(document.getElementById('sample-team-count')?.value  || '20');
    const roundCount      = parseInt(document.getElementById('sample-round-count')?.value  || '5');
    const judgeCount      = parseInt(document.getElementById('sample-judge-count')?.value  || '12');
    const includeKnockout = document.getElementById('sample-include-knockout')?.checked ?? true;
    const randomizeScores = document.getElementById('sample-randomize-scores')?.checked   ?? true;

    generateCustomData(teamCount, roundCount, judgeCount, includeKnockout, randomizeScores);
}

// ============================================
// MAIN GENERATOR FUNCTION
// ============================================
function generateCustomData(numTeams, numRounds, numJudges, includeKnockout, randomizeScores) {
    const activeId = state.activeTournamentId;
    const tour = state.tournaments?.[activeId];
    const format = tour?.format || 'standard';
    const isBP     = format === 'bp';
    const isSpeech = tour?.speechMode || format === 'speech';

    const formatLabel = isBP ? 'BP' : isSpeech ? 'Speech' : 'Standard';
    const unitLabel   = isSpeech ? 'speakers' : 'teams';

    if (!confirm(`Generate ${formatLabel} sample data with:\n• ${numTeams} ${unitLabel}\n• ${numRounds} rounds\n• ${numJudges} judges\n• ${includeKnockout ? 'With' : 'Without'} knockout rounds\n\nThis will replace all existing data.`)) {
        return;
    }

    state.teams  = [];
    state.judges = [];
    state.rounds = [];

    if (isSpeech) {
        generateSpeechSpeakers(numTeams);
        generateCustomJudges(numJudges);
        generateSpeechRounds(numRounds, randomizeScores);
    } else if (isBP) {
        generateCustomTeams(numTeams);
        generateCustomJudges(numJudges);
        generateBPRounds(numRounds, includeKnockout, randomizeScores);
    } else {
        generateCustomTeams(numTeams);
        generateCustomJudges(numJudges);
        generateCustomRounds(numRounds, includeKnockout, randomizeScores);
    }

    save();

    import('./utils.js').then(utils => {
        if (utils.updatePublicCounts) utils.updatePublicCounts();
    });

    if (typeof renderSpeakerStandings === 'function') renderSpeakerStandings();

    showNotification(`✅ Generated ${numTeams} ${unitLabel}, ${numJudges} judges, ${numRounds} rounds! (${formatLabel})`, 'success');

    if (typeof window.adminSwitchSection === 'function') {
        window.adminSwitchSection('overview');
    } else if (typeof window.switchTab === 'function') {
        window.switchTab('standings');
    }
}

// ============================================
// SHARED NAME LISTS
// ============================================
const UNIVERSITIES = [
    'Harvard', 'Yale', 'Princeton', 'Stanford', 'MIT', 'Oxford', 'Cambridge',
    'UChicago', 'Columbia', 'Penn', 'Duke', 'Northwestern', 'Georgetown',
    'Berkeley', 'UCLA', 'Michigan', 'Virginia', 'Cornell', 'Brown', 'Dartmouth',
    'Johns Hopkins', 'Caltech', 'NYU', 'USC', 'Carnegie Mellon', 'Emory', 'Vanderbilt'
];
const TEAM_SUFFIXES = [
    'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P',
    'Alpha','Beta','Gamma','Delta','Epsilon','Zeta',
    'Liberty','Equality','Justice','Progress','Vision','Legacy',
    'Atlas','Apollo','Aurora','Phoenix','Titan','Olympus'
];
const FIRST_NAMES = [
    'James','John','Robert','Michael','William','David','Richard','Joseph',
    'Sarah','Emma','Olivia','Ava','Isabella','Sophia','Mia','Charlotte',
    'Liam','Noah','Oliver','Elijah','Benjamin','Lucas','Henry','Alexander',
    'Ethan','Jacob','Daniel','Matthew','Samuel','Amelia','Evelyn'
];
const LAST_NAMES = [
    'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
    'Rodriguez','Martinez','Wilson','Anderson','Taylor','Thomas','Moore',
    'Jackson','Martin','Lee','Thompson','White','Harris','Clark','Lewis',
    'Robinson','Walker','Young','Allen','King','Wright','Scott'
];
const MOTIONS = [
    "This House believes that AI will create more jobs than it destroys",
    "This House would abolish private prisons",
    "This House supports universal basic income",
    "This House believes that social media does more harm than good",
    "This House would ban single-use plastics",
    "This House supports term limits for politicians",
    "This House believes that college education should be free",
    "This House would legalize all drugs",
    "This House supports a four-day work week",
    "This House believes that voting should be compulsory",
    "This House would give the vote to 16 year olds",
    "This House believes that economic growth is incompatible with sustainability",
    "This House supports open borders",
    "This House would abolish the monarchy",
    "This House believes that cancel culture has gone too far"
];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function uniqueName() { return `${rnd(FIRST_NAMES)} ${rnd(LAST_NAMES)}`; }

// ============================================
// GENERATE STANDARD TEAMS
// ============================================
function generateCustomTeams(numTeams) {
    const usedCodes = new Set();
    for (let i = 0; i < numTeams; i++) {
        let code;
        do {
            code = rnd(UNIVERSITIES).substring(0,3).toUpperCase() + rnd(TEAM_SUFFIXES).substring(0,2).toUpperCase() + rndInt(10,99);
        } while (usedCodes.has(code));
        usedCodes.add(code);

        const numSpeakers = 2 + Math.floor(Math.random() * 2);
        const speakers = [];
        const usedNames = new Set();
        for (let j = 0; j < numSpeakers; j++) {
            let sName;
            do { sName = uniqueName(); } while (usedNames.has(sName));
            usedNames.add(sName);
            speakers.push({ name: sName, substantiveScores:{}, replyScores:{}, substantiveTotal:0, replyTotal:0, substantiveCount:0, replyCount:0 });
        }

        state.teams.push({
            id: `team_${Date.now()}_${i}`,
            name: `${rnd(UNIVERSITIES)} ${rnd(TEAM_SUFFIXES)}`,
            code, speakers, wins:0, total:0, roundScores:{}, eliminated:false, broke:false
        });
    }
}

// ============================================
// GENERATE JUDGES
// ============================================
function generateCustomJudges(numJudges) {
    const jFirstNames = ['Michael','David','Robert','William','James','Charles','Thomas','Patricia','Jennifer','Linda','Elizabeth','Susan','Jessica','Sarah','Christopher','Matthew','Anthony','Donald','Mark','Paul','Steven'];
    const jLastNames  = ['Chen','Patel','Rodriguez','Kim','Singh','Thompson','Garcia','Martinez','Wilson','Brown','Davis','Miller','Jones','Williams','Johnson','Lee','Wang','Li','Zhang','Anderson','Thomas'];
    const usedEmails = new Set();

    for (let i = 0; i < numJudges; i++) {
        const fn = rnd(jFirstNames);
        const ln = rnd(jLastNames);
        let email;
        do {
            email = `${fn.toLowerCase()}.${ln.toLowerCase()}${rndInt(1,999)}@example.com`;
        } while (usedEmails.has(email));
        usedEmails.add(email);

        state.judges.push({
            id: `judge_${Date.now()}_${i}`,
            name: `${fn} ${ln}`, email,
            institution: rnd(UNIVERSITIES),
            conflicts:[], rounds:[], active:true
        });
    }

    state.judges.forEach(judge => {
        const count = Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            if (state.teams.length > 0) {
                const t = rnd(state.teams);
                if (!judge.conflicts.includes(t.id)) judge.conflicts.push(t.id);
            }
        }
    });
}

// ============================================
// GENERATE STANDARD ROUNDS (2-team)
// ============================================
function generateCustomRounds(numRounds, includeKnockout, randomizeScores) {
    const teamPerf = {};
    state.teams.forEach(t => { teamPerf[t.id] = { wins:0, total:0, roundScores:{} }; });

    for (let roundNum = 1; roundNum <= numRounds; roundNum++) {
        const active = state.teams.filter(t => !t.eliminated);
        if (active.length < 2) break;

        const sorted = [...active].sort((a,b) => {
            const wDiff = (teamPerf[b.id]?.wins||0) - (teamPerf[a.id]?.wins||0);
            return wDiff !== 0 ? wDiff : (teamPerf[b.id]?.total||0) - (teamPerf[a.id]?.total||0);
        });

        const debates = [];
        for (let i = 0; i < sorted.length - 1; i += 2) {
            const gov = sorted[i], opp = sorted[i+1];
            const govTotal = 280 + Math.random() * 30;
            const oppTotal = 280 + Math.random() * 30;
            if (govTotal > oppTotal) teamPerf[gov.id].wins++; else teamPerf[opp.id].wins++;
            teamPerf[gov.id].total += govTotal;
            teamPerf[opp.id].total += oppTotal;
            teamPerf[gov.id].roundScores[roundNum] = govTotal;
            teamPerf[opp.id].roundScores[roundNum] = oppTotal;

            debates.push({
                gov: gov.id, opp: opp.id, entered:true, panel:[],
                attendance:{ gov:true, opp:true },
                govResults:{ teamName:gov.name, substantive:gov.speakers.map(s=>({ speaker:s.name, score:70+Math.random()*8 })), reply:{ speaker:gov.speakers[0]?.name, score:34+Math.random()*4 }, total:govTotal },
                oppResults:{ teamName:opp.name, substantive:opp.speakers.map(s=>({ speaker:s.name, score:70+Math.random()*8 })), reply:{ speaker:opp.speakers[0]?.name, score:34+Math.random()*4 }, total:oppTotal }
            });
        }

        state.rounds.push({ id: roundNum, motion: rnd(MOTIONS), debates, type:'prelim', blinded:false,
            rooms: debates.map((_,i) => i < 26 ? `Room ${String.fromCharCode(65+i)}` : `Room ${i+1}`) });
    }

    state.teams.forEach(team => {
        const perf = teamPerf[team.id];
        if (perf) {
            team.wins = perf.wins; team.total = perf.total; team.roundScores = perf.roundScores;
            if (team.wins >= Math.ceil(state.teams.length * 0.4)) team.broke = true;
        }
    });

    if (includeKnockout) _generateStandardKnockout(numRounds);
}

function _generateStandardKnockout(numPrelimRounds) {
    const breaking = [...state.teams.filter(t => t.broke)].sort((a,b) => b.wins - a.wins);
    if (breaking.length < 4) return;
    let offset = numPrelimRounds;
    if (breaking.length >= 8) {
        offset++;
        state.rounds.push({ id: offset, motion: rnd(MOTIONS),
            debates: Array(4).fill(null).map((_,i) => ({
                gov: breaking[i*2]?.id, opp: breaking[i*2+1]?.id,
                entered:true, panel:[], attendance:{ gov:true, opp:true }
            })), type:'knockout', blinded:false, rooms:['QF A','QF B','QF C','QF D'] });
    }
    offset++;
    state.rounds.push({ id: offset, motion: rnd(MOTIONS),
        debates: [
            { gov: breaking[0]?.id, opp: breaking[1]?.id, entered:true, panel:[], attendance:{ gov:true, opp:true } },
            { gov: breaking[2]?.id, opp: breaking[3]?.id, entered:true, panel:[], attendance:{ gov:true, opp:true } }
        ], type:'knockout', blinded:false, rooms:['SF A','SF B'] });
    offset++;
    state.rounds.push({ id: offset, motion: rnd(MOTIONS),
        debates: [{ gov: breaking[0]?.id, opp: breaking[2]?.id, entered:true, panel:[], attendance:{ gov:true, opp:true } }],
        type:'knockout', blinded:false, rooms:['Grand Final'] });
}

// ============================================
// GENERATE BP ROUNDS (4-team rooms: OG/OO/CG/CO)
// ============================================
function generateBPRounds(numRounds, includeKnockout, randomizeScores) {
    // BP scores: 3 (1st), 2 (2nd), 1 (3rd), 0 (4th) per room
    const teamPerf = {};
    state.teams.forEach(t => { teamPerf[t.id] = { wins:0, points:0, total:0, roundScores:{} }; });

    const positions = ['og','oo','cg','co'];
    const posNames  = { og:'Opening Government', oo:'Opening Opposition', cg:'Closing Government', co:'Closing Opposition' };

    for (let roundNum = 1; roundNum <= numRounds; roundNum++) {
        const active = state.teams.filter(t => !t.eliminated);
        if (active.length < 4) break;

        const sorted = [...active].sort((a,b) => {
            const pDiff = (teamPerf[b.id]?.points||0) - (teamPerf[a.id]?.points||0);
            return pDiff !== 0 ? pDiff : (teamPerf[b.id]?.total||0) - (teamPerf[a.id]?.total||0);
        });

        // Shuffle within point brackets for variety
        const shuffled = [];
        for (let i = 0; i < sorted.length; i += 4) {
            const group = sorted.slice(i, i+4);
            for (let j = group.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j+1));
                [group[j], group[k]] = [group[k], group[j]];
            }
            shuffled.push(...group);
        }

        const debates = [];
        for (let i = 0; i <= shuffled.length - 4; i += 4) {
            const [og, oo, cg, co] = shuffled.slice(i, i+4);
            if (!og || !oo || !cg || !co) break;

            // Random placement order (1st–4th)
            const teams = [og, oo, cg, co];
            const order = [0,1,2,3].sort(() => Math.random() - 0.5); // random finish
            const pts   = [3,2,1,0];

            order.forEach((teamIdx, place) => {
                const team = teams[teamIdx];
                const pos  = positions[teamIdx];
                const score = 240 + Math.random() * 40;
                teamPerf[team.id].points += pts[place];
                teamPerf[team.id].total  += score;
                teamPerf[team.id].roundScores[roundNum] = { place: place+1, points: pts[place], score };
                // Record win (1st or 2nd = advance/win in BP terms)
                if (place < 2) teamPerf[team.id].wins++;
            });

            const speakerScore = () => ({ score: 70 + Math.random() * 10, reply: 34 + Math.random() * 5 });

            debates.push({
                og: og.id, oo: oo.id, cg: cg.id, co: co.id,
                entered: true, panel: [],
                ogResults: { teamName: og.name, place: order.indexOf(0)+1, points: pts[order.indexOf(0)], speakers: og.speakers.map(() => speakerScore()) },
                ooResults: { teamName: oo.name, place: order.indexOf(1)+1, points: pts[order.indexOf(1)], speakers: oo.speakers.map(() => speakerScore()) },
                cgResults: { teamName: cg.name, place: order.indexOf(2)+1, points: pts[order.indexOf(2)], speakers: cg.speakers.map(() => speakerScore()) },
                coResults: { teamName: co.name, place: order.indexOf(3)+1, points: pts[order.indexOf(3)], speakers: co.speakers.map(() => speakerScore()) }
            });
        }

        state.rounds.push({ id: roundNum, motion: rnd(MOTIONS), debates, type:'prelim', blinded:false,
            rooms: debates.map((_,i) => i < 26 ? `Room ${String.fromCharCode(65+i)}` : `Room ${i+1}`) });
    }

    state.teams.forEach(team => {
        const perf = teamPerf[team.id];
        if (perf) {
            team.wins       = perf.wins;
            team.total      = perf.total;
            team.bpPoints   = perf.points;
            team.roundScores = perf.roundScores;
            // Top ~1/3 break in BP
            if (perf.points >= Math.ceil(numRounds * 1.5)) team.broke = true;
        }
    });

    if (includeKnockout) _generateBPKnockout(numRounds);
}

function _generateBPKnockout(numPrelimRounds) {
    const breaking = [...state.teams.filter(t => t.broke)].sort((a,b) => (b.bpPoints||0) - (a.bpPoints||0));
    if (breaking.length < 4) return;
    let offset = numPrelimRounds;

    if (breaking.length >= 8) {
        offset++;
        const semis = [];
        for (let i = 0; i < 2 && i*4 < breaking.length; i++) {
            const [og, oo, cg, co] = breaking.slice(i*4, i*4+4);
            if (!og || !oo || !cg || !co) break;
            semis.push({ og: og.id, oo: oo.id, cg: cg.id, co: co.id, entered:true, panel:[] });
        }
        if (semis.length > 0) {
            state.rounds.push({ id: offset, motion: rnd(MOTIONS), debates: semis, type:'knockout', blinded:false,
                rooms: semis.map((_,i) => `SF Room ${i+1}`) });
        }
    }

    offset++;
    const [og, oo, cg, co] = breaking.slice(0, 4);
    if (og && oo && cg && co) {
        state.rounds.push({ id: offset, motion: rnd(MOTIONS),
            debates: [{ og: og.id, oo: oo.id, cg: cg.id, co: co.id, entered:true, panel:[] }],
            type:'knockout', blinded:false, rooms:['Grand Final'] });
    }
}

// ============================================
// GENERATE SPEECH ROUNDS (individual speakers)
// ============================================
function generateSpeechSpeakers(numSpeakers) {
    const usedNames = new Set();
    for (let i = 0; i < numSpeakers; i++) {
        let name;
        do { name = uniqueName(); } while (usedNames.has(name));
        usedNames.add(name);

        // In speech mode, each "team" is a single speaker entry
        state.teams.push({
            id: `spk_${Date.now()}_${i}`,
            name, code: name.split(' ').map(w => w[0]).join('').toUpperCase(),
            institution: rnd(UNIVERSITIES),
            speakers: [{ name, scores: [], total: 0, count: 0 }],
            wins: 0, total: 0, roundScores: {}, eliminated: false, broke: false,
            isSpeaker: true
        });
    }
}

function generateSpeechRounds(numRounds, randomizeScores) {
    const speakerPerf = {};
    state.teams.forEach(s => { speakerPerf[s.id] = { wins: 0, total: 0, roundScores: {} }; });

    for (let roundNum = 1; roundNum <= numRounds; roundNum++) {
        const active = state.teams.filter(s => !s.eliminated);
        if (active.length < 2) break;

        const sorted = [...active].sort((a,b) =>
            (speakerPerf[b.id]?.total||0) - (speakerPerf[a.id]?.total||0)
        );

        const debates = [];
        // Speech: group into rooms of variable size (4–6 per room)
        const roomSize = Math.min(6, Math.max(4, Math.floor(sorted.length / Math.ceil(sorted.length / 5))));
        for (let i = 0; i < sorted.length; i += roomSize) {
            const group = sorted.slice(i, i + roomSize);
            if (group.length < 2) break;

            // Assign random scores within group
            const scores = group.map(() => 60 + Math.random() * 20);
            const ranked = group
                .map((spk, idx) => ({ spk, score: scores[idx] }))
                .sort((a, b) => b.score - a.score);

            ranked.forEach(({ spk, score }, place) => {
                speakerPerf[spk.id].total += score;
                speakerPerf[spk.id].roundScores[roundNum] = { place: place+1, score };
                if (place === 0) speakerPerf[spk.id].wins++;
            });

            debates.push({
                speakers: group.map(s => s.id),
                results: ranked.map(({ spk, score }, place) => ({ speakerId: spk.id, name: spk.name, score: Math.round(score * 10)/10, place: place+1 })),
                entered: true, panel: []
            });
        }

        state.rounds.push({ id: roundNum, motion: rnd(MOTIONS), debates, type:'prelim', blinded:false,
            rooms: debates.map((_,i) => `Room ${i+1}`) });
    }

    state.teams.forEach(s => {
        const perf = speakerPerf[s.id];
        if (perf) {
            s.wins = perf.wins; s.total = perf.total; s.roundScores = perf.roundScores;
            if (perf.total / numRounds >= 68) s.broke = true;
        }
    });
}

// ============================================
// ATTACH TO WINDOW
// ============================================
window.generateCustomSampleData = generateCustomSampleData;
window.generateCustomData        = generateCustomData;

console.log('✅ Sample data generator loaded');

export { generateCustomSampleData, generateCustomData };
