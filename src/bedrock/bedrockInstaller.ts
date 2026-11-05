import type { Tm1Config } from '../tm1Rest/transport/types';
import type { BedrockManifestEntry } from './bedrockManifest';
import { errMsg } from '../utils/errMsg';

export interface InstallProgress {
  done: number;
  total: number;
  current: string;
}

export interface InstallResult {
  installed: number;
  failed: Array<{ name: string; error: string }>;
}

export type ProcessDeployer = (cfg: Tm1Config, name: string, payload: Record<string, any>) => Promise<void>;

export async function installBedrockManifest(
  cfg: Tm1Config,
  manifest: BedrockManifestEntry[],
  deploy: ProcessDeployer,
  onProgress: (p: InstallProgress) => void,
): Promise<InstallResult> {
  const failed: Array<{ name: string; error: string }> = [];
  let installed = 0;
  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    try {
      await deploy(cfg, entry.name, entry.payload);
      installed++;
    } catch (err) {
      failed.push({ name: entry.name, error: errMsg(err) });
    }
    onProgress({ done: i + 1, total: manifest.length, current: entry.name });
  }
  return { installed, failed };
}
