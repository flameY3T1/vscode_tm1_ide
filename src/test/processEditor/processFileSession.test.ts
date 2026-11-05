import { describe, expect, it, vi } from 'vitest';
import { ProcessFileSession, type ProcessFileSessionDeps } from '../../commands/processEditor/fileMode/processFileSession';
import { serializeProcess, type TM1Process } from '../../git/serializer';
import { minimalReplace } from '../../webviewClient/_shared/minimalReplacePure';
import { mergeVariableColumns } from '../../utils/processVariablesUi';
import { cleanDataSource, normalizeReadDataSource } from '../../utils/dataSourceWire';

const PROC: TM1Process = {
  name: 'p', prolog: 'a = 1;', metadata: '', data: '', epilog: '',
  parameters: [], variables: [], dataSource: { Type: 'None' } as TM1Process['dataSource'], hasSecurity: false,
};

function make(pushAllowed = true) {
  const { tiText, headerJson } = serializeProcess(PROC);
  const deps = {
    post: vi.fn(), applyEdits: vi.fn(async () => {}), warn: vi.fn(),
    scheduleAutosave: vi.fn(), push: vi.fn(async () => {}), saveFiles: vi.fn(async () => true),
    readFiles: vi.fn(async () => ({ ti: '', json: '' })),
  } satisfies ProcessFileSessionDeps;
  const session = new ProcessFileSession(PROC, tiText, headerJson, '\r\n', pushAllowed, deps);
  return { session, deps, tiText, headerJson };
}

const sync = (prolog: string, extra: Record<string, unknown> = {}) => ({
  type: 'fileSync' as const,
  sections: { prolog, metadata: '', data: '', epilog: '' },
  parameters: [], variables: [], dataSource: { Type: 'None' }, hasSecurity: false, seenExternal: 0,
  ...extra,
});

/** Header text the session wrote, from the last applyEdits call. */
function lastHeader(deps: { applyEdits: { mock: { calls: unknown[][] } } }, oldJson: string): Record<string, unknown> {
  const calls = deps.applyEdits.mock.calls;
  const json = calls[calls.length - 1][1] as string | undefined;
  return JSON.parse(json ?? oldJson);
}

// A pulled 11.8 header: DataSource in the server's read form, VariablesUIData empty.
const PULLED: TM1Process = {
  ...PROC,
  dataSource: { Type: 'TM1CubeView', dataSourceNameForClient: 'Sales', dataSourceNameForServer: 'Sales', view: 'All' } as TM1Process['dataSource'],
  variables: [{ Name: 'vA', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }] as TM1Process['variables'],
  variablesUiData: [],
  uiData: '',
};

