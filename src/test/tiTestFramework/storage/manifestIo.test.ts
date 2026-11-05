import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readManifest,
  writeManifest,
  ManifestValidationError,
  type LegacyManifestV1,
  type Manifest,
  type RootManifestV2,
  type SubManifest,
  MANIFEST_FILENAME,
} from '../../../tiTestFramework/storage/manifestIo';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

const baseManifest = (): LegacyManifestV1 => ({
  schemaVersion: 1,
  name: 'copyActuals_jan',
  process: 'copyActuals',
  active: true,
  captured: {
    at: '2026-05-09T10:30:00Z',
    server: 'prod',
    extensionVersion: '1.23.0',
    tm1Version: '11.8.0',
  },
  datasourceType: 'View',
  writeTargets: { cubes: ['Plan'], dimensions: ['Region'] },
  notes: 'baseline',
});

describe('writeManifest + readManifest round-trip', () => {
  it('round-trips full manifest', async () => {
    const m = baseManifest();
    await writeManifest(tmp, m);
    const r = await readManifest(tmp);
    expect(r).toEqual(m);
  });

  it('writes deterministic JSON (sorted keys)', async () => {
    const m = baseManifest();
    await writeManifest(tmp, m);
    const raw = await fs.readFile(path.join(tmp, MANIFEST_FILENAME), 'utf8');
    expect(raw.indexOf('"active"')).toBeLessThan(raw.indexOf('"captured"'));
    expect(raw.indexOf('"captured"')).toBeLessThan(raw.indexOf('"datasourceType"'));
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('sorts writeTargets arrays on read', async () => {
    const m = baseManifest();
    m.writeTargets = { cubes: ['Z', 'A', 'M'], dimensions: ['Z', 'A'] };
    await writeManifest(tmp, m);
    const r = (await readManifest(tmp)) as LegacyManifestV1;
    expect(r.writeTargets.cubes).toEqual(['A', 'M', 'Z']);
    expect(r.writeTargets.dimensions).toEqual(['A', 'Z']);
  });

  it('omits optional notes when undefined', async () => {
    const m = baseManifest();
    delete m.notes;
    await writeManifest(tmp, m);
    const raw = await fs.readFile(path.join(tmp, MANIFEST_FILENAME), 'utf8');
    expect(raw).not.toContain('"notes"');
  });

  it('creates folder if missing', async () => {
    const sub = path.join(tmp, 'nested', 'deep');
    await writeManifest(sub, baseManifest());
    expect(await readManifest(sub)).toEqual(baseManifest());
  });
});

describe('manifest validation', () => {
  it('rejects unsupported schemaVersion', async () => {
    await fs.writeFile(
      path.join(tmp, MANIFEST_FILENAME),
      JSON.stringify({ ...baseManifest(), schemaVersion: 2 }),
    );
    await expect(readManifest(tmp)).rejects.toThrow(ManifestValidationError);
    await expect(readManifest(tmp)).rejects.toThrow(/schemaVersion/);
  });

  it('rejects empty name', async () => {
    await fs.writeFile(
      path.join(tmp, MANIFEST_FILENAME),
      JSON.stringify({ ...baseManifest(), name: '' }),
    );
    await expect(readManifest(tmp)).rejects.toThrow(/name/);
  });

  it('rejects invalid datasourceType', async () => {
    await fs.writeFile(
      path.join(tmp, MANIFEST_FILENAME),
      JSON.stringify({ ...baseManifest(), datasourceType: 'ODBC' }),
    );
    await expect(readManifest(tmp)).rejects.toThrow(/datasourceType/);
  });

  it('rejects writeTargets with non-string entries', async () => {
    await fs.writeFile(
      path.join(tmp, MANIFEST_FILENAME),
      JSON.stringify({
        ...baseManifest(),
        writeTargets: { cubes: ['A', 42], dimensions: [] },
      }),
    );
    await expect(readManifest(tmp)).rejects.toThrow(/writeTargets/);
  });

  it('rejects malformed JSON', async () => {
    await fs.writeFile(path.join(tmp, MANIFEST_FILENAME), '{ not json');
    await expect(readManifest(tmp)).rejects.toThrow(ManifestValidationError);
  });

  it('rejects active being non-boolean', async () => {
    await fs.writeFile(
      path.join(tmp, MANIFEST_FILENAME),
      JSON.stringify({ ...baseManifest(), active: 'true' }),
    );
    await expect(readManifest(tmp)).rejects.toThrow(/active/);
  });

  it('writeManifest also validates (catches caller-side mutations)', async () => {
    const bad = { ...baseManifest(), datasourceType: 'XXX' } as unknown as Manifest;
    await expect(writeManifest(tmp, bad)).rejects.toThrow(ManifestValidationError);
  });
});

describe('Manifest v2', () => {
  it('reads a v2 root manifest with subs array', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'mfv2-'));
    try {
      await fs.writeFile(path.join(tmp2, 'manifest.json'), JSON.stringify({
        version: 2, kind: 'ti-test', name: 'Orch', process: 'Orch.Build.Attributes',
        schemaVersion: 2, active: true, datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['Attr.A', 'Attr.B'],
      }));
      const m = await readManifest(tmp2) as RootManifestV2;
      expect(m.version).toBe(2);
      expect(m.subs).toEqual(['Attr.A', 'Attr.B']);
    } finally {
      await fs.rm(tmp2, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('reads a sub-manifest (kind: ti-test-sub)', async () => {
    const tmp3 = await fs.mkdtemp(path.join(os.tmpdir(), 'mfsub-'));
    try {
      await fs.writeFile(path.join(tmp3, 'manifest.json'), JSON.stringify({
        version: 2, kind: 'ti-test-sub', name: 'Attr.A', parent: '../..',
        rootTest: 't42', clonedFrom: 'Attr.A',
        parameters: [{ name: 'p', type: 'S', value: 'Jan' }],
        callContext: { callerProcess: 'Orch', callerLine: 42, callIndex: 0 },
      }));
      const m = await readManifest(tmp3) as SubManifest;
      expect(m.kind).toBe('ti-test-sub');
      expect(m.callContext?.callerProcess).toBe('Orch');
    } finally {
      await fs.rm(tmp3, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('writes v2 root manifest without v1 validation', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'mfwrite-'));
    const m = {
      version: 2 as const,
      kind: 'ti-test' as const,
      name: 'Orch',
      process: 'Orch.Build.Attributes',
      schemaVersion: 2,
      active: true,
      datasourceType: 'None',
      writeTargets: { cubes: [], dimensions: [] },
      subs: ['Attr.A'],
    };
    await writeManifest(tmp2, m);
    const back = (await readManifest(tmp2)) as RootManifestV2;
    expect(back.version).toBe(2);
    expect(back).toMatchObject({ kind: 'ti-test', subs: ['Attr.A'] });
    await fs.rm(tmp2, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('writes v2 sub-manifest', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'mfwritesub-'));
    const m = {
      version: 2 as const,
      kind: 'ti-test-sub' as const,
      name: 'Attr.A',
      parent: '../..',
      rootTest: 't42',
      clonedFrom: 'Attr.A',
      parameters: [{ name: 'p', type: 'S' as const, value: 'Jan' }],
      callContext: { callerProcess: 'Orch', callerLine: 42, callIndex: 0 },
    };
    await writeManifest(tmp2, m);
    const back = (await readManifest(tmp2)) as SubManifest;
    expect(back.kind).toBe('ti-test-sub');
    expect(back).toMatchObject({ clonedFrom: 'Attr.A', rootTest: 't42' });
    await fs.rm(tmp2, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('rejects v2 write with invalid kind', async () => {
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'mfbad-'));
    await expect(writeManifest(tmp2, { version: 2, kind: 'wrong' } as any))
      .rejects.toThrow(/kind/);
    await fs.rm(tmp2, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
});
