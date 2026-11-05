/**
 * Webview-side bootstrap that populates KNOWN_SIGNATURES from inline JSON
 * embedded in the host HTML.
 *
 * MUST be imported FIRST in any webview entry-point that uses KNOWN_SIGNATURES.
 * Module-load side-effect reads the `#tm1-signatures-data` <script> tag, parses
 * the JSON payload, and calls initKnownSignatures() — synchronously — so that
 * subsequent imports of tiSignatures see a populated Map.
 *
 * Phase 3b of the JSON-asset split (plan 2026-05-24-tisignatures-json-asset-split.md).
 */
import { initKnownSignatures, setIbmDocLanguage } from '../../tiLogicVisualizer/tiSignatures';
import { parseSignaturesJson } from '../../tiLogicVisualizer/tiSignaturesLoader';

declare global {
  interface Window { __tm1DocLang?: string }
}

function bootstrap(): void {
  // Before initKnownSignatures: the doc URLs are baked onto the signatures
  // there. The host injects the display language; anything IBM does not serve
  // falls back to English inside setIbmDocLanguage.
  setIbmDocLanguage(window.__tm1DocLang);

  const el = document.getElementById('tm1-signatures-data');
  if (!el || !el.textContent) {
    console.error('[tm1] sigs bootstrap: #tm1-signatures-data element missing or empty');
    return;
  }
  try {
    const entries = parseSignaturesJson(el.textContent);
    initKnownSignatures(entries);
  } catch (err) {
    console.error('[tm1] sigs bootstrap: parse/init failed', err);
  }
}

bootstrap();

export {};
