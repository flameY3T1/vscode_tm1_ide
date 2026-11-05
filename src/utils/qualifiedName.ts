// src/utils/qualifiedName.ts
// Split qualified reference names of the reference index (`Cube:View`,
// `Dim:Hier:Subset`). Lives here and not next to the
// usage view, because the bulk delete also has to prepare the names
// and `showUsageGraph.ts` imports `vscode`.

/** Split a qualified reference name (`Dim:Hier:Sub` or `Cube:View`) on ':'.
 *  `maxParts` bounds the result: any overflow ':' segments are re-joined into
 *  the final part, so a name whose LAST field contains a literal ':' (v12
 *  permits ':' in object names) round-trips instead of being over-split.
 *  (A ':' in a non-final field — dim/hier/cube — remains ambiguous.) */
export function splitQualifiedName(sourceName: string, maxParts?: number): string[] {
  const parts = sourceName.split(':');
  if (maxParts && maxParts > 0 && parts.length > maxParts) {
    return [...parts.slice(0, maxParts - 1), parts.slice(maxParts - 1).join(':')];
  }
  return parts;
}
