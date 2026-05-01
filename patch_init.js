// Patch main.js to add initialization tracking
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Add initialization tracking variables at the top of init function
const initFunction = 'async function init() {';
const patchedInit = `async function init() {
    window.__orionReady = false;
    window.__orionStep = 'starting';
    console.log('[main] init() started');
    
    try {
        window.__orionStep = 'init-router';
        console.log('[main] Step 1: Init router...');
        // 0. Init router immediately
        initRouter();
        window.__orionStep = 'restore-session';
        console.log('[main] Step 2: Restore session...');`;

if (!content.includes('window.__orionReady = false;')) {
    content = content.replace(initFunction, patchedInit);
    fs.writeFileSync(mainPath, content, 'utf8');
    console.log('Patched main.js with initialization tracking');
} else {
    console.log('main.js already patched');
}
