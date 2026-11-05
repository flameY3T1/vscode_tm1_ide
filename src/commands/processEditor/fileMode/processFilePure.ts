// Text side of the process file editor: the `.ti` file of the git export
// (TM1's native `#region Prolog` … `#endregion` blob, see git/sectionMarkers.ts)
// to and from the four editor sections.
import { joinSections, splitSections, type TiSections } from '../../../git/sectionMarkers';
import { serializeProcess, type TM1Process } from '../../../git/serializer';

/** LF-normalized sections, or `undefined` when the markers are damaged (see `splitSections`). */
export function sectionsFromTi(tiText: string, v12 = false): TiSections | undefined {
  return splitSections(tiText, v12);
}

/** The `.ti` text for these sections in the document's own line ending. */
export function tiFromSections(sections: TiSections, eol: '\n' | '\r\n', v12 = false): string {
  const lf = joinSections(sections, v12);
  return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}

/** True when the `.ti` + `.json` on disk hold exactly what the export would write for `server`. */
export function fileMatchesServer(tiText: string, jsonText: string, server: TM1Process): boolean {
  const lf = (s: string) => s.replace(/\r\n/g, '\n');
  const { tiText: ti, headerJson } = serializeProcess(server);
  return lf(tiText) === lf(ti) && lf(jsonText) === headerJson;
}
