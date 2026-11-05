import { build, context } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from 'fs';

const watch = process.argv.includes('--watch');
const minify = !watch;

// Single source of truth for extension version: package.json#version.
// Injected via esbuild `define` as `__EXT_VERSION__` — replaces the
// previously hardcoded EXT_CLIENT_ID constant in src/tm1Rest/transport/auth.ts.
const { version: pkgVersion } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const versionDefine = { __EXT_VERSION__: JSON.stringify(pkgVersion) };

// Fallback for MIT packages that ship no license text (see writeThirdPartyNotices).
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Replaces `import * as monaco from 'monaco-editor'` with a stub that reads
// from `globalThis.monaco`. Real monaco-editor lives in monaco-vendor.js
// (shared across 4 editor webviews). Without this plugin every editor bundle
// duplicates monaco-editor (~4.2 MB IIFE).
const monacoShimPlugin = {
  name: 'monaco-shim',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^monaco-editor$/ }, () => ({
      path: 'monaco-editor',
      namespace: 'monaco-shim',
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: 'monaco-shim' }, () => ({
      contents: 'module.exports = globalThis.monaco;',
      loader: 'js',
    }));
  },
};

// monaco-editor 0.55.1 vendors its own copy of DOMPurify (3.2.7) at
// vs/base/browser/dompurify/dompurify.js and imports it via a relative path
// in domSanitize.js. The npm `overrides` pin of dompurify -> 3.4.17 only
// replaces node_modules/dompurify (which nothing imports), so the shipped
// monaco-vendor bundle would still carry 3.2.7. Redirect monaco's relative
// import to the overridden dompurify package so the patched sanitizer ships.
// monaco only uses sanitize/addHook/removeAllHooks — stable across versions.
const dompurifyOverridePlugin = {
  name: 'dompurify-override',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /[\\/]dompurify[\\/]dompurify\.js$/ }, async (args) => {
      const resolved = await pluginBuild.resolve('dompurify', {
        kind: 'import-statement',
        resolveDir: args.resolveDir,
      });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      return { path: resolved.path };
    });
  },
};

const commonWebview = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outdir: 'out/webview',
  minify,
  sourcemap: minify ? 'external' : true,
  loader: {
    '.ttf': 'file',
  },
  define: versionDefine,
  logLevel: 'info',
};

const vendorBuild = {
  ...commonWebview,
  entryPoints: {
    'monaco-vendor': 'src/webviewClient/monacoVendor/index.ts',
  },
  plugins: [dompurifyOverridePlugin],
};

const editorBuild = {
  ...commonWebview,
  entryPoints: {
    'processEditorMonaco': 'src/webviewClient/processEditorMonaco/index.ts',
    'ruleEditorMonaco': 'src/webviewClient/ruleEditorMonaco/index.ts',
    'mdxRunnerMonaco': 'src/webviewClient/mdxRunnerMonaco/index.ts',
    'mdxPopupEditor': 'src/webviewClient/mdxPopupEditor/index.ts',
    'cubeViewerMonaco': 'src/webviewClient/cubeViewerMonaco/index.ts',
    'dimensionBrowser': 'src/webviewClient/dimensionBrowser/index.ts',
    'dimensionEditor': 'src/webviewClient/dimensionEditor/index.ts',
    'choreEditor': 'src/webviewClient/choreEditor/index.ts',
    'securityElement': 'src/webviewClient/securityElement/index.ts',
    'securityUserGroup': 'src/webviewClient/securityUserGroup/index.ts',
    'securityCubeMatrix': 'src/webviewClient/securityCubeMatrix/index.ts',
    'securityDimMatrix': 'src/webviewClient/securityDimMatrix/index.ts',
    'securityProcessMatrix': 'src/webviewClient/securityProcessMatrix/index.ts',
    'processTemplateEditorMonaco': 'src/webviewClient/processTemplateEditorMonaco/index.ts',
    'addServer': 'src/webviewClient/addServer/index.ts',
    'areaDbBuilder': 'src/webviewClient/areaDbBuilder/index.ts',
    'cellTrace': 'src/webviewClient/cellTrace/index.ts',
    'findReplace': 'src/webviewClient/findReplace/index.ts',
    'tiConsistency': 'src/webviewClient/tiConsistency/index.ts',
    'v12Readiness': 'src/webviewClient/v12Readiness/index.ts',
    'tiConsole': 'src/webviewClient/tiConsole/index.ts',
    'valueNaming': 'src/webviewClient/tiValueNaming/index.ts',
    'objectOverview': 'src/webviewClient/objectOverview/index.ts',
    'processGrouping': 'src/webviewClient/processGrouping/index.ts',
    'bulkDelete': 'src/webviewClient/bulkDelete/index.ts',
    'bulkDeploy': 'src/webviewClient/bulkDeploy/index.ts',
    'transactionLog': 'src/webviewClient/transactionLog/index.ts',
    'consolidationCompare': 'src/webviewClient/consolidationCompare/index.ts',
    'feederAudit': 'src/webviewClient/feederAudit/index.ts',
    'messageLogStartup': 'src/webviewClient/messageLogStartup/index.ts',
    'messageLogAnalysis': 'src/webviewClient/messageLogAnalysis/index.ts',
    'createCube': 'src/webviewClient/createCube/index.ts',
    'newProcess': 'src/webviewClient/newProcess/index.ts',
    'choreOverview': 'src/webviewClient/choreOverview/index.ts',
    'messageLog': 'src/webviewClient/messageLog/index.ts',
    'tm1Top': 'src/webviewClient/tm1Top/index.ts',
    'serverConfigEditor': 'src/webviewClient/serverConfigEditor/index.ts',
    'threads': 'src/webviewClient/threads/index.ts',
    'callGraph': 'src/webviewClient/callGraph/index.ts',
    'choreGraph': 'src/webviewClient/choreGraph/index.ts',
    'usageGraph': 'src/webviewClient/usageGraph/index.ts',
    'processCoverage': 'src/webviewClient/processCoverage/index.ts',
    'gitConfig': 'src/webviewClient/gitConfig/index.ts',
    'snippetEditor': 'src/webviewClient/snippetEditor/index.ts',
    'cubeStats': 'src/webviewClient/cubeStats/index.ts',
    'reorderDims': 'src/webviewClient/reorderDims/index.ts',
    'cellSecurityBuilder': 'src/webviewClient/cellSecurityBuilder/index.ts',
    'tiTestSummary': 'src/webviewClient/tiTestSummary/index.ts',
    'tiTestDiff': 'src/webviewClient/tiTestDiff/index.ts',
    'paramForm': 'src/webviewClient/paramForm/index.ts',
    'workbenchPicker': 'src/webviewClient/workbenchPicker/index.ts',
    'lineage': 'src/webviewClient/lineage/index.ts',
  },
  plugins: [monacoShimPlugin],
};

