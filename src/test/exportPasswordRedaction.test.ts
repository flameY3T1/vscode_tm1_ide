import { describe, it, expect, vi } from 'vitest';

// loadProcesses pulls the REST facade in transitively; the export path under
// test never issues a request, so a bare stub is enough to keep the import graph
// from reaching the network.
vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn(),
}));

import { redactPassword } from '../utils/dataSourceWire';
import { buildProFile } from '../commands/processEditor/loadProcesses';
import { toRestDataSource } from '../commands/processEditor/deployDataSourcePure';
import { serializeProcess } from '../git/serializer';

// A REST password ciphertext as TM1 11.8 hands it out: base64, ~44 chars.
// Live-measured to be deterministic and portable across processes and servers
// (2026-08-17, odbcPasswordCrossProcessProbe.js), which is exactly
// why it must not reach a file on disk.
const CIPHER = 'RiJ2bGVzc2VjcmV0Y2lwaGVydGV4dHZhbHVlPT0xMjM0';

describe('redactPassword', () => {
  it('drops the canonical Password key', () => {
    const out = redactPassword({ Type: 'ODBC', Password: CIPHER } as any);
    expect(out).not.toHaveProperty('Password');
  });

  it('drops the lowercase wire key TM1 actually sends', () => {
    const out = redactPassword({ Type: 'ODBC', password: CIPHER } as any);
    expect(out).not.toHaveProperty('password');
  });

  it('drops the legacy odbcPassword alias', () => {
    const out = redactPassword({ Type: 'ODBC', odbcPassword: CIPHER } as any);
    expect(out).not.toHaveProperty('odbcPassword');
  });

  it('keeps every other datasource field', () => {
    const out = redactPassword({
      Type: 'ODBC',
      Password: CIPHER,
      UserName: 'dbuser',
      Query: 'SELECT 1',
      dataSourceNameForServer: 'TM1PROBE',
    } as any);
    expect(out).toEqual({
      Type: 'ODBC',
      UserName: 'dbuser',
      Query: 'SELECT 1',
      dataSourceNameForServer: 'TM1PROBE',
    });
  });

  it('leaves the input object untouched', () => {
    const input = { Type: 'ODBC', Password: CIPHER } as any;
    redactPassword(input);
    expect(input.Password).toBe(CIPHER);
  });

  it('tolerates a missing datasource', () => {
    expect(redactPassword(undefined as any)).toBeUndefined();
  });
});

const ODBC_PROCESS = {
  Name: 'P_ODBC',
  PrologProcedure: '# prolog',
  MetadataProcedure: '',
  DataProcedure: '',
  EpilogProcedure: '',
  Parameters: [],
  Variables: [],
  DataSource: {
    Type: 'ODBC',
    dataSourceNameForServer: 'TM1PROBE',
    UserName: 'dbuser',
    Password: CIPHER,
    Query: 'SELECT 1',
  },
};

describe('buildProFile — .pro export (tm1.loadProcesses, tm1.exportSelectedProcesses)', () => {
  it('never writes the password ciphertext into the file', () => {
    expect(buildProFile(ODBC_PROCESS)).not.toContain(CIPHER);
  });

  it('emits an empty 565 password line', () => {
    const lines = buildProFile(ODBC_PROCESS).split('\r\n');
    expect(lines).toContain('565,');
  });

  it('also redacts the lowercase wire spelling', () => {
    const p = { ...ODBC_PROCESS, DataSource: { Type: 'ODBC', password: CIPHER } };
    expect(buildProFile(p)).not.toContain(CIPHER);
  });

  it('still writes the remaining ODBC fields', () => {
    const out = buildProFile(ODBC_PROCESS);
    expect(out).toContain('564,dbuser');
    expect(out).toContain('585,"TM1PROBE"');
    expect(out).toContain('SELECT 1');
  });
});

describe('serializeProcess — git export header', () => {
  const proc = {
    name: 'P_ODBC',
    prolog: '# prolog',
    metadata: '',
    data: '',
    epilog: '',
    parameters: [],
    variables: [],
    dataSource: ODBC_PROCESS.DataSource,
  } as any;

  it('never writes the password ciphertext into the header', () => {
    expect(serializeProcess(proc).headerJson).not.toContain(CIPHER);
  });

  it('carries no password key at all', () => {
    const header = JSON.parse(serializeProcess(proc).headerJson);
    expect(header.DataSource).not.toHaveProperty('Password');
    expect(header.DataSource).not.toHaveProperty('password');
  });

  it('keeps the rest of the datasource intact', () => {
    const header = JSON.parse(serializeProcess(proc).headerJson);
    expect(header.DataSource).toEqual({
      Type: 'ODBC',
      dataSourceNameForServer: 'TM1PROBE',
      UserName: 'dbuser',
      Query: 'SELECT 1',
    });
  });

  it('leaves the caller-owned process object unmodified', () => {
    serializeProcess(proc);
    expect(proc.dataSource.Password).toBe(CIPHER);
  });
});

describe('buildProFile → toRestDataSource — server and client name round trip', () => {
  const ascii = (client: string | undefined) => ({
    ...ODBC_PROCESS,
    DataSource: { Type: 'ASCII', dataSourceNameForServer: '/server/input.csv', dataSourceNameForClient: client },
  });

  it('keeps server and client in their own slots', () => {
    const ds = toRestDataSource(buildProFile(ascii('C:\\client\\input.csv')))!;
    expect(ds.dataSourceNameForServer).toBe('/server/input.csv');
    expect(ds.dataSourceNameForClient).toBe('C:\\client\\input.csv');
  });

  it('keeps an empty client name empty', () => {
    const ds = toRestDataSource(buildProFile(ascii('')))!;
    expect(ds.dataSourceNameForServer).toBe('/server/input.csv');
    expect(ds.dataSourceNameForClient).toBe('');
  });
});
