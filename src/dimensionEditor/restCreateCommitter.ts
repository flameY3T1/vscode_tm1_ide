import type { DimDraftState } from './model';
import type { DimensionApi } from '../tm1Rest/dimensionApi';
import { buildElements, buildEdges, collectAttrValues } from './hierarchyPayload';
import { errMsg } from '../utils/errMsg';

export interface CommitResult {
  ok: boolean;
  errors: Array<{ message: string }>;
  serverMayHaveChanged: boolean;
}

export async function commitNewDimension(
  state: DimDraftState,
  dimName: string,
  hierName: string,
  api: DimensionApi,
): Promise<CommitResult> {
  const errors: Array<{ message: string }> = [];
  try {
    await api.createDimensionFull(dimName, hierName, buildElements(state), buildEdges(state));
  } catch (err) {
    return { ok: false, errors: [{ message: errMsg(err) }], serverMayHaveChanged: false };
  }
  // dim now exists → any later failure means serverMayHaveChanged
  const failedAttrs = new Set<string>();
  for (const d of state.attrDefs) {
    if (d.marked === 'deleted') continue;
    try { await api.createAttrDef(dimName, d.name, d.type, hierName); }
    catch (err) { failedAttrs.add(d.name); errors.push({ message: errMsg(err) }); }
  }
  // Skip values whose attribute def failed to create: its column is absent from
  // the attr cube, and one missing column makes the whole writeAttrValues MDX
  // 400 — which would drop EVERY value in the batch, not just the broken one.
  const values = collectAttrValues(state, hierName).filter((v) => !failedAttrs.has(v.attr));
  try {
    await api.writeAttrValues(values);
  } catch (err) { errors.push({ message: errMsg(err) }); }
  return { ok: errors.length === 0, errors, serverMayHaveChanged: true };
}