describe('ProcessFileSession', () => {
  describe('header fields the form shows in its own shape', () => {
    function makePulled() {
      const { tiText, headerJson } = serializeProcess(PULLED);
      const deps = {
        post: vi.fn(), applyEdits: vi.fn(async () => {}), warn: vi.fn(),
        scheduleAutosave: vi.fn(), push: vi.fn(async () => {}), saveFiles: vi.fn(async () => true),
    readFiles: vi.fn(async () => ({ ti: '', json: '' })),
      } satisfies ProcessFileSessionDeps;
      return { session: new ProcessFileSession(PULLED, tiText, headerJson, '\r\n', true, deps), deps, headerJson };
    }
    // What the webview sends back for an untouched form (see dataSource.ts / variables.ts).
    const formOf = (p: TM1Process) => ({
      variables: mergeVariableColumns(p.variables, p.variablesUiData),
      dataSource: cleanDataSource(normalizeReadDataSource(p.dataSource)),
    });

    it('a code edit leaves the header exactly as pulled', async () => {
      const { session, deps, headerJson } = makePulled();
      await session.onFileSync(sync('a = 2;', formOf(PULLED)) as never);
      expect(JSON.stringify(lastHeader(deps, headerJson), null, 2) + '\n').toBe(headerJson);
    });

    it('a changed data source or column is written', async () => {
      const { session, deps, headerJson } = makePulled();
      const form = formOf(PULLED);
      await session.onFileSync(sync('a = 1;', {
        dataSource: { ...form.dataSource, view: 'Other' },
        variables: [{ ...form.variables[0], Name: 'vB' }],
      }) as never);
      const h = lastHeader(deps, headerJson) as { DataSource: { view: string }; Variables: { Name: string }[] };
      expect(h.DataSource.view).toBe('Other');
      expect(h.Variables[0].Name).toBe('vB');
    });
  });

  it('writes a webview edit as the minimal replace and schedules autosave', async () => {
    const { session, deps, tiText } = make();
    await session.onFileSync(sync('a = 2;') as never);
    const next = serializeProcess({ ...PROC, prolog: 'a = 2;' }).tiText;
    expect(deps.applyEdits).toHaveBeenCalledWith(minimalReplace(tiText, next), undefined);
    expect(deps.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('does not echo its own write back to the webview', async () => {
    const { session, deps } = make();
    await session.onFileSync(sync('a = 2;') as never);
    session.onTiChanged(serializeProcess({ ...PROC, prolog: 'a = 2;' }).tiText);
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('posts a foreign change as monacoApplyExternal', () => {
    const { session, deps } = make();
    session.onTiChanged(serializeProcess({ ...PROC, prolog: 'b = 3;\n' }).tiText);
    expect(deps.post).toHaveBeenCalledWith({
      type: 'monacoApplyExternal', sections: { prolog: 'b = 3;\n', metadata: '', data: '', epilog: '' }, seq: 1,
    });
  });

  it('refuses a file with damaged markers, warns once, recovers when fixed', () => {
    const { session, deps, tiText } = make();
    const broken = tiText.replace('\r\n#endregion', '');
    session.onTiChanged(broken);
    session.onTiChanged(broken + '\n');
    expect(deps.post).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledTimes(1);
    session.onTiChanged(serializeProcess({ ...PROC, prolog: 'c;' }).tiText);
    expect(deps.post).toHaveBeenCalledOnce();
  });

  it('sends header changes as parameters/variables/data source', () => {
    const { session, deps } = make();
    const { headerJson } = serializeProcess({ ...PROC, parameters: [{ Name: 'pX', Prompt: '', Value: '', Type: 'String' }] as never });
    session.onJsonChanged(headerJson);
    expect(deps.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'monacoSetParameters', parameters: [expect.objectContaining({ Name: 'pX' })] }));
  });

  it('warns on a broken header and posts nothing', () => {
    const { session, deps } = make();
    session.onJsonChanged('{ not json');
    expect(deps.warn).toHaveBeenCalledWith('damagedHeader');
    expect(deps.post).not.toHaveBeenCalled();
  });

  it('never pushes an unbound file', async () => {
    const { session, deps } = make(false);
    await session.onSave();
    expect(deps.push).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith('unboundPush');
  });

  it('refuses Execute/Debug/Save As on an unbound file, saves the files first on a bound one', async () => {
    const unbound = make(false);
    expect(await unbound.session.beforeServerWrite()).toBe(false);
    expect(unbound.deps.warn).toHaveBeenCalledWith('unboundPush');
    const bound = make(true);
    expect(await bound.session.beforeServerWrite()).toBe(true);
    expect(bound.deps.saveFiles).toHaveBeenCalledOnce();
  });

  it('writes the security flag from the webview into the header', async () => {
    const { session, deps, headerJson } = make();
    await session.onFileSync(sync('a = 1;', { hasSecurity: true }) as never);
    expect(lastHeader(deps, headerJson).HasSecurityAccess).toBe(true);
  });

  it('does not invent "Parameters": [] when the header had none', async () => {
    const proc = { ...PROC, parameters: undefined };
    const { tiText, headerJson } = serializeProcess(proc);
    const deps = { post: vi.fn(), applyEdits: vi.fn(async () => {}), warn: vi.fn(), scheduleAutosave: vi.fn(), push: vi.fn(async () => {}), saveFiles: vi.fn(async () => true), readFiles: vi.fn(async () => ({ ti: '', json: '' })) };
    const session = new ProcessFileSession(proc, tiText, headerJson, '\n', true, deps);
    await session.onFileSync(sync('a = 2;') as never);
    expect('Parameters' in lastHeader(deps, headerJson)).toBe(false);
  });

  it('splits ignored columns into VariablesUIData like the server save does', async () => {
    const { session, deps, headerJson } = make();
    await session.onFileSync(sync('a = 1;', { variables: [
      { Name: 'vA', Type: 'String', Position: 1 },
      { Name: 'vB', Type: 'String', Position: 2, Ignored: true },
    ] }) as never);
    const h = lastHeader(deps, headerJson) as { Variables: { Name: string }[]; VariablesUIData: string[] };
    expect(h.Variables.map(v => v.Name)).toEqual(['vA']);
    expect(h.VariablesUIData).toHaveLength(2);
  });

  it('drops a fileSync built before the last external change instead of reverting it', async () => {
    const { session, deps } = make();
    session.onTiChanged(serializeProcess({ ...PROC, prolog: 'ext;' }).tiText);
    await session.onFileSync(sync('stale;', { seenExternal: 0 }) as never);
    expect(deps.applyEdits).not.toHaveBeenCalled();
    await session.onFileSync(sync('ext; mine;', { seenExternal: 1 }) as never);
    expect(deps.applyEdits).toHaveBeenCalledOnce();
  });

  it('runs overlapping fileSyncs one after the other', async () => {
    const { session, deps } = make();
    let release!: () => void;
    deps.applyEdits.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    const first = session.onFileSync(sync('a = 2;') as never);
    const second = session.onFileSync(sync('a = 23;') as never);
    await new Promise(r => setTimeout(r, 0));
    expect(deps.applyEdits).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(deps.applyEdits).toHaveBeenCalledTimes(2);
  });

  it('Save waits for a running fileSync and pushes only after it landed', async () => {
    const { session, deps } = make();
    let release!: () => void;
    deps.applyEdits.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
    void session.onFileSync(sync('new;') as never);
    const saved = session.onSave();
    await new Promise(r => setTimeout(r, 0));
    expect(deps.push).not.toHaveBeenCalled();
    release();
    await saved;
    expect(deps.push).toHaveBeenCalledOnce();
  });

  it('a failed write warns, blocks the push, re-reads the files and keeps the queue usable', async () => {
    const { session, deps, tiText, headerJson } = make();
    deps.applyEdits.mockRejectedValueOnce(new Error('io'));
    deps.readFiles.mockResolvedValueOnce({ ti: tiText, json: headerJson });
    await session.onFileSync(sync('a = 2;') as never);
    expect(deps.warn).toHaveBeenCalledWith('syncFailed');
    await session.onSave();
    expect(deps.push).not.toHaveBeenCalled();
    await session.onFileSync(sync('a = 2;') as never);
    const next = serializeProcess({ ...PROC, prolog: 'a = 2;' }).tiText;
    expect(deps.applyEdits).toHaveBeenLastCalledWith(minimalReplace(tiText, next), undefined);
    await session.onSave();
    expect(deps.push).toHaveBeenCalledOnce();
  });

  it('never overwrites a damaged file on disk until it parses again', async () => {
    const { session, deps, tiText } = make();
    session.onTiChanged('#region Prolog\r\nexternal_unfinished;\r\n');
    await session.onFileSync(sync('a = 2;') as never);
    expect(deps.applyEdits).not.toHaveBeenCalled();
    await session.onSave();
    expect(deps.push).not.toHaveBeenCalled();
    session.onTiChanged(tiText.replace('a = 1;', 'ext;'));
    await session.onFileSync(sync('ext; mine;', { seenExternal: 1 }) as never);
    expect(deps.applyEdits).toHaveBeenCalledOnce();
  });

  it('never overwrites a header that does not parse', async () => {
    const { session, deps } = make();
    session.onJsonChanged('{ external_unfinished');
    await session.onFileSync(sync('a = 2;') as never);
    expect(deps.applyEdits).not.toHaveBeenCalled();
  });
});
