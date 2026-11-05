/**
 * Pure builder for TM1 rule references. No `vscode` import — unit-testable.
 *
 * DB:   one argument per dimension in storage order; a dim with a fixed
 *       element → 'Elem', a dim with none → !DimName (current-cell context).
 *       DB is single-cell, so only the first picked element per dim is used.
 * AREA: only dims with ≥1 pick appear; always qualified ('Dim':…). One pick
 *       → 'Dim':'Elem'; many → 'Dim':{'a','b',…}.
 */

import { escapeODataKey } from '../utils/odataKey';

export interface DimPick {
  /** Dimension name (storage order is the caller's array order). */
  name: string;
  /** Picked element names, in click order. */
  elements: string[];
}

export type BuilderModel =
  | { mode: 'DB'; cube: string; dims: DimPick[] }
  | { mode: 'AREA'; dims: DimPick[] };

/** Quote-escape for rule string literals: ' → ''. */
const escq = (s: string): string => escapeODataKey(s);

export function build(model: BuilderModel): string {
  if (model.mode === 'DB') {
    const args = model.dims.map((d) =>
      d.elements.length >= 1 ? `'${escq(d.elements[0])}'` : `!${d.name}`,
    );
    return `DB('${escq(model.cube)}'${args.length ? ', ' + args.join(', ') : ''})`;
  }
  const parts = model.dims
    .filter((d) => d.elements.length >= 1)
    .map((d) => {
      const dim = `'${escq(d.name)}'`;
      if (d.elements.length === 1) { return `${dim}:'${escq(d.elements[0])}'`; }
      return `${dim}:{${d.elements.map((e) => `'${escq(e)}'`).join(',')}}`;
    });
  return `[${parts.join(', ')}]`;
}
