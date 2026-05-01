const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'file-manager.js');
let content = fs.readFileSync(filePath, 'utf8');

// Fix the malformed importTeams function
const oldPattern = /export async function importTeams\(\) \{\`n    console\.log\(`\[file-manager\] importTeams\(\) called`\);\`n    debugger; \/\/ Pause here for debugging`n    const text =/;

const newContent = `export async function importTeams() {
    console.log('[file-manager] importTeams() called');
    const text =`;

if (content.includes(oldPattern)) {
    content = content.replace(oldPattern, newContent);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed importTeams syntax error');
} else {
    console.log('Pattern not found, checking manually...');
    // Find the line with the problem
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('console.log(`[file-manager] importTeams() called`)')) {
            lines[i] = "export async function importTeams() {";
            lines[i+1] = "    console.log('[file-manager] importTeams() called');";
            lines[i+2] = "    const text = document.getElementById('teamCsv')?.value.trim();";
            content = lines.slice(0, i).join('\n') + '\n' + lines.slice(i).join('\n');
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Fixed by manual line replacement');
            break;
        }
    }
}
