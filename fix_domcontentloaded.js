// Simple fix: Remove DOMContentLoaded wrapper and call init() directly
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Find the DOMContentLoaded section and remove it
// The pattern is: // ── DOMContentLoaded ─... followed by document.addEventListener('DOMContentLoaded', () => {
// We need to remove from that point to the matching closing });

const domStart = content.indexOf('// ── DOMContentLoaded');
if (domStart === -1) {
    console.log('DOMContentLoaded section not found - already removed?');
    process.exit(0);
}

// Find the start of the event listener
const listenerStart = content.indexOf("document.addEventListener('DOMContentLoaded'", domStart);
if (listenerStart === -1) {
    console.log('Event listener not found');
    process.exit(0);
}

// Find the matching closing brace for the arrow function
let braceCount = 0;
let inArrowFunc = false;
let i = listenerStart;

while (i < content.length) {
    if (content.substr(i, 30).includes('() => {')) {
        inArrowFunc = true;
        braceCount++;
        i += 6; // Skip "() => {"
        continue;
    }
    
    if (content[i] === '{') {
        braceCount++;
    } else if (content[i] === '}') {
        braceCount--;
        if (inArrowFunc && braceCount === 0) {
            // Found the closing brace of the arrow function
            // Include the closing "});" which is the closing of addEventListener
            // Look for the next "});" pattern
            const remaining = content.substring(i);
            const closeParenIndex = remaining.indexOf('});');
            if (closeParenIndex !== -1) {
                i += closeParenIndex + 3; // Include "});"
                break;
            }
        }
    }
    i++;
}

// Now we have from domStart to i (exclusive) as the section to remove
const beforeSection = content.substring(0, domStart);
const afterSection = content.substring(i);

// Find where to add init() call - before "// ── Legacy shim"
const legacyShimIndex = afterSection.indexOf('// ── Legacy shim');
let newContent;
if (legacyShimIndex !== -1) {
    newContent = beforeSection + 
        afterSection.substring(0, legacyShimIndex) +
        '\n// Start the app\ninit().catch(err => {\n    console.error(\'[main] Init failed:\', err);\n    showNotification(\'Failed to connect to the server.\', \'error\');\n});\n\n' +
        afterSection.substring(legacyShimIndex);
} else {
    newContent = beforeSection + afterSection + '\n\n// Start the app\ninit().catch(err => {\n    console.error(\'[main] Init failed:\', err);\n});\n';
}

fs.writeFileSync(mainPath, newContent, 'utf8');
console.log('Fixed: Removed DOMContentLoaded wrapper, init() will be called directly');
