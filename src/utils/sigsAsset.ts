/**
 * Helper for embedding the tiSignatures JSON asset inline into webview HTML.
 *
 * Reads `media/tiSignatures.json` once (cached) and returns its content as a
 * string safe to inject into an HTML `<script type="application/json">` tag.
 *
 * Phase 3b of the JSON-asset split. Used by thin-shell HTML generators
 * (processEditorMonacoWebview, ruleEditorMonacoWebview).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { localeAssetNames } from './localeChain';
import * as vscode from 'vscode';

let _cached: string | null = null;
let _cachedDocs: string | null = null;

/**
 * Returns the JSON text with `</` substrings escaped so embedding inside a
 * `<script>` tag cannot prematurely close it. Caches the file content.
 */
export function getInlineSignaturesJson(extensionUri: vscode.Uri): string {
  if (_cached !== null) { return _cached; }
  const jsonPath = path.join(extensionUri.fsPath, 'media', 'tiSignatures.json');
  const raw = fs.readFileSync(jsonPath, 'utf8');
  // Escape `</` to prevent HTML parser from closing the embedding <script> tag.
  _cached = raw.replace(/<\//g, '<\\/');
  return _cached;
}

/**
 * P3-20: companion to getInlineSignaturesJson — embeds the SIGNATURE_DOCS
 * data (German descriptions + paramDocs) extracted from the TS bundle to
 * media/tiSignatureDocs.json. Returns `{"version":1,"docs":{}}` if the
 * asset is missing, so webview bootstrap stays functional without docs
 * (descriptions fall back to undefined, IBM doc-URL is still set).
 */
export function getInlineSignatureDocsJson(extensionUri: vscode.Uri): string {
  if (_cachedDocs !== null) { return _cachedDocs; }
  // English is the source, `…Docs.<language>.json` the translation — so first
  // try the language variants, then the base. If the translation is missing,
  // English texts cost less than an empty documentation. The same chain is used by
  // `tiSignaturesNodeBoot` im Host; sie liegt deshalb in `utils/localeChain`.
  const dir = path.join(extensionUri.fsPath, 'media');
  const candidates = localeAssetNames('tiSignatureDocs', 'json', vscode.env.language)
    .map((f) => path.join(dir, f));
  for (const jsonPath of candidates) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      _cachedDocs = raw.replace(/<\//g, '<\\/');
      return _cachedDocs;
    } catch { /* try the next candidate */ }
  }
  _cachedDocs = '{"version":1,"docs":{}}';
  return _cachedDocs;
}
