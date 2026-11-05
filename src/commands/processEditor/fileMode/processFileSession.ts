// One open process file: keeps the `.ti` + `.json` documents and the webview in
// step. No `vscode` import — the provider hands in the outside world, so the
// sync rules are testable on their own.
import { minimalReplace, type TextReplace } from '../../../webviewClient/_shared/minimalReplacePure';
import type {
  HostToWebview, ProtocolDataSource, ProtocolProcessParameter, ProtocolProcessVariable, WebviewToHost,
} from '../../../webviewClient/processEditorMonaco/protocol';
import { parseProcess, serializeProcess, type TM1Process } from '../../../git/serializer';
import { joinSections } from '../../../git/sectionMarkers';
import { sectionsFromTi, tiFromSections } from './processFilePure';
import { mergeVariableColumns, splitVariableColumns, type VariableColumn } from '../../../utils/processVariablesUi';
import { cleanDataSource, normalizeReadDataSource } from '../../../utils/dataSourceWire';

type Eol = '\n' | '\r\n';
type FileSync = Extract<WebviewToHost, { type: 'fileSync' }>;

export type SessionWarning = 'damagedMarkers' | 'damagedHeader' | 'unboundPush' | 'syncFailed';

export interface ProcessFileSessionDeps {
  post(msg: HostToWebview): void;
  /**
   * Applies the `.ti` replace to its document and writes the new `.json` text
   * straight to disk. The header never goes through a WorkspaceEdit: VS Code
   * opens a tab for an edited file no editor shows, and a dirty header would no
   * longer reload when another tool writes it.
   */
  applyEdits(ti: TextReplace | undefined, jsonText: string | undefined): Promise<void>;
  warn(kind: SessionWarning): void;
  scheduleAutosave(): void;
  /** Saves both documents, then pushes to TM1. Only called when `pushAllowed`. */
  push(): Promise<void>;
  /** Saves both documents; false when a save failed (e.g. the file changed on disk). */
  saveFiles(): Promise<boolean>;
  /** What the `.ti` document and the `.json` file hold now (after a failed write). */
  readFiles(): Promise<{ ti: string; json: string }>;
}

export class ProcessFileSession {
  private shownTi: string;
  private shownJson: string;
  private markersDamaged = false;
  private headerDamaged = false;
  /** The last write failed: the files do not hold the editor state until the next one lands. */
  private syncFailed = false;
  /**
   * Counts external changes posted to the webview. A `fileSync` echoes the last
   * one it had applied; an older one was built before an external change and
   * would revert it, so it is dropped (the webview re-syncs after applying).
   */
  private externalSeq = 0;
  /** `onFileSync` computes offsets against `shownTi`; two at once would interleave. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private process: TM1Process,
    tiText: string,
    jsonText: string,
    private readonly eol: Eol,
    private readonly pushAllowed: boolean,
    private readonly deps: ProcessFileSessionDeps,
  ) {
    this.shownTi = tiText;
    this.shownJson = jsonText;
  }

  get processName(): string { return this.process.name; }
  /** The state the webview shows — a reloaded webview is hydrated from it, not from the open state. */
  get current(): TM1Process { return this.process; }
  /** A reloaded webview starts at 0 and must echo this, or every `fileSync` is dropped. */
  get externalSequence(): number { return this.externalSeq; }

  /** The webview changed something: write it into both documents as the smallest edits. */
  onFileSync(msg: FileSync): Promise<void> {
    this.queue = this.queue.then(() => this.applyFileSync(msg)).catch(async () => {
      // Part of the write may have landed. Diff the next sync (full state)
      // against what the files hold now; the queue stays usable.
      this.syncFailed = true;
      this.deps.warn('syncFailed');
      try {
        ({ ti: this.shownTi, json: this.shownJson } = await this.deps.readFiles());
      } catch { /* the next change event corrects it */ }
    });
    return this.queue;
  }