const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node16',
  outfile: 'out/extension.js',
  external: ['vscode'],
  minify,
  sourcemap: minify ? 'external' : true,
  define: versionDefine,
  logLevel: 'info',
};

// Wipe webview outdir before bundling so renamed/removed entry points
// do not leave stale .js next to current bundles (would otherwise ship
// in the VSIX and confuse browsers / cause CSP nonce mismatches).
// Skipped in --watch to keep incremental dev fast.
if (!watch) {
  rmSync('out/webview', { recursive: true, force: true });
  mkdirSync('out/webview', { recursive: true });
}

if (watch) {
  const vctx = await context(vendorBuild);
  const wctx = await context(editorBuild);
  const ectx = await context(extensionBuild);
  await Promise.all([vctx.watch(), wctx.watch(), ectx.watch()]);
  console.log('esbuild watching extension + monaco-vendor + editor bundles...');
} else {
  const results = await Promise.all(
    [vendorBuild, editorBuild, extensionBuild].map((b) => build({ ...b, metafile: true })),
  );
  writeThirdPartyNotices(results.map((r) => r.metafile));
}

// MIT, ISC, Zlib and Apache-2.0 all require the license text to travel with every
// copy, and minify strips it from the bundles. Collect it from the packages esbuild
// actually bundled, so the list cannot drift from the code.
function writeThirdPartyNotices(metafiles) {
  const pkgDirs = new Set();
  for (const meta of metafiles) {
    for (const input of Object.keys(meta.inputs)) {
      const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      if (m) pkgDirs.add(m[1]);
    }
  }
  const sections = [...pkgDirs].sort().map((dir) => {
    const { name, version, license, author } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
    const files = readdirSync(dir);
    // Every license file, so dual-licensed packages (dompurify) ship both texts
    // instead of whichever happens to sort first.
    const text = files
      .filter((f) => /^(licen[sc]e|copying)/i.test(f))
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8').trim())
      .join('\n\n');
    // Some ship no license file (isarray, proxy-agent-negotiate); MIT is fixed text.
    const fallback = license === 'MIT' && author && `Copyright (c) ${author.name ?? author}\n\n${MIT_TEXT}`;
    if (!text && !fallback) throw new Error(`[notices] ${name}: no license text in ${dir}`);
    // monaco-editor vendors further code and lists it in its own notices file.
    const nested = files.find((f) => /^third.?party.?notices/i.test(f));
    const nestedText = nested ? `\n\n${readFileSync(`${dir}/${nested}`, 'utf8').trim()}` : '';
    return `${name} ${version} (${license})\n${'-'.repeat(72)}\n${text || fallback}${nestedText}`;
  });
  writeFileSync(
    'out/THIRD_PARTY_NOTICES.txt',
    'This extension bundles the following third-party packages.\n\n' + sections.join('\n\n\n') + '\n',
  );
  console.log(`[notices] out/THIRD_PARTY_NOTICES.txt: ${sections.length} packages`);
}
