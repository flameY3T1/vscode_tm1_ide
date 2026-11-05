import type { Tm1Config } from '../tm1Rest/transport/types';
import { pushProcess } from './processPusher';
import { pushRulesText } from './rulesApi';
import { readProcess, readRules } from './workspaceReader';

/** Read a process's local mirror files and push them to the server. */
export async function pushProcessFrom(
  serverDir: string,
  _server: string,
  processName: string,
  config: Tm1Config,
  /** See `pushProcess`. */
  ifMatch?: string,
): Promise<string | undefined> {
  const proc = await readProcess(serverDir, processName, config.version === 'v12');
  if (!proc) {
    throw new Error(`No local files for process "${processName}" under ${serverDir}/processes`);
  }
  return pushProcess(proc, config, ifMatch);
}

/** Read a cube's local rules file and push it to the server. */
export async function pushRulesFrom(
  serverDir: string,
  _server: string,
  cubeName: string,
  config: Tm1Config,
): Promise<void> {
  const rules = await readRules(serverDir, cubeName);
  if (rules === null) {
    throw new Error(`No local files for rules of cube "${cubeName}" under ${serverDir}/rules`);
  }
  await pushRulesText(cubeName, rules, config);
}
