import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { sanitizeFilename } from './sanitize';
import { serializeProcess, serializeRules, type TM1Process } from './serializer';

/**
 * Assert that `filePath` resolves to a location inside `expectedRoot`, then write
 * it. This is an EXPLICIT path-containment guard: even if `sanitizeFilename`
 * regresses and lets a `/`, `\` or `..` slip through into the derived filename,
 * a crafted object name can never escape the intended server-dir subtree here —
 * we throw instead of writing. Separator-aware `startsWith` (root + path.sep)
 * matches the `path.resolve` style used in repoGuard.ts.
 */
export async function writeFileEnsuringDir(expectedRoot: string, filePath: string, content: string): Promise<void> {
  const root = path.resolve(expectedRoot);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside mirror root: ${resolved} escapes ${root}`);
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, 'utf8');
}

export async function writeProcess(serverDir: string, process: TM1Process): Promise<void> {
  const fileBase = sanitizeFilename(process.name);
  const dir = path.join(serverDir, 'processes');
  const { tiText, headerJson } = serializeProcess(process);
  await writeFileEnsuringDir(dir, path.join(dir, `${fileBase}.ti`), tiText);
  await writeFileEnsuringDir(dir, path.join(dir, `${fileBase}.json`), headerJson);
}

export async function writeRules(serverDir: string, cubeName: string, rulesText: string): Promise<void> {
  const fileBase = sanitizeFilename(cubeName);
  const dir = path.join(serverDir, 'rules');
  const file = path.join(dir, `${fileBase}.rux`);
  await writeFileEnsuringDir(dir, file, serializeRules(rulesText));
}
