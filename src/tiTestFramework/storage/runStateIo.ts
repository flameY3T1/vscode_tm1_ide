/**
 * Persisted run-state sidecar (.last-run.json) per test folder.
 * Tracks the most recent run plus the most recent successful run separately
 * so a regression doesn't lose the "last green" timestamp.
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';

export const RUN_STATE_FILENAME = '.last-run.json';

export type RunState = {
  /** Most recent run, regardless of result. */
  lastRun?: { result: 'pass' | 'fail'; at: number };
  /** Most recent successful run timestamp (ms). */
  lastSuccessAt?: number;
};

export function runStatePath(testFolder: string): string {
  return path.join(testFolder, RUN_STATE_FILENAME);
}

export async function readRunState(testFolder: string): Promise<RunState> {
  try {
    const raw = await fs.readFile(runStatePath(testFolder), 'utf8');
    const parsed = JSON.parse(raw);
    return validateRunState(parsed);
  } catch {
    return {};
  }
}

export async function writeRunState(testFolder: string, state: RunState): Promise<void> {
  const valid = validateRunState(state);
  const sorted: RunState = {};
  if (valid.lastRun) sorted.lastRun = { result: valid.lastRun.result, at: valid.lastRun.at };
  if (valid.lastSuccessAt !== undefined) sorted.lastSuccessAt = valid.lastSuccessAt;
  // Lazy mkdir — virtual sub folders (Phase 2.5 synthetic) may not exist.
  await fs.mkdir(testFolder, { recursive: true }).catch(() => undefined);
  await fs.writeFile(runStatePath(testFolder), JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

export function recordRun(prev: RunState, pass: boolean, atMs: number = Date.now()): RunState {
  const lastRun = { result: pass ? ('pass' as const) : ('fail' as const), at: atMs };
  const lastSuccessAt = pass ? atMs : prev.lastSuccessAt;
  return { lastRun, lastSuccessAt };
}

function validateRunState(input: unknown): RunState {
  if (!input || typeof input !== 'object') return {};
  const obj = input as Record<string, unknown>;
  const out: RunState = {};
  if (obj.lastRun && typeof obj.lastRun === 'object') {
    const lr = obj.lastRun as Record<string, unknown>;
    if ((lr.result === 'pass' || lr.result === 'fail') && typeof lr.at === 'number') {
      out.lastRun = { result: lr.result, at: lr.at };
    }
  }
  if (typeof obj.lastSuccessAt === 'number') {
    out.lastSuccessAt = obj.lastSuccessAt;
  }
  return out;
}
