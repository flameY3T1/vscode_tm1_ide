#!/usr/bin/env node
// Proves that a change touched comments only: every file is reprinted by the
// TypeScript printer without comments (types kept) and compared against the same file at a git
// revision. Any difference means code, strings or template content changed.
//
//   node scripts/comment-only-diff.mjs [--titles] [rev=HEAD] <path>...
//
// --titles also ignores the title (first argument) of describe/it/test calls,
// for translating test names: every other string must stay identical.
//
// Exit 0 = comment-only, 1 = code changed (files listed).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const args = process.argv.slice(2);
const titles = args[0] === '--titles' ? Boolean(args.shift()) : false;
const rev = args.length > 1 && !args[0].startsWith('src') ? args.shift() : 'HEAD';
const files = execFileSync('git', ['ls-files', '--', ...args], { encoding: 'utf8' })
    .split('\n').filter(f => /\.tsx?$/.test(f));

// Not esbuild or transpileModule: both erase types, so an edited type annotation
// would pass, and esbuild keeps line comments between array elements and above
// class members.
const printer = ts.createPrinter({ removeComments: true });
const TEST_FNS = new Set(['describe', 'it', 'test']);
// it / it.skip / it.each([...]) / describe.each`...` — the root identifier decides.
const isTestCall = (callee) => {
    while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee) || ts.isTaggedTemplateExpression(callee)) {
        callee = ts.isPropertyAccessExpression(callee) ? callee.expression : ts.isCallExpression(callee) ? callee.expression : callee.tag;
    }
    return ts.isIdentifier(callee) && TEST_FNS.has(callee.text);
};
const blankTitles = (ctx) => (root) => {
    const visit = (node) => {
        if (ts.isCallExpression(node) && isTestCall(node.expression) && node.arguments.length
            && (ts.isStringLiteralLike(node.arguments[0]) || ts.isTemplateExpression(node.arguments[0]))) {
            node = ts.factory.updateCallExpression(node, node.expression, node.typeArguments,
                [ts.factory.createStringLiteral(''), ...node.arguments.slice(1)]);
        }
        return ts.visitEachChild(node, visit, ctx);
    };
    return ts.visitNode(root, visit);
};
const strip = (src, file) => {
    let sf = ts.createSourceFile(
        file, src, ts.ScriptTarget.ESNext, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (titles) { sf = ts.transform(sf, [blankTitles]).transformed[0]; }
    return printer.printFile(sf);
};

const changed = [];
for (const file of files) {
    const before = execFileSync('git', ['show', `${rev}:${file}`], { encoding: 'utf8' });
    const after = readFileSync(file, 'utf8');
    if (strip(before, file) !== strip(after, file)) changed.push(file);
}
console.log(`${files.length} files checked against ${rev}`);
if (changed.length) {
    console.log('code changed in:\n  ' + changed.join('\n  '));
    process.exit(1);
}
console.log('comment-only: OK');
