import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { PROCESS_HEADER_SELECT } from '../../tm1Rest/processApi';
import type { TM1Process } from '../../git/serializer';
import { resolveDir } from '../../providers/serverConfigForFile';
import { writeProcess, writeRules } from '../../git/workspaceWriter';
import { fetchProcess } from '../../git/processFetcher';
import { errMsg } from '../../utils/errMsg';
import { outputChannel } from '../../utils/outputChannel';

// Lazy and grouped by name — it only comes into being on first access, and
// two modules with the same name share a single channel.
const out = outputChannel('TM1 Git');

// One mirror run per process at a time: two quick saves must not land in the
// repo in the order their server reads happen to finish.
const pending = new Map<string, Promise<void>>();

/**
 * After a save the repo gets what a pull would write. The code is the one
 * just sent (`proc`); the header comes from the server, because the editor
 * holds DataSource and the columns in its own shape, and rebuilding them made
 * "Open Process as File" report a difference after every save. Only the header
 * fields are read, the code is not downloaded again.
 *
 * When that read fails, the editor state is written instead — the repo must
 * not keep the code from before the save, or a later push would undo it.
 */
export function mirrorProcessAfterSave(proc: TM1Process, config: Tm1Config): Promise<void> {
  const key = `${config.serverUrl}|${proc.name}`;
  const run = (pending.get(key) ?? Promise.resolve()).then(() => mirrorOnce(proc, config));
  pending.set(key, run);
  void run.finally(() => { if (pending.get(key) === run) { pending.delete(key); } });
  return run;
}

async function mirrorOnce(proc: TM1Process, config: Tm1Config): Promise<void> {
  const target = resolveDir(config);
  if (!target) { return; }
  const v12 = config.version === 'v12';
  const code = { prolog: proc.prolog, metadata: proc.metadata, data: proc.data, epilog: proc.epilog };
  let toWrite: TM1Process;
  try {
    toWrite = { ...(await fetchProcess(proc.name, config, PROCESS_HEADER_SELECT)), ...code };
  } catch (err) {
    out.appendLine(`[mirror-process] header read failed, writing the editor state: ${errMsg(err)}`);
    void vscode.window.showWarningMessage(vscode.l10n.t(
      'Git mirror: could not read "{0}" back from the server; the repository holds the editor state. Pull the process to compare.', proc.name));
    toWrite = { ...proc, v12 };
  }
  try {
    await writeProcess(target.serverDir, toWrite);
    out.appendLine(`[mirror] process "${proc.name}" → ${target.serverDir}/processes/`);
  } catch (err) {
    out.appendLine(`[mirror-process] error: ${errMsg(err)}`);
  }
}

export async function mirrorRulesAfterSave(cubeName: string, rulesText: string, config: Tm1Config): Promise<void> {
  const target = resolveDir(config);
  if (!target) { return; }
  try {
    await writeRules(target.serverDir, cubeName, rulesText);
    out.appendLine(`[mirror] rules "${cubeName}" → ${target.serverDir}/rules/`);
  } catch (err) {
    out.appendLine(`[mirror-rules] error: ${errMsg(err)}`);
  }
}
