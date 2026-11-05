/**
 * Read / write a single test-folder's `manifest.json`. Validates structure
 * against the v1 schema; rejects legacy schema versions explicitly so the
 * caller can route them through a future migration step. Serialization is
 * deterministic (sorted keys + 2-space indent) for stable git diffs.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type LegacyManifestV1 = {
  schemaVersion: 1;
  name: string;
  process: string;
  active: boolean;
  captured: {
    at: string;
    server: string;
    extensionVersion: string;
    tm1Version?: string;
  };
  datasourceType: 'View' | 'File' | 'Subset' | 'None';
  writeTargets: {
    cubes: string[];
    dimensions: string[];
  };
  notes?: string;
};

export type RootManifestV2 = {
  version: 2;
  kind: 'ti-test';
  name: string;
  process: string;
  schemaVersion: number;
  active: boolean;
  datasourceType: string;
  writeTargets: { cubes: string[]; dimensions: string[] };
  subs?: string[];
  notes?: string;
  captured?: {
    at: string;
    server: string;
    extensionVersion: string;
    tm1Version?: string;
  };
};

export type SubManifest = {
  version: 2;
  kind: 'ti-test-sub';
  name: string;
  parent: string;
  rootTest: string;
  clonedFrom: string;
  parameters: Array<{ name: string; type: 'S' | 'N'; value: string | number }>;
  callContext: { callerProcess: string; callerLine: number; callIndex: number };
  active?: boolean;
};

export type Manifest = LegacyManifestV1 | RootManifestV2 | SubManifest;

/**
 * Type guard: narrows to the root-test variants (LegacyManifestV1 | RootManifestV2).
 * Use at sites that read root-only fields: process, datasourceType, captured, etc.
 */
export function isRootManifest(m: Manifest): m is LegacyManifestV1 | RootManifestV2 {
  return !('kind' in m) || m.kind === 'ti-test';
}

export const MANIFEST_FILENAME = 'manifest.json';

const VALID_DATASOURCE_TYPES: ReadonlySet<LegacyManifestV1['datasourceType']> = new Set([
  'View',
  'File',
  'Subset',
  'None',
]);

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(`manifest.json validation: ${message}`);
    this.name = 'ManifestValidationError';
  }
}

function validateManifest(raw: unknown): LegacyManifestV1 {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError('expected object');
  }
  const r = raw as Record<string, unknown>;

  if (r.schemaVersion !== 1) {
    throw new ManifestValidationError(`unsupported schemaVersion: ${String(r.schemaVersion)}`);
  }
  if (typeof r.name !== 'string' || r.name.length === 0) {
    throw new ManifestValidationError('name must be a non-empty string');
  }
  if (typeof r.process !== 'string' || r.process.length === 0) {
    throw new ManifestValidationError('process must be a non-empty string');
  }
  if (typeof r.active !== 'boolean') {
    throw new ManifestValidationError('active must be a boolean');
  }

  const captured = r.captured as Record<string, unknown> | undefined;
  if (!captured || typeof captured !== 'object') {
    throw new ManifestValidationError('captured must be an object');
  }
  if (typeof captured.at !== 'string') {
    throw new ManifestValidationError('captured.at must be a string (ISO 8601)');
  }
  if (typeof captured.server !== 'string') {
    throw new ManifestValidationError('captured.server must be a string');
  }
  if (typeof captured.extensionVersion !== 'string') {
    throw new ManifestValidationError('captured.extensionVersion must be a string');
  }
  if (captured.tm1Version !== undefined && typeof captured.tm1Version !== 'string') {
    throw new ManifestValidationError('captured.tm1Version must be a string or omitted');
  }

  if (
    typeof r.datasourceType !== 'string' ||
    !VALID_DATASOURCE_TYPES.has(r.datasourceType as LegacyManifestV1['datasourceType'])
  ) {
    throw new ManifestValidationError(
      `datasourceType must be one of ${[...VALID_DATASOURCE_TYPES].join(', ')}`,
    );
  }

  const wt = r.writeTargets as Record<string, unknown> | undefined;
  if (!wt || typeof wt !== 'object') {
    throw new ManifestValidationError('writeTargets must be an object');
  }
  if (!Array.isArray(wt.cubes) || !wt.cubes.every((s) => typeof s === 'string')) {
    throw new ManifestValidationError('writeTargets.cubes must be string[]');
  }
  if (!Array.isArray(wt.dimensions) || !wt.dimensions.every((s) => typeof s === 'string')) {
    throw new ManifestValidationError('writeTargets.dimensions must be string[]');
  }

  if (r.notes !== undefined && typeof r.notes !== 'string') {
    throw new ManifestValidationError('notes must be a string or omitted');
  }

  return {
    schemaVersion: 1,
    name: r.name,
    process: r.process,
    active: r.active,
    captured: {
      at: captured.at,
      server: captured.server,
      extensionVersion: captured.extensionVersion,
      tm1Version: captured.tm1Version,
    },
    datasourceType: r.datasourceType as LegacyManifestV1['datasourceType'],
    writeTargets: {
      cubes: [...(wt.cubes as string[])].sort(),
      dimensions: [...(wt.dimensions as string[])].sort(),
    },
    notes: r.notes,
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

export async function readManifest(testFolder: string): Promise<Manifest> {
  const filePath = path.join(testFolder, MANIFEST_FILENAME);
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ManifestValidationError(`malformed JSON: ${(e as Error).message}`);
  }
  const p = parsed as Record<string, unknown>;
  if (p.version === 2) {
    // v2 manifest — return as-is with type assertion
    return parsed as unknown as Manifest;
  }
  return validateManifest(parsed);
}

export async function writeManifest(testFolder: string, manifest: Manifest): Promise<void> {
  await fs.mkdir(testFolder, { recursive: true });
  if ('version' in manifest && manifest.version === 2) {
    // Minimal v2 shape check: kind discriminator must be present.
    if (manifest.kind !== 'ti-test' && manifest.kind !== 'ti-test-sub') {
      throw new Error(`Invalid v2 manifest: kind must be 'ti-test' or 'ti-test-sub', got '${(manifest as { kind?: string }).kind}'`);
    }
    const json = JSON.stringify(sortKeys(manifest), null, 2);
    await fs.writeFile(path.join(testFolder, MANIFEST_FILENAME), json + '\n', 'utf8');
    return;
  }
  const validated = validateManifest(manifest);
  const json = JSON.stringify(sortKeys(validated), null, 2);
  await fs.writeFile(path.join(testFolder, MANIFEST_FILENAME), json + '\n', 'utf8');
}
