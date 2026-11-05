#!/usr/bin/env node
/**
 * Reads every JSON file in src/tiLogicVisualizer/signatures/ (sorted by
 * filename = category order) and emits media/tiSignatures.json — the
 * runtime asset consumed by the extension host (tiSignaturesNodeBoot.ts)
 * and webviews (_shared/sigsBootstrap.ts via inline <script> embedding).
 *
 * The Infinity sentinel ("__INFINITY__") in the JSON payload is rehydrated
 * to a real JS `Infinity` at load-time by tiSignaturesLoader.ts.
 *
 * Usage:  node scripts/build-signatures.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const SIG_DIR = path.resolve(__dirname, '..', 'src', 'tiLogicVisualizer', 'signatures');
const OUT_JSON = path.resolve(__dirname, '..', 'media', 'tiSignatures.json');
const JSON_SCHEMA_VERSION = 1;

function loadSections() {
  const files = fs.readdirSync(SIG_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .sort();
  return files.map(file => {
    const data = JSON.parse(fs.readFileSync(path.join(SIG_DIR, file), 'utf8'));
    return { file, title: data.title, entries: data.entries };
  });
}

function main() {
  const sections = loadSections();
  const allEntries = sections.flatMap(s => s.entries);
  const jsonPayload = {
    version: JSON_SCHEMA_VERSION,
    count: allEntries.length,
    signatures: allEntries,
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(jsonPayload));
  console.log(`generated ${path.basename(OUT_JSON)} from ${sections.length} categories, ${allEntries.length} entries (${(fs.statSync(OUT_JSON).size / 1024).toFixed(1)} KB)`);
}

main();
