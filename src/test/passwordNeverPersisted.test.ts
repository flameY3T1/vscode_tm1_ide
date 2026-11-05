/**
 * A stored ODBC password must never reach a store that outlives the request:
 * no globalState entry, no exported bundle, no output channel. The encrypted
 * form TM1 hands out is not a server-bound secret — it round-trips as-is into
 * any process on any server until the instance restarts — so every persisted
 * copy is a usable database credential.
 *
 * The one sanctioned way to pass a password on is "Save as…", which sends it
 * straight to TM1 over REST (`save.ts#handleMonacoSaveAs` via
 * `dataSourceWire#carryStoredPassword`). Nothing here touches that path.
 *
 * File export (.pro / git) is covered separately in exportPasswordRedaction.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/processApi', () => ({
  getProcess: vi.fn().mockResolvedValue({
    Name: 'P_ODBC',
    DataSource: { Type: 'ODBC', password: 'RiJ2bGVzc2VjcmV0Y2lwaGVydGV4dHZhbHVlPT0xMjM0' },
    Variables: [],
  }),
  listProcesses: vi.fn(),
  deployProcess: vi.fn(),
}));
vi.mock('../tm1Client', () => ({ deployProcess: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../commands/processEditor/pickDeployTarget', () => ({ pickDeployTarget: vi.fn() }));

import { redactTemplatePassword } from '../processTemplates/templatePasswordGuard';
import { ProcessTemplateStorage } from '../processTemplates/processTemplateStorage';
import { serializeBundle } from '../processTemplates/processTemplateIo';
import { saveDraft, loadDraft } from '../commands/processEditor/draftStore';
import { deployCommand } from '../commands/processEditor/deploy';
import { getProcess } from '../tm1Rest/processApi';
import type { ProcessTemplate } from '../processTemplates/processTemplateTypes';
import type { DraftMemento } from '../utils/draftStore';

const CIPHER = 'RiJ2bGVzc2VjcmV0Y2lwaGVydGV4dHZhbHVlPT0xMjM0';

/** In-memory `globalState`. */
function fakeMemento() {
  const raw: Record<string, unknown> = {};
  return {
    raw,
    memento: {
      get: <T,>(k: string, d: T) => (raw[k] as T) ?? d,
      update: async (k: string, v: unknown) => { raw[k] = v; },
    } as DraftMemento,
  };
}

function odbcTemplate(): ProcessTemplate {
  return {
    id: 't1',
    name: 'ODBC template',
    description: '',
    createdAt: '2026-08-17T00:00:00.000Z',
    source: {
      PrologProcedure: '# prolog',
      MetadataProcedure: '',
      DataProcedure: '',
      EpilogProcedure: '',
      Parameters: [],
      Variables: [],
      DataSource: {
        Type: 'ODBC',
        dataSourceNameForServer: 'TM1PROBE',
        userName: 'dbuser',
        password: CIPHER,
        query: 'SELECT 1',
      },
    },
  };
}

describe('redactTemplatePassword', () => {
  it('strips the password from the template data source', () => {
    const out = redactTemplatePassword(odbcTemplate());
    expect(out.source.DataSource).not.toHaveProperty('password');
  });

  it('keeps the rest of the data source', () => {
    const out = redactTemplatePassword(odbcTemplate());
    expect(out.source.DataSource).toEqual({
      Type: 'ODBC',
      dataSourceNameForServer: 'TM1PROBE',
      userName: 'dbuser',
      query: 'SELECT 1',
    });
  });

  it('keeps the rest of the template', () => {
    const out = redactTemplatePassword(odbcTemplate());
    expect(out.name).toBe('ODBC template');
    expect(out.source.PrologProcedure).toBe('# prolog');
  });

  it('leaves the input untouched', () => {
    const input = odbcTemplate();
    redactTemplatePassword(input);
    expect(input.source.DataSource.password).toBe(CIPHER);
  });

  it('tolerates a template without a data source', () => {
    const bare = { id: 'x', name: 'n', description: '', createdAt: '', source: undefined } as unknown as ProcessTemplate;
    expect(() => redactTemplatePassword(bare)).not.toThrow();
  });
});

describe('ProcessTemplateStorage', () => {
  it('stores no password when a template is saved', async () => {
    const { raw, memento } = fakeMemento();
    const storage = new ProcessTemplateStorage({ globalState: memento } as never);

    await storage.save(odbcTemplate());

    expect(JSON.stringify(raw)).not.toContain(CIPHER);
  });

  it('hands out no password from a legacy entry that still holds one', () => {
    const { raw, memento } = fakeMemento();
    raw['tm1.processTemplates'] = [odbcTemplate()];
    const storage = new ProcessTemplateStorage({ globalState: memento } as never);

    expect(JSON.stringify(storage.getAll())).not.toContain(CIPHER);
  });

  it('exports no password in a bundle built from a legacy entry', () => {
    const { raw, memento } = fakeMemento();
    raw['tm1.processTemplates'] = [odbcTemplate()];
    const storage = new ProcessTemplateStorage({ globalState: memento } as never);

    expect(serializeBundle(storage.getAll())).not.toContain(CIPHER);
  });
});

describe('process editor drafts', () => {
  const KEY = 'http://srv|P_ODBC';
  const draft = {
    sections: { prolog: 'sTest = 1;', metadata: '', data: '', epilog: '' },
    parameters: [],
    dataSource: { Type: 'ODBC', userName: 'dbuser', password: 'typed-plaintext' },
    variables: [],
  };

  it('parks no password in globalState', async () => {
    const { raw, memento } = fakeMemento();

    await saveDraft(memento, KEY, draft, 1_700_000_000_000);

    expect(JSON.stringify(raw)).not.toContain('typed-plaintext');
  });

  it('still restores everything else about the draft', async () => {
    const { memento } = fakeMemento();

    await saveDraft(memento, KEY, draft, 1_700_000_000_000);

    const back = loadDraft(memento, KEY);
    expect(back?.sections.prolog).toBe('sTest = 1;');
    expect(back?.dataSource).toEqual({ Type: 'ODBC', userName: 'dbuser' });
  });

  it('leaves the draft object of the caller untouched', async () => {
    const { memento } = fakeMemento();
    const mine = structuredClone(draft);

    await saveDraft(memento, KEY, mine, 1_700_000_000_000);

    expect((mine.dataSource as Record<string, unknown>).password).toBe('typed-plaintext');
  });
});

describe('deployCommand', () => {
  const CFG = {
    serverUrl: 'http://tm1:8001',
    username: 'admin',
    password: 'p',
    rejectUnauthorized: false,
    authType: 'Basic' as const,
  };

  beforeEach(() => {
    (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
      document: {
        fileName: '/tmp/P_ODBC.ti',
        getText: () => "sText = 'x';",
      },
    };
    // The output channel is module-cached on first use, so clearing
    // createOutputChannel would drop the only handle to its appendLine spy.
    (getProcess as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('does not read the process back from the server just to log it', async () => {
    await deployCommand(CFG as never);
    expect(getProcess).not.toHaveBeenCalled();
  });

  it('logs no password to the output channel', async () => {
    await deployCommand(CFG as never);

    const channels = (vscode.window.createOutputChannel as unknown as ReturnType<typeof vi.fn>).mock.results;
    const logged = channels
      .flatMap(r => (r.value.appendLine as ReturnType<typeof vi.fn>).mock.calls)
      .map(c => String(c[0]))
      .join('\n');
    expect(logged).not.toContain(CIPHER);
  });
});
