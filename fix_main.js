// Fix main.js: Remove DOMContentLoaded wrapper and call init() directly
const fs = require('fs');
const path = require('path');

const mainPath = path.join(__dirname, 'js', 'main.js');
let content = fs.readFileSync(mainPath, 'utf8');

// Find the DOMContentLoaded section
const domStart = content.indexOf('// ── DOMContentLoaded');
if (domStart === -1) {
    console.log('DOMContentLoaded section not found');
    process.exit(0);
}

// Find the closing of the event listener (the "});" that closes it)
let braceCount = 0;
let inArrowFunc = false;
let i = domStart;

while (i < content.length) {
    if (content.substr(i, 20).includes('() => {')) {
        inArrowFunc = true;
        braceCount++;
        i += 6;
        continue;
    }
    
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') braceCount--;
    
    if (inArrowFunc && braceCount === 0) {
        // Found the closing brace of the arrow function
        // Now look for "});" which closes addEventListener
        const remaining = content.substring(i);
        const closeParenIndex = remaining.indexOf('});');
        if (closeParenIndex !== -1) {
            i += closeParenIndex + 3;
            break;
        }
    }
    i++;
}

// Now we have from domStart to i as the section to remove
const beforeDOM = content.substring(0, domStart);
const afterDOM = content.substring(i);

// Find where to add init() call - before "Legacy shim"
const legacyShimIndex = afterDOM.indexOf('// ── Legacy shim');
let newContent;

if (legacyShimIndex !== -1) {
    newContent = beforeDOM + 
        afterDOM.substring(0, legacyShimIndex) +
        '\n// Start the app\ninit().catch(err => {\n    console.error(\'[main] Init failed:\', err);\n    showNotification(\'Failed to connect to the server.\', \'error\');\n});\n\n' +
        afterDOM.substring(legacyShimIndex);
} else {
    newContent = beforeDOM + afterDOM + '\n\n// Start the app\ninit().catch(err => {\n    console.error(\'[main] Init failed:\', err);\n});\n';
}

fs.writeFileSync(mainPath, newContent, 'utf8');
console.log('Fixed: Removed DOMContentLoaded wrapper, init() will be called directly');
