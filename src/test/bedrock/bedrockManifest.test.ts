import { describe, it, expect } from 'vitest';
import JSZip = require('jszip');
import { loadBedrockManifest, loadBedrockManifestJson, loadBedrockManifestFor } from '../../bedrock/bedrockManifest';

// Small synthetic .pro fixture matching the real Bedrock header format
// (codes verified in Task 11: 560=names, 561=types, 562=dstype, 572=prolog, etc.)
const FIXTURE_PRO = [
  '602,"}bedrock.example"',
  '560,1',
  'pCube',
  '561,1',
  '2',
  '562,"NULL"',
  '572,1',
  'SetOutputSuppressed(1);',
  '573,0',
  '574,0',
  '575,0',
].join('\n');

describe('loadBedrockManifest', () => {
  it('extracts .pro entries from a zip', async () => {
    const zip = new JSZip();
    zip.file('bedrock-master/main/}bedrock.example.pro', FIXTURE_PRO);
    zip.file('bedrock-master/README.md', '# Bedrock');
    const buf = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const manifest = await loadBedrockManifest(buf);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].name).toBe('}bedrock.example');
    expect(manifest[0].payload.PrologProcedure).toBe('SetOutputSuppressed(1);');
    expect(manifest[0].payload.DataSource).toEqual({ Type: 'None' });
  });

  it('returns empty for zip without .pro files', async () => {
    const zip = new JSZip();
    zip.file('readme.md', 'x');
    const buf = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    expect(await loadBedrockManifest(buf)).toEqual([]);
  });

  it('skips entries missing 602 name line', async () => {
    const zip = new JSZip();
    zip.file('bedrock-master/processes/unnamed.pro', '572,0\n573,0\n574,0\n575,0\n');
    const buf = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    expect(await loadBedrockManifest(buf)).toEqual([]);
  });

  it('sorts entries alphabetically by name', async () => {
    const zip = new JSZip();
    const makeSimple = (name: string) => `602,"${name}"\n572,0\n573,0\n574,0\n575,0\n`;
    zip.file('a/}bedrock.zzz.pro', makeSimple('}bedrock.zzz'));
    zip.file('a/}bedrock.aaa.pro', makeSimple('}bedrock.aaa'));
    const buf = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const manifest = await loadBedrockManifest(buf);
    expect(manifest.map(m => m.name)).toEqual(['}bedrock.aaa', '}bedrock.zzz']);
  });

  it('skips the b3shell variant (PascalCase Bedrock.*), installs only }bedrock.*', async () => {
    const zip = new JSZip();
    const makeSimple = (name: string) => `602,"${name}"\n572,0\n573,0\n574,0\n575,0\n`;
    zip.file('bedrock-master/main/}bedrock.cube.create.pro', makeSimple('}bedrock.cube.create'));
    zip.file('bedrock-master/b3shell/Bedrock.Cube.Create.pro', makeSimple('Bedrock.Cube.Create'));
    const buf = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const manifest = await loadBedrockManifest(buf);
    expect(manifest.map(m => m.name)).toEqual(['}bedrock.cube.create']);
  });
});

// ── Bedrock 5 (TM1 Database 12) ────────────────────────────────────────────
// Unlike v4, v5 ships no `.pro` files but one JSON file per process,
// which already is the finished REST payload. The structure below was
// verified against v5.4.0 (97 process files under `bedrock_processes_json/`).
const FIXTURE_JSON = {
  Name: '}bedrock.cube.data.save',
  PrologProcedure: 'SetOutputSuppressed(1);',
  MetadataProcedure: '',
  DataProcedure: '',
  EpilogProcedure: '',
  HasSecurityAccess: true,
  UIData: '',
  DataSource: { Type: 'None' },
  Parameters: [{ Name: 'pCube', Prompt: 'REQUIRED: Cube name', Value: '', Type: 'String' }],
  Variables: [],
  VariablesUIData: [],
};

