import { apiRequest } from '../../tm1Rest/client';
import type { Tm1Config } from '../../tm1Rest/transport/types';

export type Tm1Mode = 'v11' | 'v12';

export async function detectMode(cfg: Tm1Config): Promise<Tm1Mode> {
  try {
    const res = await apiRequest('GET', 'Configuration?$select=ProductVersion', undefined, undefined, cfg);
    if (res.statusCode !== 200) return 'v11';
    const parsed = JSON.parse(res.body) as { ProductVersion?: string };
    return (parsed.ProductVersion ?? '').startsWith('12.') ? 'v12' : 'v11';
  } catch {
    return 'v11';
  }
}
