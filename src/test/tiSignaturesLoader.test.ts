import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  INFINITY_SENTINEL,
  CURRENT_SCHEMA_VERSION,
  TiSignaturesLoadError,
  parseSignaturesJson,
  rehydrateSignature,
} from '../tiLogicVisualizer/tiSignaturesLoader';
import type { TiKnownSignature } from '../tiLogicVisualizer/tiSignatures';

describe('tiSignaturesLoader', () => {
  describe('rehydrateSignature', () => {
    it('replaces __INFINITY__ sentinel in maxParams with JS Infinity', () => {
      const sig: TiKnownSignature = {
        name: 'CellGetN',
        minParams: 3,
        maxParams: INFINITY_SENTINEL as unknown as number,
        params: [],
        returnType: 'numeric',
      };
      const rehydrated = rehydrateSignature(sig);
      expect(rehydrated.maxParams).toBe(Infinity);
    });

    it('leaves finite maxParams untouched', () => {
      const sig: TiKnownSignature = {
        name: 'Sleep',
        minParams: 1,
        maxParams: 1,
        params: [],
        returnType: 'void',
      };
      expect(rehydrateSignature(sig).maxParams).toBe(1);
    });

    it('does not mutate input object', () => {
      const sig: TiKnownSignature = {
        name: 'X',
        minParams: 0,
        maxParams: INFINITY_SENTINEL as unknown as number,
        params: [],
        returnType: 'void',
      };
      rehydrateSignature(sig);
      expect(sig.maxParams).toBe(INFINITY_SENTINEL);
    });
  });

  describe('parseSignaturesJson', () => {
    const valid = JSON.stringify({
      version: CURRENT_SCHEMA_VERSION,
      count: 1,
      signatures: [['cellgetn', {
        name: 'CellGetN',
        minParams: 3,
        maxParams: INFINITY_SENTINEL,
        params: [{ name: 'CubeName', type: 'string' }],
        returnType: 'numeric',
      }]],
    });

    it('parses valid JSON and rehydrates Infinity', () => {
      const entries = parseSignaturesJson(valid);
      expect(entries).toHaveLength(1);
      expect(entries[0][0]).toBe('cellgetn');
      expect(entries[0][1].maxParams).toBe(Infinity);
    });

    it('throws on malformed JSON', () => {
      expect(() => parseSignaturesJson('{not json')).toThrow(TiSignaturesLoadError);
    });

    it('throws on wrong root type', () => {
      expect(() => parseSignaturesJson('"string"')).toThrow(/Expected object/);
    });

    it('throws on schema version mismatch', () => {
      const bad = JSON.stringify({ version: 999, count: 0, signatures: [] });
      expect(() => parseSignaturesJson(bad)).toThrow(/Unsupported schema version/);
    });

    it('throws when signatures array missing', () => {
      const bad = JSON.stringify({ version: CURRENT_SCHEMA_VERSION, count: 0 });
      expect(() => parseSignaturesJson(bad)).toThrow(/Missing or invalid/);
    });
  });

  describe('integration with real asset', () => {
    const jsonPath = path.resolve(__dirname, '..', '..', 'media', 'tiSignatures.json');

    it('loads, parses and validates real media/tiSignatures.json', () => {
      const text = fs.readFileSync(jsonPath, 'utf8');
      const entries = parseSignaturesJson(text);
      expect(entries.length).toBeGreaterThan(400);

      const cellgetn = entries.find(([k]) => k === 'cellgetn');
      expect(cellgetn).toBeDefined();
      expect(cellgetn![1].name).toBe('CellGetN');
      expect(cellgetn![1].maxParams).toBe(Infinity);
      expect(cellgetn![1].minParams).toBe(3);
      expect(cellgetn![1].returnType).toBe('numeric');
    });

    it('JSON count matches signatures array length', () => {
      const text = fs.readFileSync(jsonPath, 'utf8');
      const raw = JSON.parse(text) as { count: number; signatures: unknown[] };
      expect(raw.count).toBe(raw.signatures.length);
    });
  });
});
