import type { Tm1Config } from '../tm1Rest/transport/types';

export interface BedrockDetection {
  installed: boolean;
  count: number;
}

export type ProcessLister = (cfg: Tm1Config) => Promise<Array<{ Name: string }>>;

export async function detectBedrock(
  cfg: Tm1Config,
  listProcesses: ProcessLister,
): Promise<BedrockDetection> {
  const all = await listProcesses(cfg);
  const bedrockProcs = all.filter(p => /^}?bedrock\./i.test(p.Name));
  return { installed: bedrockProcs.length > 0, count: bedrockProcs.length };
}
