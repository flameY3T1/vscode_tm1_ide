/**
 * JSONL streaming I/O. One JSON object per line, UTF-8, LF newline.
 * Streaming read uses an async generator so 1M-line files don't blow out
 * memory. Malformed lines are reported via a callback rather than throwing
 * mid-iteration so a single bad row doesn't abort a whole file.
 */

import { createReadStream } from 'node:fs';
import * as readline from 'node:readline';

export type JsonlReadOptions = {
  /** Called for each line that fails JSON.parse. Defaults to throwing. */
  onMalformed?: (line: string, lineNo: number, err: Error) => void;
};

export async function* readJsonl<T>(
  filePath: string,
  opts: JsonlReadOptions = {},
): AsyncGenerator<T, void, unknown> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const raw of rl) {
    lineNo++;
    if (raw.trim() === '') continue;
    try {
      yield JSON.parse(raw) as T;
    } catch (e) {
      if (opts.onMalformed) {
        opts.onMalformed(raw, lineNo, e as Error);
      } else {
        throw new Error(`malformed JSON at line ${lineNo}: ${(e as Error).message}`);
      }
    }
  }
}

export async function readJsonlAll<T>(
  filePath: string,
  opts: JsonlReadOptions = {},
): Promise<T[]> {
  const out: T[] = [];
  for await (const item of readJsonl<T>(filePath, opts)) out.push(item);
  return out;
}
