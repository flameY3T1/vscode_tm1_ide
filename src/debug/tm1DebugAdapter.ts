import * as vscode from 'vscode';
import * as path from 'path';
import { Tm1DebugClient, DebuggerState, waitUntilSettled } from './tm1DebugClient';
import { getConfig } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { getServerConfig, getConnectedIds, getConnectedIdsRestored } from '../serverState/state';
import { fetchProcessMessageLog } from '../tm1Rest/logsApi';
import { errMsg } from '../utils/errMsg';
import { outputChannel } from '../utils/outputChannel';

/**
 * Debug type id of our TI debugger, in the manifest and in every
 * `startDebugging` call.
 *
 * Deliberately NOT `tm1`: VS Code keeps one adapter-factory list per extension
 * host, keyed by type alone, and a second registration for the same type throws
 * `a DebugAdapterDescriptorFactory can only be registered once per a type.`
 * A third-party extension that also contributes a `tm1` debugger therefore took
 * this whole activation down with it. Kept in sync with `package.json` by
 * `src/test/debugTypeManifestGuard.test.ts`.
 */
export const TM1_DEBUG_TYPE = 'tm1-ide';

/**
 * Arguments of a `type: "tm1-ide"` launch configuration.
 *
 * `serverId` is what makes a debug session point at a *profile* rather than at
 * "whatever was connected last": two profiles can share one gateway URL and
 * differ only in user or v12 database, so nothing below `serverId` can tell
 * them apart. Written by `tm1.debugProcess` / `tm1.debugProcessFromTree`;
 * optional so hand-written `launch.json` files keep working.
 */
export interface Tm1LaunchArguments {
  processName: string;
  parameters?: Array<{ Name: string; Value: string | number }>;
  serverId?: string;
}

/**
 * Resolves the TM1 connection a debug session runs against.
 *
 * - `serverId` given → exactly that profile; throws when it is not connected
 *   (a fallback here would re-introduce the very bug this resolves).
 * - no `serverId` → only unambiguous situations resolve silently: exactly one
 *   connected profile, or no profiles at all (legacy workspace-settings
 *   config). With several profiles connected the launch fails loudly rather
 *   than guessing — guessing is indistinguishable from debugging the wrong
 *   server.
 */
export function resolveLaunchConfig(serverId?: string): Tm1Config {
  if (serverId) {
    const cfg = getServerConfig(serverId);
    if (!cfg) {
      throw new Error(vscode.l10n.t('TM1 Debug: server profile "{0}" is not connected.', serverId));
    }
    return cfg;
  }
  const ids = getConnectedIds();
  if (ids.length > 1) {
    throw new Error(vscode.l10n.t(
      'TM1 Debug: {0} servers are connected — add "serverId" to the launch configuration to pick one. Connected: {1}',
      String(ids.length), ids.join(', '),
    ));
  }
  if (ids.length === 1) {
    const cfg = getServerConfig(ids[0]);
    if (cfg) { return cfg; }
  }
  return getConfig();
}

const SECTION_CODE: Record<string, string> = { '572': 'Prolog', '573': 'Metadata', '574': 'Data', '575': 'Epilog' };

/** Returns map of procedure name → 0-indexed line in file where section code begins */
function parseSectionStarts(content: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].replace(/\r$/, '').match(/^(572|573|574|575),\d*$/);
    if (m) { map.set(SECTION_CODE[m[1]], i + 1); } // code starts on next line after header
  }
  return map;
}

// Lazy and grouped by name — created only on first access,
// and two modules with the same name share one channel.
const out = outputChannel('TM1 Debug');

const SENSITIVE_PARAM = /pass|secret|key|token/i;
/** Returns a copy of the parameters with sensitive VALUES masked — for logging only. Never mutates the originals sent to TM1. */
function redactParams(params: Array<{ Name: string; Value: string | number }>): Array<{ Name: string; Value: string | number }> {
  return params.map(p => (SENSITIVE_PARAM.test(p.Name) ? { Name: p.Name, Value: '***' } : p));
}

export class Tm1DebugAdapter implements vscode.DebugAdapter {
  private emitter = new vscode.EventEmitter<any>();
  readonly onDidSendMessage = this.emitter.event;

  private client: Tm1DebugClient | null = null;
  private debugId: string | null = null;
  private sectionStarts = new Map<string, number>();
  private fileUri: vscode.Uri | null = null;
  private pendingBreakpoints: Array<{ line: number; condition?: string }> = [];
  private breakpointResults: Map<number, boolean> = new Map();
  private processName = '';
  private processParameters: Array<{ Name: string; Value: string | number }> = [];
  private seq = 1;
  private debugStartTime: Date = new Date();

