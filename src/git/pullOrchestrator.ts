import type { Tm1Config } from '../tm1Rest/transport/types';
import { fetchProcess } from './processFetcher';
import { fetchRulesText } from './rulesApi';
import { writeProcess, writeRules } from './workspaceWriter';

export interface PullResult {
  name: string;
  kind: 'process' | 'rules';
  key: string;
}

/** Fetch a process from the server and overwrite its local mirror files. */
export async function pullProcessTo(
  serverDir: string,
  _server: string,
  processName: string,
  config: Tm1Config,
): Promise<PullResult> {
  const proc = await fetchProcess(processName, config);
  await writeProcess(serverDir, proc);
  return { name: processName, kind: 'process', key: `processes/${processName}` };
}

/** Fetch a cube's rules from the server and overwrite the local mirror file. */
export async function pullRulesTo(
  serverDir: string,
  _server: string,
  cubeName: string,
  config: Tm1Config,
): Promise<PullResult> {
  const rules = await fetchRulesText(cubeName, config);
  await writeRules(serverDir, cubeName, rules);
  return { name: cubeName, kind: 'rules', key: `rules/${cubeName}` };
}
