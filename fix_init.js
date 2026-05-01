// Fix: Remove DOMContentLoaded wrapper and call init() directly
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Find and remove the DOMContentLoaded wrapper
// The pattern is: // ── DOMContentLoaded ─... followed by document.addEventListener('DOMContentLoaded', () => {
// We need to remove from that point until the matching closing });

let inDOMContentLoaded = false;
let braceCount = 0;
let lines = content.split('\n');
let newLines = [];
let i = 0;

while (i < lines.length) {
    const line = lines[i];
    
    if (line.includes('// ── DOMContentLoaded')) {
        inDOMContentLoaded = true;
        braceCount = 0;
        i++;
        continue;
    }
    
    if (inDOMContentLoaded) {
        // Count opening and closing braces
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        braceCount += openBraces - closeBraces;
        
        // Check if this line has the event listener
        if (line.includes('document.addEventListener')) {
            // Skip this line and the opening brace
            i++;
            braceCount++; // Account for the opening brace of the arrow function
            continue;
        }
        
        // Check if we've closed the event listener
        if (braceCount <= 0 && line.includes('});')) {
            // Skip this line (the closing of addEventListener)
            inDOMContentLoaded = false;
            i++;
            continue;
        }
        
        // Inside the event listener - keep these lines but remove the outer wrapper
        newLines.push(line);
    } else {
        newLines.push(line);
    }
    i++;
}

// Add init() call at the end (before the legacy shim)
let newContent = newLines.join('\n');

// Find where to add init() call - before "Legacy shim"
const legacyShimIndex = newContent.indexOf('// ── Legacy shim');
if (legacyShimIndex !== -1) {
    newContent = newContent.substring(0, legacyShimIndex) + 
        '\n// Start the app\ninit().catch(err => {\n    console.error(\'[main] Init failed:\', err);\n    showNotification(\'Failed to connect to the server.\', \'error\');\n});\n\n' + 
        newContent.substring(legacyShimIndex);
}

fs.writeFileSync(mainPath, newContent, 'utf8');
console.log('Fixed: Removed DOMContentLoaded wrapper, init() will be called directly');