  handleMessage(message: any): void {
    if (message.type === 'request') {
      this.dispatch(message).catch(err => {
        const msg = errMsg(err);
        out.appendLine(`[ERROR] command=${message.command} error=${msg}`);
        this.emitter.fire({
          type: 'response', request_seq: message.seq, success: false,
          command: message.command, message: msg,
        });
      });
    }
  }

  private reply(req: any, body: any = {}): void {
    this.emitter.fire({ type: 'response', request_seq: req.seq, success: true, command: req.command, body });
  }

  private event(name: string, body: any = {}): void {
    this.emitter.fire({ type: 'event', seq: this.seq++, event: name, body });
  }

  private stopped(reason: string): void {
    this.event('stopped', { reason, threadId: 1, allThreadsStopped: true });
  }

  private async dispatch(req: any): Promise<void> {
    switch (req.command) {

      case 'initialize':
        this.reply(req, {
          supportsConfigurationDoneRequest: true,
          supportsStepInTargetsRequest: false,
          supportsSetVariable: false,
          supportsStepBack: false,
          supportsEvaluateForHovers: true,
          supportsConditionalBreakpoints: false,
        });
        break;

      case 'launch': {
        const args = (req.arguments ?? {}) as Tm1LaunchArguments;
        let cfg: Tm1Config;
        try {
          // Deferred reconnect (review V8): a launch with nothing connected starts it.
          if (getConnectedIds().length === 0) { await getConnectedIdsRestored(); }
          cfg = resolveLaunchConfig(args.serverId);
        } catch (err) {
          // Reply with success:false — VS Code surfaces `message` to the user
          // and ends the session. Deliberately no fallback connection here.
          out.appendLine(`[launch] refused: ${errMsg(err)}`);
          this.emitter.fire({
            type: 'response', request_seq: req.seq, success: false,
            command: req.command, message: errMsg(err), body: {},
          });
          break;
        }
        out.appendLine(`[launch] serverId=${args.serverId ?? '(none)'} serverUrl=${cfg.serverUrl} user=${cfg.username}`);
        this.client = new Tm1DebugClient(cfg);
        this.processName = args.processName;
        this.processParameters = args.parameters ?? [];
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          this.fileUri = editor.document.uri;
          this.sectionStarts = parseSectionStarts(editor.document.getText());
        }
        this.reply(req);
        this.event('initialized');
        break;
      }

      case 'configurationDone': {
        let state: DebuggerState;
        try {
          out.appendLine(`[debug] startDebug processName=${this.processName} params=${JSON.stringify(redactParams(this.processParameters))}`);
          this.debugStartTime = new Date();
          state = await this.client!.startDebug(this.processName, this.processParameters);
          this.debugId = state.id;
          out.appendLine(`[debug] startDebug response: id=${state.id} status=${state.status} executeStatus=${state.executeStatus ?? 'n/a'}`);
          if (state.id) {
            const frames = await this.client!.getCallStack(state.id);
            out.appendLine(`[debug] initial callStack: ${JSON.stringify(frames)}`);
          }
        } catch (err) {
          out.appendLine(`[debug] startDebug ERROR: ${errMsg(err)}`);
          out.show(true);
          this.reply(req);
          this.event('terminated');
          vscode.window.showErrorMessage(vscode.l10n.t('TM1 Debug: {0}', errMsg(err)));
          break;
        }

        // Apply pending breakpoints and collect results
        if (this.pendingBreakpoints.length > 0) {
          await this.applyBreakpoints(this.debugId!);
        }

        this.reply(req);

        if (this.client!.isEnded(state.status)) {
          this.event('terminated');
          await this.showEndMessage(state);
        } else {
          this.stopped('entry');
        }
        break;
      }

      case 'setBreakpoints': {
        const srcPath: string = req.arguments.source?.path ?? '';
        if (this.fileUri && path.resolve(srcPath) !== path.resolve(this.fileUri.fsPath)) {
          this.reply(req, { breakpoints: (req.arguments.breakpoints ?? []).map((bp: any) => ({ verified: false, line: bp.line })) });
          break;
        }
        const bps: any[] = req.arguments.breakpoints ?? [];
        this.pendingBreakpoints = bps.map((bp: any) => ({ line: bp.line as number, condition: bp.condition }));
        this.breakpointResults.clear();
        out.appendLine(`[setBreakpoints] lines=${JSON.stringify(this.pendingBreakpoints.map(b => b.line))}`);

        if (this.client && this.debugId) {
          await this.applyBreakpoints(this.debugId);
        }

        // Return verified status based on actual API results (or pending = true if not yet connected)
        const notConnected = !this.client || !this.debugId;
        this.reply(req, {
          breakpoints: bps.map((bp) => ({
            verified: notConnected ? true : (this.breakpointResults.get(bp.line) ?? false),
            line: bp.line,
          })),
        });
        break;
      }

      case 'threads':
        this.reply(req, { threads: [{ id: 1, name: 'TM1 Process' }] });
        break;

      case 'stackTrace': {
        if (!this.client || !this.debugId) { this.reply(req, { stackFrames: [], totalFrames: 0 }); break; }
        const frames = await this.client.getCallStack(this.debugId);
        out.appendLine(`[stackTrace] frames=${JSON.stringify(frames)}`);
        const dapFrames = frames.map((f) => {
          // Unknown procedure/line stays unknown — no invented Prolog:1 frame.
          const sectionStart = f.procedure !== undefined ? (this.sectionStarts.get(f.procedure) ?? 0) : 0;
          return {
            id: parseInt(f.id, 10) || 1,
            name: f.procedure ?? vscode.l10n.t('(unknown section)'),
            source: this.fileUri
              ? { name: path.basename(this.fileUri.fsPath), path: this.fileUri.fsPath }
              : undefined,
            line: f.lineNumber !== undefined ? sectionStart + f.lineNumber : 0,
            column: 1,
          };
        });
        this.reply(req, { stackFrames: dapFrames, totalFrames: dapFrames.length });
        break;
      }

      case 'scopes':
        this.reply(req, {
          scopes: [{ name: 'TI Variablen', variablesReference: req.arguments.frameId ?? 1, expensive: false }],
        });
        break;

      case 'variables': {
        if (!this.client || !this.debugId) { this.reply(req, { variables: [] }); break; }
        const frameId = String(req.arguments.variablesReference ?? 1);
        const vars = await this.client.getVariables(this.debugId, frameId);
        out.appendLine(`[variables] frameId=${frameId} count=${vars.length}`);
        this.reply(req, {
          variables: vars.map(v => ({
            name: v.name,
            value: v.value,
            type: isNaN(Number(v.value)) ? 'string' : 'number',
            variablesReference: 0,
          })),
        });
        break;
      }

      case 'evaluate': {
        // Hover/watch evaluation — look up variable by name
        const expr: string = (req.arguments.expression ?? '').trim();
        if (!this.client || !this.debugId || !expr) {
          this.reply(req, { result: '', variablesReference: 0 });
          break;
        }
        try {
          const vars = await this.client.getVariables(this.debugId, '1');
          const found = vars.find(v => v.name.toLowerCase() === expr.toLowerCase());
          this.reply(req, {
            result: found ? found.value : vscode.l10n.t("'{0}' not found", expr),
            variablesReference: 0,
          });
        } catch {
          this.reply(req, { result: '', variablesReference: 0 });
        }
        break;
      }

      case 'next': {
        this.reply(req);
        if (this.client && this.debugId) {
          await this.client.stepOver(this.debugId);
          const s = await this.pollForStop();
          if (!s) { break; }
          out.appendLine(`[next] status=${s.status}`);
          if (this.client.isEnded(s.status)) {
            this.event('terminated');
            await this.showEndMessage(s);
          } else {
            this.stopped('step');
          }
        }
        break;
      }

      case 'stepIn': {
        this.reply(req);
        if (this.client && this.debugId) {
          await this.client.stepIn(this.debugId);
          const s = await this.pollForStop();
          if (!s) { break; }
          out.appendLine(`[stepIn] status=${s.status}`);
          if (this.client.isEnded(s.status)) {
            this.event('terminated');
            await this.showEndMessage(s);
          } else {
            this.stopped('step');
          }
        }
        break;
      }

      case 'stepOut': {
        this.reply(req);
        if (this.client && this.debugId) {
          await this.client.stepOut(this.debugId);
          const s = await this.pollForStop();
          if (!s) { break; }
          out.appendLine(`[stepOut] status=${s.status}`);
          if (this.client.isEnded(s.status)) {
            this.event('terminated');
            await this.showEndMessage(s);
          } else {
            this.stopped('step');
          }
        }
        break;
      }

      case 'continue': {
        this.reply(req, { allThreadsContinued: true });
        if (this.client && this.debugId) {
          await this.client.continue(this.debugId);
          const s = await this.pollForStop();
          if (!s) { break; }
          out.appendLine(`[continue] status=${s.status}`);
          if (this.client.isEnded(s.status)) {
            this.event('terminated');
            await this.showEndMessage(s);
          } else {
            this.stopped('breakpoint');
          }
        }
        break;
      }

      case 'disconnect':
      case 'terminate':
        if (this.client && this.debugId) { await this.client.stop(this.debugId, this.processName); }
        this.debugId = null;
        this.reply(req);
        this.event('terminated');
        break;

      default:
        this.reply(req);
    }
  }

  /**
   * Polls until the process really pauses or ends. A poll-deadline timeout is
   * NOT a stop — long-running sections are legitimate, so we log and keep
   * polling instead of reporting a bogus `stopped` event on the entry frame.
   * Returns `null` when the session was disconnected while we waited.
   */
  private async pollForStop(): Promise<DebuggerState | null> {
    if (!this.client || !this.debugId) { return null; }
    const client = this.client;
    const debugId = this.debugId;
    try {
      const s = await waitUntilSettled(client, debugId, this.processName, {
        abandoned: () => !this.client || !this.debugId,
        onStillRunning: (pollError) => out.appendLine(`[poll] still running after the poll timeout${pollError ? ` (last error: ${pollError})` : ''} — continuing to poll`),
      });
      return this.client && this.debugId ? s : null;
    } catch (err) {
      out.appendLine(`[poll] server unreachable (${errMsg(err)}) — ending the session`);
      client.stop(debugId, this.processName).catch(() => {});
      this.debugId = null;
      this.event('terminated');
      return null;
    }
  }

  private async applyBreakpoints(debugId: string): Promise<void> {
    try {
      await this.client!.clearBreakpoints(debugId);
      const converted = this.convertBreakpoints(this.pendingBreakpoints.map(b => b.line));
      out.appendLine(`[applyBreakpoints] lines=${JSON.stringify(this.pendingBreakpoints.map(b => b.line))} converted=${JSON.stringify(converted)}`);
      for (let i = 0; i < converted.length; i++) {
        const bp = converted[i];
        const fileLine = this.pendingBreakpoints[i].line;
        try {
          await this.client!.addBreakpoint(debugId, this.processName, bp.procedure, bp.lineNumber, i);
          out.appendLine(`[applyBreakpoints] OK ${bp.procedure}:${bp.lineNumber}`);
          this.breakpointResults.set(fileLine, true);
        } catch (bpErr) {
          out.appendLine(`[applyBreakpoints] FAILED ${bp.procedure}:${bp.lineNumber} — ${errMsg(bpErr)}`);
          this.breakpointResults.set(fileLine, false);
        }
      }
    } catch (err) {
      out.appendLine(`[applyBreakpoints] error: ${errMsg(err)}`);
      // Mark all as failed
      for (const bp of this.pendingBreakpoints) { this.breakpointResults.set(bp.line, false); }
    }
  }

  private async showEndMessage(state: DebuggerState): Promise<void> {
    const status = state.executeStatus ?? state.status;
    const ok = status === 'Complete' || status === 'Successful';

    // Always show message log entries for this process since debug started
    out.clear();
    const logEntries = await fetchProcessMessageLog(this.processName, this.debugStartTime, 200, getConfig()).catch(() => []);
    if (logEntries.length > 0) {
      for (const e of logEntries) {
        out.appendLine(`${e.timestamp}  ${e.level.padEnd(5)}  ${e.message}`);
      }
    }

    if (ok && !state.errorLog) {
      out.show(true);
      vscode.window.showInformationMessage(vscode.l10n.t('TM1 Debug: Process finished successfully.'));
      return;
    }
    const msg = vscode.l10n.t('TM1 Debug: process finished — {0}', status);
    if (state.errorLog) {
      out.appendLine('');
      out.appendLine('--- Error details ---');
      out.appendLine(state.errorLog);
      out.show(true);
      vscode.window.showWarningMessage(msg);
    } else {
      out.show(true);
      vscode.window.showWarningMessage(msg);
    }
  }

  private convertBreakpoints(fileLines: number[]): Array<{ procedure: string; lineNumber: number }> {
    return fileLines.map(line => {
      const fileLine = line - 1; // 1-indexed → 0-indexed
      let proc = 'Prolog';
      let bestStart = -1;
      for (const [p, start] of this.sectionStarts) {
        if (start <= fileLine && start > bestStart) { bestStart = start; proc = p; }
      }
      return { procedure: proc, lineNumber: fileLine - Math.max(bestStart, 0) + 1 };
    });
  }

  dispose(): void {
    if (this.client && this.debugId) { this.client.stop(this.debugId, this.processName).catch(() => {}); }
    this.emitter.dispose();
  }
}
