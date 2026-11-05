/**
 * Where `tm1Rest/` reports a failure it deliberately swallows. The layer may not
 * import vscode, so the extension plugs the "TM1 Background" channel in at
 * activation; before that (and in unit tests) lines go to the console.
 */
import { errMsg } from '../utils/errMsg';

let _sink: (line: string) => void = (line) => console.warn(line);

export function setBestEffortSink(sink: (line: string) => void): void { _sink = sink; }

/** Log a swallowed failure without surfacing it to the user. */
export function logRestBestEffort(scope: string, operation: string, err: unknown): void {
  _sink(`[${new Date().toISOString()}] [${scope}] ${operation} failed: ${errMsg(err)}`);
}
