const fs = require('fs');
const path = require('path');

// Copy manifest.json, versions.json, styles.css to build root alongside main.js
const root = process.cwd();
const files = ['manifest.json', 'versions.json', 'styles.css'];

for (const f of files) {
  const src = path.join(root, f);
  const dest = path.join(root, f);
  if (fs.existsSync(src)) {
    // no-op, kept for parity; in real-world we might output to dist/
  }
}

console.log('Postbuild complete.');

