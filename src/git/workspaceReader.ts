import { readFile, stat } from 'fs/promises';
import * as path from 'path';
import { sanitizeFilename } from './sanitize';
import { parseProcess, parseRules, type TM1Process } from './serializer';
import { errMsg } from '../utils/errMsg';

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') { return null; }
    throw err;
  }
}

export async function readProcess(serverDir: string, processName: string, v12 = false): Promise<TM1Process | null> {
  const fileBase = sanitizeFilename(processName);
  const dir = path.join(serverDir, 'processes');
  const tiPath = path.join(dir, `${fileBase}.ti`);
  const headerPath = path.join(dir, `${fileBase}.json`);

  const [ti, header] = await Promise.all([readIfExists(tiPath), readIfExists(headerPath)]);
  if (ti === null || header === null) { return null; }

  try {
    return parseProcess(ti, header, v12);
  } catch (err) {
    throw new Error(`Failed to parse process header at ${headerPath}: ${errMsg(err)}`);
  }
}

export async function readRules(serverDir: string, cubeName: string): Promise<string | null> {
  const fileBase = sanitizeFilename(cubeName);
  const file = path.join(serverDir, 'rules', `${fileBase}.rux`);
  const text = await readIfExists(file);
  return text === null ? null : parseRules(text);
}

/** Does a rules file already exist in the mirror for this cube? Cheaper than
 *  `readRules` (no reading in) and the question that distinguishes "rule text on the server
 *  deleted" from "never had any". */
export async function hasRulesFile(serverDir: string, cubeName: string): Promise<boolean> {
  const file = path.join(serverDir, 'rules', `${sanitizeFilename(cubeName)}.rux`);
  try { return (await stat(file)).isFile(); }
  catch { return false; }
}
