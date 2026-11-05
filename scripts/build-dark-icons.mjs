#!/usr/bin/env node
// Generates media/icons/dark/*.svg from media/icons/light/*.svg
// by substituting light theme colors with dark equivalents.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lightDir = join(__dirname, '..', 'media', 'icons', 'light');
const darkDir  = join(__dirname, '..', 'media', 'icons', 'dark');

// Color substitutions: light value → dark value
const subs = [
  ['#424242', '#CCCCCC'], // stroke
  ['#0066B8', '#3794FF'], // cube accent
  ['#107C10', '#4EC9B0'], // dimension accent
  ['#CA5010', '#CE9178'], // process accent
  ['#8764B8', '#C586C0'], // chore accent
  ['#4CAF50', '#73C991'], // server-connected status dot
];

if (!existsSync(lightDir)) {
  console.log(`Light icons dir does not exist: ${lightDir}`);
  process.exit(0);
}

if (!existsSync(darkDir)) mkdirSync(darkDir, { recursive: true });

const files = readdirSync(lightDir).filter(f => f.endsWith('.svg'));
let count = 0;
for (const f of files) {
  let svg = readFileSync(join(lightDir, f), 'utf8');
  for (const [from, to] of subs) {
    svg = svg.split(from).join(to);
  }
  writeFileSync(join(darkDir, f), svg);
  count++;
}
console.log(`Generated ${count} dark icons in ${darkDir}`);
