import { fetchMdx, storedMdx } from './viewMdx';
import { chainFor } from './viewTrail';
import { attrColumns, realAttrCols, COL_INDEX, COL_WEIGHT } from './attrColumns';
import { vr, currentView } from './viewRun';

/**
 * This many rows are fetched per window. One more is fetched on top (see `fetchMdx`).
 *
 * MEASURED, not chosen (spec block K, large dimension, 11.8):
 * the query has ~85 ms of base cost, beyond that the curve is linear. 200 rows
 * cost 453 ms per 1000, 5000 rows only 28 ms per 1000. Above 5000 the
 * payload is what costs: the wide chain projection jumps to 8.34 MB at 10,000.
 *
 *   window 5000, chain 'name'          139 ms   2.32 MB
 *   window 5000, chain 'name+element'  163 ms   3.41 MB
 *
 * Raised to 10,000 (instruction from flameY3T1, 2026-08-24), with open eyes: the
 * payload grows superlinearly to 8.34 MB, i.e. 2.45x for 2x the rows.
 * The return is half the number of rounds to the end - with 295,000
 * members 30 instead of 59. Whoever lowers the value again does NOT lower a cap:
 * since virtualization the renderer loads on demand to any depth.
 *
 * RE-MEASURED 2026-08-25 (m7RowAttrPayloadProbe.js, 11.8,
 * large dimension, chain 'name+element', production header
 * `odata.metadata=none`, witness per series 0 bytes of drift). The 8.34 MB above
 * is NOT an upper bound, but a measurement near the start of the dimension - the
 * payload depends strongly on the POSITION, because the ancestor chain gets
 * longer there:
 *
 *   window 10,000, skip=0        14.1 MB      skip=100,000  17.0 MB
 *   window  5,000, skip=100,000   8.7 MB
 *   window  2,000, skip=100,000   3.5 MB
 *
 * (Without `odata.metadata=none` it would be 45.4 MB at the same spot - whoever
 * re-measures with their own probe has to send the header along, otherwise they
 * measure a query that does not exist in the program.)
 *
 * The biggest item is the chain itself, not the row: `chain: 'name'`
 * instead of `'name+element'` saves 35.8 % at every window size. The attributes
 * on the other hand are noise - see `dimensionElementsApi.ts#buildSetExprQuery`.
 *
 * WHY 10,000 STAYS, even after the review proposed 2,000 (memory measured
 * again on the same day, with the real `parseSetAnswer`, witness congruent).
 * Per window: wire 17.0 MB · JSON tree 29.0 MB · `AnswerRow[]`
 * 9.1 MB · postMessage 8.7 MB · 1019 ms. Short peak ~46 MB while text and
 * tree live simultaneously in `JSON.parse`; what stays behind is 9.1 MB.
 *
 * What matters is what the window size does NOT change: the final state. A
 * row costs 0.93 KB, no matter in which chunks it arrives - 295,000 rows
 * are about 274 MB in the host and another ~262 MB here in the webview, with
 * window 2,000 identical to the byte. What does change is solely the number
 * of rounds and thereby the time: 30 rounds / 29 s versus 148 rounds / 99 s,
 * because the ~600 ms base cost per query at 2,000 carries only a fifth of the
 * rows. Lowering it would be 3.4x the time for zero savings.
 */
export const WINDOW = 10_000;

export function fetchRows(append = false): void {
  if (!vr.run || !vr.poster) { return; }
  vr.run.requestId = vr.nextRequestId++;
  vr.run.appending = append;
  vr.fetching = true;
  // When appending, the offset is the number of EXISTING rows, not a
  // counted-along page index: rows and offset can never drift apart
  // if only one quantity describes both.
  const skip = append ? vr.rows.length : 0;
  vr.poster({
    type: 'fetchViewRows',
    requestId: vr.run.requestId,
    dimName: vr.run.dim,
    hierName: vr.run.hier,
    mdx: fetchMdx(currentView(), vr.run.dim, vr.run.hier, skip, WINDOW),
    alias: vr.run.alias || undefined,
    top: WINDOW,
    chain: chainFor(currentView()),
    // The columns are an ORDER to the host: it narrows the `$select`
    // to them. Hence send them along with every fetch, do not report once.
    //
    // HERE the translation of the two placeholder columns into flags happens -
    // the ONE place where the NUL name touches the wire. Further over
    // they would otherwise be on their way as `$select=Attributes/<NUL>index`.
    rowAttrs: realAttrCols(attrColumns()),
    rowIndex: attrColumns().indexOf(COL_INDEX) >= 0,
    rowWeight: attrColumns().indexOf(COL_WEIGHT) >= 0,
    // Only `TM1SUBSETALL` is re-evaluated in full per window; `.Members` windows are lazy.
    page: currentView().base.kind === 'set'
      ? { setMdx: storedMdx(currentView(), vr.run.dim, vr.run.hier), skip }
      : undefined,
  });
  // When appending, the expression stays the same - the response would be the same
  // number again for 345-1469 ms of waiting time.
  if (!append) { fetchCount(); }
}

/**
 * Re-order the total count. ONLY on a state change, never when
 * appending - the expression is then the same, and the response would be the same
 * number for 345-1469 ms of waiting time.
 */
export function fetchCount(): void {
  if (!vr.run || !vr.poster) { return; }
  vr.total = null;
  vr.countRequestId = vr.nextRequestId++;
  vr.poster({
    type: 'fetchViewCount', requestId: vr.countRequestId,
    dimName: vr.run.dim, hierName: vr.run.hier,
    mdx: storedMdx(currentView(), vr.run.dim, vr.run.hier),
  });
}