describe('loadBedrockManifestJson', () => {
  const zipOf = async (files: Record<string, string>) => {
    const zip = new JSZip();
    for (const [p, c] of Object.entries(files)) { zip.file(p, c); }
    return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
  };

  it('reads the JSON payload and splits Name off the body', async () => {
    // TM1 reads `Name` in the body of a PATCH as a rename and silently discards the
    // rest — the name therefore belongs next to the payload, not inside it.
    const buf = await zipOf({
      'cubewise-code-bedrock-5-abc/bedrock_processes_json/}bedrock.cube.data.save.json': JSON.stringify(FIXTURE_JSON),
      'cubewise-code-bedrock-5-abc/README.md': '# Bedrock 5',
    });
    const manifest = await loadBedrockManifestJson(buf);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].name).toBe('}bedrock.cube.data.save');
    expect(manifest[0].payload.Name).toBeUndefined();
    expect(manifest[0].payload.PrologProcedure).toBe('SetOutputSuppressed(1);');
    expect(manifest[0].payload.Parameters).toHaveLength(1);
  });

  it('drops foreign JSON without a }bedrock. name', async () => {
    // v5.4.0 ships two such files under `installation_files/assets/`.
    const buf = await zipOf({
      'x/installation_files/assets/bedrock.json': JSON.stringify({ data: [1, 2, 3] }),
      'x/installation_files/assets/bedrock-v11.json': JSON.stringify({ data: [] }),
      'x/bedrock_processes_json/}bedrock.cube.data.save.json': JSON.stringify(FIXTURE_JSON),
    });
    expect((await loadBedrockManifestJson(buf)).map(e => e.name)).toEqual(['}bedrock.cube.data.save']);
  });

  it('skips the processes whose datasource points at the authors\u2019 machine', async () => {
    // The same outliers as in v4, recounted live in v5.4.0: four ASCII
    // sources with paths like `D:/TM1Models/Bedrock.v4/Data/Attribute.csv` and
    // one cube view source on `}ElementAttributes_}Clients`.
    const buf = await zipOf({
      'x/bedrock_processes_json/a.json': JSON.stringify({
        ...FIXTURE_JSON, Name: '}bedrock.dim.attr.importfromfile',
        DataSource: { Type: 'ASCII', dataSourceNameForServer: 'D:/TM1Models/Bedrock.v4/Data/Attribute.csv' },
      }),
      'x/bedrock_processes_json/b.json': JSON.stringify({
        ...FIXTURE_JSON, Name: '}bedrock.hier.create.fromattribute',
        DataSource: { Type: 'TM1CubeView', dataSourceNameForServer: '}ElementAttributes_}Clients' },
      }),
      'x/bedrock_processes_json/c.json': JSON.stringify({
        ...FIXTURE_JSON, Name: '}bedrock.cube.data.copy',
        DataSource: { Type: 'TM1CubeView', dataSourceNameForServer: 'zzSYS 50 Dim Cube' },
      }),
    });
    expect((await loadBedrockManifestJson(buf)).map(e => e.name)).toEqual(['}bedrock.cube.data.copy']);
  });

  it('survives a broken JSON file instead of failing the whole install', async () => {
    const buf = await zipOf({
      'x/bedrock_processes_json/broken.json': '{ not json',
      'x/bedrock_processes_json/ok.json': JSON.stringify(FIXTURE_JSON),
    });
    expect(await loadBedrockManifestJson(buf)).toHaveLength(1);
  });
});

describe('loadBedrockManifestFor', () => {
  it('routes each edition to its own package format', async () => {
    const zip4 = new JSZip();
    zip4.file('bedrock-master/main/}bedrock.example.pro', FIXTURE_PRO);
    const buf4 = Buffer.from(await zip4.generateAsync({ type: 'uint8array' }));

    const zip5 = new JSZip();
    zip5.file('bedrock-5/bedrock_processes_json/}bedrock.cube.data.save.json', JSON.stringify(FIXTURE_JSON));
    const buf5 = Buffer.from(await zip5.generateAsync({ type: 'uint8array' }));

    expect((await loadBedrockManifestFor('v4', buf4)).map(e => e.name)).toEqual(['}bedrock.example']);
    expect((await loadBedrockManifestFor('v5', buf5)).map(e => e.name)).toEqual(['}bedrock.cube.data.save']);
    // And crosswise nothing comes out — exactly that was the bug: the
    // v5 zip through the .pro reader yielded zero entries.
    expect(await loadBedrockManifestFor('v4', buf5)).toEqual([]);
    expect(await loadBedrockManifestFor('v5', buf4)).toEqual([]);
  });
});
