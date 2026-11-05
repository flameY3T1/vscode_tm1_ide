import * as path from 'path';
import { sanitizeFilename } from './sanitize';

export function expandRepoPath(template: string, workspaceFolder: string): string {
  return template.replace(/\$\{workspaceFolder\}/g, workspaceFolder);
}

export function resolveServerDir(repoPath: string, serverName: string): string {
  return path.posix.join(repoPath, sanitizeFilename(serverName)).replace(/\\/g, '/');
}
