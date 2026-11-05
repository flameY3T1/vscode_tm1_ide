import type { Tm1Config } from '../../tm1Rest/transport/types';
import { recommendOrder } from '../../tm1Rest/reorderDimsPure';

export interface ReorderInit {
  current: string[];
  counts: Record<string, number | null>;
  recommended: string[];
}

export interface ReorderApi {
  getStorageDimensionOrder(cfg: Tm1Config, cube: string): Promise<string[]>;
  getDimensionLeafCount(cfg: Tm1Config, dim: string): Promise<number | null>;
}

export async function loadReorderInit(
  cfg: Tm1Config,
  cubeName: string,
  api: ReorderApi,
): Promise<ReorderInit> {
  const current = await api.getStorageDimensionOrder(cfg, cubeName);
  const counts: Record<string, number | null> = {};
  await Promise.all(
    current.map(async (dim) => {
      counts[dim] = await api.getDimensionLeafCount(cfg, dim);
    }),
  );
  const recommended = recommendOrder(
    current.map((name) => ({ name, leafCount: counts[name] })),
    current,
  );
  return { current, counts, recommended };
}
