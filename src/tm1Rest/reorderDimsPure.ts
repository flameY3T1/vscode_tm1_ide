import { encodeODataKey } from '../utils/odataKey';

export interface DimCount {
  name: string;
  leafCount: number | null;
}

/**
 * Recommended TM1 storage order: smaller dimensions first.
 * - Movable dims (non-last, with a known leaf count) are sorted ascending by leafCount,
 *   stable on ties (original relative order preserved).
 * - The original-last dimension is pinned last (respects TM1's last-dim type constraint).
 * - Dims with an unknown (null) leaf count keep their original slot.
 */
export function recommendOrder(dims: DimCount[], currentOrder: string[]): string[] {
  const countOf = new Map(dims.map((d) => [d.name, d.leafCount]));
  const n = currentOrder.length;
  const lastIdx = n - 1;

  const fixedSlots = new Map<number, string>();
  const movable: Array<{ name: string; idx: number; count: number }> = [];

  currentOrder.forEach((name, i) => {
    const count = countOf.get(name);
    if (i === lastIdx || count === null || count === undefined) {
      fixedSlots.set(i, name);
    } else {
      movable.push({ name, idx: i, count });
    }
  });

  movable.sort((a, b) => a.count - b.count || a.idx - b.idx);

  const result: (string | undefined)[] = new Array(n);
  fixedSlots.forEach((name, i) => {
    result[i] = name;
  });
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (result[i] === undefined) {
      result[i] = movable[m++].name;
    }
  }
  return result as string[];
}

/**
 * Body for POST Cubes('C')/tm1.ReorderDimensions.
 * `Dimensions@odata.bind` values are RESOURCE PATHS (URI references), not OData
 * literals — names need quote-doubling AND URL-encoding (`encodeODataKey`).
 */
export function buildReorderBody(order: string[]): string {
  return JSON.stringify({
    'Dimensions@odata.bind': order.map((name) => `Dimensions('${encodeODataKey(name)}')`),
  });
}

export function classifyReorderError(
  status: number,
  message: string,
): 'versionGate' | 'typeConstraint' | 'generic' {
  if (status === 404 || status === 501) {
    return 'versionGate';
  }
  if (/re-?ordering failed/i.test(message || '')) {
    return 'typeConstraint';
  }
  return 'generic';
}
