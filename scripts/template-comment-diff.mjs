// Usage: node scripts/template-comment-diff.mjs <file>...
//
// Companion to comment-only-diff.mjs for comments INSIDE template literals (CSS /* */,
// HTML <!-- -->, // in embedded scripts): the TypeScript printer sees those as string
// content and reports "code changed". This compares HEAD vs working tree after
// removing all three comment forms by regex, whitespace collapsed.
import { execSync } from 'child_process';
import fs from 'fs';
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1').replace(/\s+/g, ' ').trim();
let bad = 0;
for (const f of process.argv.slice(2)) {
  const a = strip(execSync(`git show HEAD:${f}`, { encoding: 'utf8', maxBuffer: 1e8 }));
  const b = strip(fs.readFileSync(f, 'utf8'));
  if (a !== b) { bad++; let i = 0; while (a[i] === b[i]) i++; console.log(`DIFF ${f}: HEAD «${a.slice(i-40,i+60)}» vs NOW «${b.slice(i-40,i+60)}»`); }
}
console.log(bad ? `${bad} file(s) changed outside comments` : 'OK: only comments changed');
process.exit(bad ? 1 : 0);
