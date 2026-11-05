/**
 * Descriptions + parameter documentation for TI functions.
 * Merged into `KNOWN_SIGNATURES` in `tiSignatures.ts` at module load.
 *
 * Data lives in `media/tiSignatureDocs.json` (Phase 3b of the JSON-asset
 * split, P3-20). The module-local `_DOCS` map is empty at load time;
 * callers must invoke `initSignatureDocs()` first:
 *   - extension host: tiSignaturesNodeBoot.ts reads the JSON from fs
 *   - webviews:       _shared/sigsBootstrap.ts reads the inline <script> tag
 *   - tests:          src/test/setup.ts loads the JSON at vitest init
 *
 * Pulling the data out of this TS module dropped ~13 KB of German
 * description strings out of every Monaco webview bundle that imports
 * tiSignatures (processEditorMonaco, ruleEditorMonaco, processTemplateEditorMonaco).
 *
 * Key = lowercase function name. `paramDocs` = Map<lowercase param name, doc>.
 * Param names must match those in `KNOWN_SIGNATURES` (case-insensitive).
 */

export interface SignatureDoc {
  description: string;
  paramDocs?: Record<string, string>;
}

/** Module-local docs map, populated via `initSignatureDocs`. */
let _DOCS: Record<string, SignatureDoc> = {};

/** Populate the docs map. Idempotent — last call wins. */
export function initSignatureDocs(docs: Record<string, SignatureDoc>): void {
  _DOCS = docs;
}

/**
 * Merges loaded docs into a `KNOWN_SIGNATURES` map.
 * Sets `description` and `params[i].doc` by param name (case-insensitive).
 * Sets `docUrl` / `docUrlV12` via `buildDocUrls(name)` for ALL functions if not already set.
 */
export function applySignatureDocs(
  knownSignatures: Map<string, { name: string; description?: string; docUrl?: string; docUrlV12?: string; params: Array<{ name: string; doc?: string }> }>,
  buildDocUrls: (name: string) => { docUrl?: string; docUrlV12?: string },
): void {
  for (const [key, sig] of knownSignatures) {
    const docs = _DOCS[key];
    if (docs) {
      sig.description = docs.description;
      if (docs.paramDocs) {
        for (const p of sig.params) {
          const d = docs.paramDocs[p.name.toLowerCase()];
          if (d) { p.doc = d; }
        }
      }
    }
    if (!sig.docUrl) {
      Object.assign(sig, buildDocUrls(sig.name));
    }
  }
}
