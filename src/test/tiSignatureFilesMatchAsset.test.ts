import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The category files under `src/tiLogicVisualizer/signatures/` must list the same
 * set of functions as the shipped asset `media/tiSignatures.json` —
 * and each function exactly once.
 *
 * Why this is a guard of its own and not the generator:
 * `scripts/extract-signatures.cjs` is dead. It looks for a map literal
 * `KNOWN_SIGNATURES`, which no longer exists since the switch to `new Map()` plus
 * `initKnownSignatures(...)`, and aborts with "map closing not
 * found". The category files have been maintained by hand since then. Repairing
 * it would mean teaching it the category assignment again — that now lives
 * only in the files themselves; the asset knows no categories. The benefit
 * would be small: no production code reads the category files.
 *
 * The duplicate entry is the expensive case and the trigger (2026-08-14):
 * `RefreshMDXHierarchy` existed with `deprecatedInV12: true`; a second
 * entry `RefreshMdxHierarchy` WITHOUT that flag was added. `initKnownSignatures`
 * writes into a map — the last one wins, the v12 marker was silently gone,
 * and the linter would no longer have warned in V12 mode. Exactly this class of
 * error is invisible without a guard.
 */
const DIR = path.resolve(__dirname, '..', 'tiLogicVisualizer', 'signatures');
const ASSET = path.resolve(__dirname, '..', '..', 'media', 'tiSignatures.json');

type Entry = [string, Record<string, unknown>];

const asset = JSON.parse(fs.readFileSync(ASSET, 'utf8')) as { count: number; signatures: Entry[] };
const files = fs.readdirSync(DIR).filter(f => f !== '_index.json').sort();

/** key → file it appears in (first occurrence). */
function collectFromFiles(): { seen: Map<string, string>; duplicates: string[] } {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const f of files) {
    const entries = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).entries as Entry[];
    for (const e of entries) {
      const key = String(e[0]).toLowerCase();
      if (seen.has(key)) { duplicates.push(`${key} (${f} + ${seen.get(key)})`); continue; }
      seen.set(key, f);
    }
  }
  return { seen, duplicates };
}

describe('TI signatures: category files match the asset', () => {
  it('lists no function in two category files', () => {
    expect(collectFromFiles().duplicates).toEqual([]);
  });

  it('lists no function twice within the asset itself', () => {
    // A duplicate entry here is the more dangerous one: it silently decides which
    // version wins (Map.set, last one wins) — including all flags.
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const s of asset.signatures) {
      const key = String(s[0]).toLowerCase();
      if (seen.has(key)) { dup.push(key); }
      seen.add(key);
    }
    expect(dup).toEqual([]);
  });

  it('knows exactly the functions of the asset — none missing, none extra', () => {
    const inAsset = new Set(asset.signatures.map(s => String(s[0]).toLowerCase()));
    const { seen } = collectFromFiles();
    expect([...inAsset].filter(k => !seen.has(k))).toEqual([]);
    expect([...seen.keys()].filter(k => !inAsset.has(k))).toEqual([]);
  });

  it('keeps the count field of the asset at the actual number', () => {
    expect(asset.count).toBe(asset.signatures.length);
  });
});
