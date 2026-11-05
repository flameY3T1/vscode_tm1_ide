import { describe, expect, it } from 'vitest';
import { fileMatchesServer, sectionsFromTi, tiFromSections } from '../../commands/processEditor/fileMode/processFilePure';
import { joinSections } from '../../git/sectionMarkers';
import { serializeProcess } from '../../git/serializer';

// Tabs end in a break, as TM1 11.x stores them: then the file maps 1:1 to the sections.
const S = { prolog: 'p1\np2\n', metadata: '', data: 'd\n', epilog: 'e\n' };

describe('processFilePure', () => {
  it('round-trips LF', () => {
    const ti = tiFromSections(S, '\n');
    expect(ti).toBe(joinSections(S));
    expect(sectionsFromTi(ti)).toEqual(S);
  });
  it('reads CRLF without leaving \\r in the code and writes it back as CRLF', () => {
    const crlf = joinSections(S).replace(/\n/g, '\r\n');
    expect(sectionsFromTi(crlf)).toEqual(S);
    expect(tiFromSections(S, '\r\n')).toBe(crlf);
  });
  it('rejects a file with a missing marker instead of returning empty sections', () => {
    const broken = joinSections(S).replace('d\n#endregion', 'd');
    expect(sectionsFromTi(broken)).toBeUndefined();
  });
  it('rejects an empty file', () => {
    expect(sectionsFromTi('')).toBeUndefined();
  });
});

describe('fileMatchesServer', () => {
  const proc = {
    name: 'p', prolog: 'a;', metadata: '', data: '', epilog: '',
    parameters: [], variables: [], dataSource: { Type: 'None' } as never, hasSecurity: false,
  };
  it('is true for the files the export writes, whatever the line ending', () => {
    const { tiText, headerJson } = serializeProcess(proc);
    expect(fileMatchesServer(tiText, headerJson, proc)).toBe(true);
    expect(fileMatchesServer(tiText.replace(/\r\n/g, '\n'), headerJson.replace(/\n/g, '\r\n'), proc)).toBe(true);
  });
  it('is false when code or header differ', () => {
    const { tiText, headerJson } = serializeProcess(proc);
    expect(fileMatchesServer(tiText, headerJson, { ...proc, prolog: 'b;' })).toBe(false);
    expect(fileMatchesServer(tiText, headerJson, { ...proc, hasSecurity: true })).toBe(false);
  });
});
