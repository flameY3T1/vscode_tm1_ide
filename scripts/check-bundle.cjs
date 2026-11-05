#!/usr/bin/env node
'use strict';

// Post-compile sanity check for the publishable bundle (audit N1).
// Fails `vscode:prepublish` if the extension entry is missing/empty or
// unexpectedly large — the usual symptom of a dependency leaking into the
// esbuild bundle. The bundled entry is ~1.1 MB; 4 MB is a generous ceiling.
const fs = require('node:fs');
const path = require('node:path');

const ENTRY = path.join(__dirname, '..', 'out', 'extension.js');
const MAX_MB = 4;

if (!fs.existsSync(ENTRY)) {
  console.error(`[check-bundle] missing ${ENTRY} — run "npm run compile" first.`);
  process.exit(1);
}

const bytes = fs.statSync(ENTRY).size;
if (bytes === 0) {
  console.error('[check-bundle] out/extension.js is empty.');
  process.exit(1);
}

const mb = bytes / (1024 * 1024);
if (mb > MAX_MB) {
  console.error(
    `[check-bundle] out/extension.js is ${mb.toFixed(1)} MB (> ${MAX_MB} MB) — ` +
    'did a dependency leak into the bundle?',
  );
  process.exit(1);
}

console.log(`[check-bundle] out/extension.js OK (${mb.toFixed(2)} MB).`);

// The VSIX content is an allow list (`files` in package.json), not a deny list:
// a deny list missed new local directories more than once. Without `files`,
// vsce would ship everything on disk.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
  console.error('[check-bundle] package.json has no "files" allow list - vsce would ship every file on disk.');
  process.exit(1);
}
console.log(`[check-bundle] package.json "files" allow list OK (${pkg.files.length} patterns).`);