  private async applyFileSync(msg: FileSync): Promise<void> {
    if (msg.seenExternal < this.externalSeq) { return; }
    // A damaged file on disk is foreign work in progress: writing the editor
    // state would replace it. Wait until it parses again.
    if (this.markersDamaged || this.headerDamaged) { return; }
    // The form holds DataSource and the columns in the editor's own shape
    // (renamed fields dropped, VariablesUIData rebuilt from the columns). While
    // the user has not touched them, the header keeps the file's own values —
    // rewriting them made the file differ from the server after every save.
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const shownVariables = mergeVariableColumns(this.process.variables, this.process.variablesUiData);
    const keepColumns = same(msg.variables, shownVariables);
    const keepSource = same(msg.dataSource, cleanDataSource(normalizeReadDataSource(this.process.dataSource)));
    // Ignored columns live in VariablesUIData, not in Variables (as save.ts sends them).
    const columns = splitVariableColumns(msg.variables as VariableColumn[]);
    const next: TM1Process = {
      ...this.process,
      ...msg.sections,
      // `undefined` = "header says nothing" and must stay so; an invented `[]`
      // would delete the server's parameters on push (git/serializer.ts).
      parameters: this.process.parameters === undefined && msg.parameters.length === 0
        ? undefined : msg.parameters as TM1Process['parameters'],
      ...(keepColumns ? {} : {
        variables: columns.Variables,
        // A header without VariablesUIData keeps none as long as no column is
        // ignored — the push then leaves the server list alone (docs/architecture/tm1-rest-quirks.md).
        variablesUiData: this.process.variablesUiData === undefined && !msg.variables.some(v => v.Ignored)
          ? undefined : columns.VariablesUIData,
      }),
      ...(keepSource ? {} : { dataSource: msg.dataSource as TM1Process['dataSource'] }),
      hasSecurity: msg.hasSecurity,
    };
    const { headerJson } = serializeProcess(next);
    const tiText = tiFromSections(msg.sections, this.eol, next.v12);
    // Each file keeps its own line ending: the export writes `.ti` CRLF (as the
    // server's Code blob) and `.json` LF.
    const jsonText = this.shownJson.includes('\r\n') ? headerJson.replace(/\n/g, '\r\n') : headerJson;
    const tiEdit = minimalReplace(this.shownTi, tiText);
    const jsonEdit = minimalReplace(this.shownJson, jsonText);
    this.process = next;
    if (!tiEdit && !jsonEdit) { this.syncFailed = false; return; }
    // Set BEFORE applying: the document change event that follows is our echo.
    this.shownTi = tiText;
    this.shownJson = jsonText;
    await this.deps.applyEdits(tiEdit, jsonEdit ? jsonText : undefined);
    this.syncFailed = false;
    this.deps.scheduleAutosave();
  }

  /** The `.ti` document changed. Foreign changes go to the webview; our own echo does not. */
  onTiChanged(text: string): void {
    if (text === this.shownTi) { return; }
    this.shownTi = text;
    const sections = sectionsFromTi(text, this.process.v12);
    if (!sections) {
      if (!this.markersDamaged) { this.deps.warn('damagedMarkers'); }
      this.markersDamaged = true;
      return;
    }
    this.markersDamaged = false;
    this.process = { ...this.process, ...sections };
    this.deps.post({ type: 'monacoApplyExternal', sections, seq: ++this.externalSeq });
  }

  /** The `.json` document changed: parameters, variables, data source to the webview. */
  onJsonChanged(text: string): void {
    if (text === this.shownJson) { return; }
    this.shownJson = text;
    let parsed: TM1Process;
    try {
      parsed = parseProcess(joinSections(this.process), text.replace(/\r\n/g, '\n'));
    } catch {
      if (!this.headerDamaged) { this.deps.warn('damagedHeader'); }
      this.headerDamaged = true;
      return;
    }
    this.headerDamaged = false;
    this.process = { ...parsed, prolog: this.process.prolog, metadata: this.process.metadata, data: this.process.data, epilog: this.process.epilog, v12: this.process.v12 };
    this.deps.post({ type: 'monacoSetParameters', parameters: (parsed.parameters ?? []) as ProtocolProcessParameter[] });
    this.deps.post({ type: 'monacoSetVariables', variables: mergeVariableColumns(parsed.variables, parsed.variablesUiData) as ProtocolProcessVariable[] });
    this.deps.post({ type: 'monacoSetDataSource', dataSource: parsed.dataSource as ProtocolDataSource });
    this.deps.post({ type: 'monacoSetSecurity', hasSecurity: parsed.hasSecurity ?? false });
    // Sections unchanged; only moves the sequence so a stale fileSync cannot revert the header.
    this.deps.post({ type: 'monacoApplyExternal', sections: {}, seq: ++this.externalSeq });
  }

  /**
   * Execute / Debug / Save As write the editor state to TM1 through the server
   * editor's handlers. An unbound file would hit the ACTIVE connection — refuse;
   * a bound one saves its files first so the file and the server agree.
   */
  async beforeServerWrite(): Promise<boolean> {
    if (!this.pushAllowed) {
      this.deps.warn('unboundPush');
      return false;
    }
    return await this.filesHoldEditor() && this.deps.saveFiles();
  }

  /** Toolbar "Save": a file outside every connected server's git folder never guesses a server. */
  async onSave(): Promise<void> {
    if (!this.pushAllowed) {
      this.deps.warn('unboundPush');
      return;
    }
    if (await this.filesHoldEditor()) { await this.deps.push(); }
  }

  /**
   * Waits for every queued `fileSync` (the webview flushes its debounce before
   * a save message), then says whether the files hold the editor state — a push
   * reads the files, not the webview.
   */
  private async filesHoldEditor(): Promise<boolean> {
    await this.queue;
    const blocked: SessionWarning | undefined = this.markersDamaged ? 'damagedMarkers'
      : this.headerDamaged ? 'damagedHeader' : this.syncFailed ? 'syncFailed' : undefined;
    if (blocked) { this.deps.warn(blocked); }
    return !blocked;
  }
}
