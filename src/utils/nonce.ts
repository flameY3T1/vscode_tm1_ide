import { randomBytes } from 'node:crypto';

export function getNonce(): string {
  return randomBytes(16).toString('hex');
}
