#!/usr/bin/env node
/**
 * One-shot extractor: parses src/tiLogicVisualizer/tiSignatures.ts and dumps
 * each entry of the KNOWN_SIGNATURES Map literal into a per-category JSON
 * file under src/tiLogicVisualizer/signatures/<NN>-<slug>.json.
 *
 * Categories are detected via `// ── <Name> ──` section headers in the source.
 * Entries are evaluated as JS object literals in a vm sandbox (with Infinity
 * mapped to a sentinel) — robust against arbitrary nested arrays/objects.
 *
 * Usage:  node scripts/extract-signatures.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.resolve(__dirname, '..', 'src', 'tiLogicVisualizer', 'tiSignatures.ts');
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'tiLogicVisualizer', 'signatures');

const INF_SENTINEL = '__INFINITY__';

function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function findEntries(source) {
  const HEADER_RE = /^\s*\/\/\s*──\s*(.+?)\s*──/gm;
  const headers = [];
  let m;
  while ((m = HEADER_RE.exec(source)) !== null) {
    headers.push({ title: m[1].trim(), start: m.index, headerEnd: m.index + m[0].length });
  }

  const sections = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const next = headers[i + 1];
    sections.push({
      title: h.title,
      body: source.slice(h.headerEnd, next ? next.start : source.length),
    });
  }
  return sections;
}

/** Find each [key, {body}] tuple in section text. */
function extractEntries(sectionBody) {
  const out = [];
  const START_RE = /\[\s*'([a-z0-9_]+)'\s*,\s*\{/g;
  let m;
  while ((m = START_RE.exec(sectionBody)) !== null) {
    const key = m[1];
    const objStart = m.index + m[0].length - 1;
    let depth = 0;
    let i = objStart;
    let inStr = null;
    let prev = '';
    for (; i < sectionBody.length; i++) {
      const c = sectionBody[i];
      if (inStr) {
        if (c === inStr && prev !== '\\') { inStr = null; }
      } else if (c === "'" || c === '"' || c === '`') {
        inStr = c;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) { break; }
      }
      prev = c;
    }
    if (depth !== 0) {
      throw new Error(`unbalanced braces for entry '${key}' at offset ${objStart}`);
    }
    const objText = sectionBody.slice(objStart, i + 1);
    out.push({ key, objText });
    START_RE.lastIndex = i + 1;
  }
  return out;
}

function evalObject(body) {
  const cleaned = body.replace(/\s+as\s+const/g, '');
  const sandbox = { Infinity, result: undefined };
  vm.createContext(sandbox);
  vm.runInContext(`result = ${cleaned};`, sandbox);
  return mapInfinity(sandbox.result);
}

function mapInfinity(v) {
  if (v === Infinity) { return INF_SENTINEL; }
  if (Array.isArray(v)) { return v.map(mapInfinity); }
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { o[k] = mapInfinity(v[k]); }
    return o;
  }
  return v;
}

function main() {
  const source = fs.readFileSync(SRC, 'utf8');
  const mapStart = source.indexOf('export const KNOWN_SIGNATURES');
  if (mapStart < 0) { throw new Error('KNOWN_SIGNATURES export not found'); }
  const mapClose = source.indexOf(']);', mapStart);
  if (mapClose < 0) { throw new Error('map closing not found'); }
  const mapBody = source.slice(mapStart, mapClose);

  const sections = findEntries(mapBody);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const indexEntries = [];
  let totalEntries = 0;

  for (let i = 0; i < sections.length; i++) {
    const { title, body } = sections[i];
    const slug = slugify(title);
    if (!slug) { continue; }
    const entries = extractEntries(body);
    if (entries.length === 0) { continue; }

    const payload = entries.map(({ key, objText }) => {
      let value;
      try {
        value = evalObject(objText);
      } catch (err) {
        console.error(`failed to eval entry '${key}' in section '${title}':`, err.message);
        throw err;
      }
      return [key, value];
    });

    const outFile = path.join(OUT_DIR, `${i.toString().padStart(2, '0')}-${slug}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ title, entries: payload }, null, 2) + '\n');
    indexEntries.push({ index: i, slug, title, count: payload.length, file: path.basename(outFile) });
    totalEntries += payload.length;
  }

  fs.writeFileSync(
    path.join(OUT_DIR, '_index.json'),
    JSON.stringify({ totalEntries, infSentinel: INF_SENTINEL, sections: indexEntries }, null, 2) + '\n',
  );

  console.log(`wrote ${indexEntries.length} category files, ${totalEntries} total entries`);
}

main();
