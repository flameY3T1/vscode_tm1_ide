import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Uri, languages, workspace, type MockDiagnosticCollection } from './__mocks__/vscode';
import { TiDiagnosticsProvider } from '../providers/tiDiagnosticsProvider';
import { tiFileSectionsWithOffsets } from '../providers/tiDiagnosticsProviderPure';

// A git-export `.ti` keeps parameters and data source variables in the `.json`
// next to it. The file lint read them only from `.pro` header lines, so every
// parameter showed up as an undefined variable, and the whole file was linted
// as one Prolog.

const TI = [
  '#region Prolog',
  "nX = pCount + 1;",
  'nZ = zMissing;',
  '#endregion',
  '#region Data',
  "sY = vName | '';",
  '#endregion',
].join('\r\n');

const HEADER = JSON.stringify({
  Name: 'p',
  Parameters: [{ Name: 'pCount', Prompt: '', Value: 0, Type: 'Numeric' }],
  Variables: [{ Name: 'vName', Type: 'String', Position: 1 }],
});

let dir: string | undefined;
afterEach(() => { if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; } });

function lint(withHeader: boolean, scheme = 'file'): string[] {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-header-'));
  const tiPath = path.join(dir, 'p.ti');
  fs.writeFileSync(tiPath, TI);
  if (withHeader) { fs.writeFileSync(path.join(dir, 'p.json'), HEADER); }
  new TiDiagnosticsProvider();
  const calls = (languages.createDiagnosticCollection as unknown as { mock: { results: Array<{ value: MockDiagnosticCollection }> } }).mock.results;
  const collection = calls[calls.length - 1].value;
  const uri = Object.assign(Uri.file(tiPath), { scheme });
  workspace._fireOpen({ fileName: tiPath, languageId: 'ti', getText: () => TI, uri });
  return (collection.get(uri) ?? []).map(d => `${d.range.start.line}:${d.message}`);
}

describe('git-export .ti: header from the .json', () => {
  it('knows the parameters and variables of the .json', () => {
    const undefinedVars = lint(true).filter(m => m.includes('undefined-variable'));
    expect(undefinedVars).toHaveLength(1);
    expect(undefinedVars[0]).toMatch(/^2:.*zMissing/);
  });

  // The server side of a git diff (tm1-git:) or a git history view has no
  // header next to it: flagging every parameter there is noise.
  it('stays silent on undefined variables when no header can be read', () => {
    expect(lint(false).filter(m => m.includes('undefined-variable'))).toEqual([]);
    expect(lint(true, 'tm1-git').filter(m => m.includes('undefined-variable'))).toEqual([]);
  });

  it('splits the tabs with their absolute line offsets', () => {
    expect(tiFileSectionsWithOffsets(TI)?.map(c => [c.section, c.lineOffset])).toEqual([['prolog', 1], ['data', 5]]);
  });
});
