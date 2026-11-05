/**
 * Minimal vscode module mock for unit/property testing outside the extension host.
 */

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class FileDecoration {
  constructor(public badge?: string, public tooltip?: string, public color?: ThemeColor) {}
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: ThemeColor) {}
}

export class TreeItem {
  label?: string;
  collapsibleState?: TreeItemCollapsibleState;
  contextValue?: string;
  iconPath?: ThemeIcon;
  description?: string;
  tooltip?: string;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  readonly event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
  };

  fire(data: T): void {
    for (const listener of this._listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this._listeners = [];
  }
}

export enum ViewColumn {
  Active = -1,
  // Same numeric values as the real API. `Beside` was missing here, so tests
  // could not tell a deliberate "next to the caller" column from a hard `One`.
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

/** `createWebviewPanel`'s 3rd argument: either a bare column or the options form. */
export type MockShowOptions = ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean };

/** Minimal mock WebviewPanel for testing ProcessEditorManager. */
export class MockWebviewPanel {
  private _disposed = false;
  private _html = '';
  private _disposeListeners: Array<() => void> = [];
  private _messageListeners: Array<(msg: any) => void> = [];
  public readonly webview = {
    // html is redefined as a throwing accessor in the constructor; the literal
    // keeps the property for typing.
    html: '',
    // Real VS Code throws "Webview is disposed" when posting after dispose.
    // Mirroring that lets the suite catch post-after-dispose bugs (the class
    // that shipped from the threads/messageLog pollers).
    postMessage: vi.fn((_msg: any) => {
      if (this._disposed) { throw new Error('Webview is disposed'); }
      return Promise.resolve(true);
    }),
    onDidReceiveMessage: vi.fn((listener: (msg: any) => void) => {
      this._messageListeners.push(listener);
      return { dispose: () => { this._messageListeners = this._messageListeners.filter(l => l !== listener); } };
    }),
    asWebviewUri: (uri: any) => uri,
    cspSource: 'vscode-webview:',
  };

  constructor(
    public readonly viewType: string,
    public title: string,
    public readonly showOptions: MockShowOptions,
    public readonly options: any,
  ) {
    Object.defineProperty(this.webview, 'html', {
      get: () => this._html,
      set: (v: string) => {
        if (this._disposed) { throw new Error('Webview is disposed'); }
        this._html = v;
      },
      configurable: true,
    });
  }

  /**
   * The column this panel currently lives in. Real VS Code resolves the
   * symbolic `Active`/`Beside` to a concrete column here; the mock leaves it
   * `undefined` (matching a hidden panel) so tests must set it explicitly when
   * they want to exercise a caller that forwards its own column.
   */
  public viewColumn: ViewColumn | undefined = undefined;

  /**
   * `vi.fn` rather than a bare no-op so the ARGUMENT is observable: `reveal()`
   * without a column means "stay put", `reveal(col)` means "move there" — a
   * difference the old no-op silently swallowed.
   */
  reveal = vi.fn((_column?: ViewColumn, _preserveFocus?: boolean): void => {});

  /** Simulate receiving a message from the webview (for testing). */
  simulateMessage(msg: any): void {
    for (const listener of this._messageListeners) {
      listener(msg);
    }
  }

  onDidDispose(listener: () => void): { dispose: () => void } {
    this._disposeListeners.push(listener);
    return { dispose: () => {} };
  }

  /** Never fired by the mock — callers only need the subscribe call itself not to throw. */
  onDidChangeViewState(_listener: (e: { webviewPanel: MockWebviewPanel }) => void): { dispose: () => void } {
    return { dispose: () => {} };
  }

  dispose(): void {
    if (this._disposed) { return; }
    this._disposed = true;
    for (const l of this._disposeListeners) { l(); }
  }
}

export const window = {
  registerFileDecorationProvider: vi.fn(() => ({ dispose: () => {} })),
  createStatusBarItem: vi.fn(() => ({
    text: '', tooltip: undefined as unknown, name: '', command: undefined as unknown,
    backgroundColor: undefined as unknown, show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
  })),
  createWebviewPanel: vi.fn(
    (viewType: string, title: string, showOptions: ViewColumn, options?: any) =>
      new MockWebviewPanel(viewType, title, showOptions, options),
  ),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showQuickPick: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),
  createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  visibleTextEditors: [] as any[],
  withProgress: vi.fn(async (_options: any, task: any) => {
    const progress = { report: vi.fn() };
    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) };
    return await task(progress, token);
  }),
  createOutputChannel: vi.fn((name: string) => ({
    name,
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  })),
};

export enum ProgressLocation { SourceControl = 1, Window = 10, Notification = 15 }

/** Scope argument of WorkspaceConfiguration#update — same numbering as the real API. */
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }

export const env = {
  language: 'en',
  clipboard: {
    readText: vi.fn().mockResolvedValue(''),
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  openExternal: vi.fn().mockResolvedValue(true),
};

// Mirrors vscode.l10n.t: index args ({0}) for positional, named ({name}) for object args.
// Zero args (real @vscode/l10n `format`: `if (Object.keys(values).length === 0) return template;`)
// returns the message UNCHANGED — placeholders stay literal instead of collapsing to ''. Callers
// rely on that to fetch a still-templated string and substitute it themselves later
// (commands/workbench/restoreFlow.ts builds its SummaryLabels this way).
export const l10n = {
  t: (message: string | { message: string; args?: unknown[] | Record<string, unknown> }, ...rest: unknown[]): string => {
    const msg = typeof message === 'string' ? message : message.message;
    const args = typeof message === 'string' ? rest : (message.args ?? []);
    if (Array.isArray(args)) {
      if (args.length === 0) { return msg; }
      return msg.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
    }
    if (Object.keys(args).length === 0) { return msg; }
    return msg.replace(/\{(\w+)\}/g, (_, k) => String((args as Record<string, unknown>)[k] ?? ''));
  },
  bundle: undefined as unknown,
  uri: undefined as unknown,
};

// Minimal command registry so `commands.executeCommand` can actually invoke a
// handler registered via `commands.registerCommand` in the same test — needed
// for tests that exercise a command end-to-end instead of importing its body
// directly. Commands with no registered handler (e.g. the built-in
// `setContext`) just resolve to `undefined`, same as before this registry existed.
const _commandRegistry = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  executeCommand: vi.fn((command: string, ...args: unknown[]) => {
    const handler = _commandRegistry.get(command);
    return Promise.resolve(handler ? handler(...args) : undefined);
  }),
  registerCommand: vi.fn((command: string, callback: (...args: unknown[]) => unknown) => {
    _commandRegistry.set(command, callback);
    return { dispose: vi.fn(() => { _commandRegistry.delete(command); }) };
  }),
};

// --- Diagnostics support ---

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  constructor(
    public readonly startLine: number,
    public readonly startCharacter: number,
    public readonly endLine: number,
    public readonly endCharacter: number,
  ) {}
  /** The real API exposes Positions; the flat fields above predate them and stay. */
  get start(): Position { return new Position(this.startLine, this.startCharacter); }
  get end(): Position { return new Position(this.endLine, this.endCharacter); }
}

export class WorkspaceEdit {
  private _ops: Array<{ uri: Uri; range: Range; newText: string }> = [];
  replace(uri: Uri, range: Range, newText: string): void {
    this._ops.push({ uri, range, newText });
  }
  get size(): number { return this._ops.length; }
  /** Test helper: access all recorded replacements. */
  _allReplacements(): Array<{ uri: Uri; range: Range; newText: string }> {
    return [...this._ops];
  }
}

export class Diagnostic {
  constructor(
    public readonly range: Range,
    public readonly message: string,
    public readonly severity?: DiagnosticSeverity,
  ) {}
}

export class Location {
  constructor(public readonly uri: Uri, public readonly range: Range) {}
}

export class MarkdownString {
  value = '';
  isTrusted = false;
  supportHtml = false;
  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

export enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Unit = 10,
  Value = 11,
  Enum = 12,
  Keyword = 13,
  Snippet = 14,
  Color = 15,
  File = 16,
  Reference = 17,
  Folder = 18,
  EnumMember = 19,
  Constant = 20,
  Struct = 21,
  Event = 22,
  Operator = 23,
  TypeParameter = 24,
}

export class SnippetString {
  constructor(public readonly value: string = '') {}
}

export class CompletionItem {
  detail?: string;
  documentation?: string | MarkdownString;
  filterText?: string;
  insertText?: string | SnippetString;
  sortText?: string;
  constructor(
    public readonly label: string,
    public readonly kind?: CompletionItemKind,
  ) {}
}

export class DataTransferItem {
  constructor(public readonly value: unknown) {}
  asString(): Thenable<string> { return Promise.resolve(String(this.value)); }
}

export class DataTransfer {
  private readonly _items = new Map<string, DataTransferItem>();
  set(mime: string, item: DataTransferItem): void { this._items.set(mime, item); }
  get(mime: string): DataTransferItem | undefined { return this._items.get(mime); }
}

export class ParameterInformation {
  constructor(
    public readonly label: string,
    public readonly documentation?: string | MarkdownString,
  ) {}
}

export class SignatureInformation {
  parameters: ParameterInformation[] = [];
  constructor(
    public readonly label: string,
    public readonly documentation?: string | MarkdownString,
  ) {}
}

export class SignatureHelp {
  signatures: SignatureInformation[] = [];
  activeSignature = 0;
  activeParameter = 0;
}

export class Uri {
  // Structural parity with the real vscode.Uri so mock instances are
  // assignable where production code expects `vscode.Uri` under typecheck.
  readonly scheme: string = 'file';
  readonly authority: string = '';
  readonly query: string = '';
  readonly fragment: string = '';
  constructor(public readonly fsPath: string) {}
  get path(): string { return this.fsPath; }
  static file(path: string): Uri { return new Uri(path); }
  static parse(value: string): Uri {
    // Strip file:// prefix if present, otherwise pass through
    return new Uri(value.replace(/^file:\/\//, ''));
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    const sep = base.fsPath.endsWith('/') ? '' : '/';
    return new Uri(base.fsPath + sep + segments.join('/'));
  }
  with(_change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return this;
  }
  toJSON(): unknown { return { scheme: this.scheme, path: this.path, fsPath: this.fsPath }; }
  toString(): string { return this.fsPath; }
}

/** Minimal mock DiagnosticCollection. */
export class MockDiagnosticCollection {
  public readonly name: string;
  private _entries = new Map<string, Diagnostic[]>();

  constructor(name: string) { this.name = name; }

  set(uri: Uri, diagnostics: Diagnostic[]): void {
    this._entries.set(uri.toString(), diagnostics);
  }

  delete(uri: Uri): void {
    this._entries.delete(uri.toString());
  }

  get(uri: Uri): Diagnostic[] | undefined {
    return this._entries.get(uri.toString());
  }

  clear(): void { this._entries.clear(); }
  dispose(): void { this._entries.clear(); }

  /** Test helper: return all entries. */
  entries(): Map<string, Diagnostic[]> { return this._entries; }
}

// Event emitters for workspace document events
const _onDidOpenTextDocument = new EventEmitter<any>();
const _onDidChangeTextDocument = new EventEmitter<any>();
const _onDidCloseTextDocument = new EventEmitter<any>();

export const languages = {
  createDiagnosticCollection: vi.fn((name: string) => new MockDiagnosticCollection(name)),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidOpenTextDocument: _onDidOpenTextDocument.event,
  onDidChangeTextDocument: _onDidChangeTextDocument.event,
  onDidCloseTextDocument: _onDidCloseTextDocument.event,
  workspaceFolders: undefined as Array<{ uri: Uri; name: string; index: number }> | undefined,
  textDocuments: [] as any[],
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
  /** Test helper: fire open event */
  _fireOpen: (doc: any) => _onDidOpenTextDocument.fire(doc),
  /** Test helper: fire change event */
  _fireChange: (e: any) => _onDidChangeTextDocument.fire(e),
  /** Test helper: fire close event */
  _fireClose: (doc: any) => _onDidCloseTextDocument.fire(doc),
};

export class FoldingRangeKind {
  static readonly Comment = new FoldingRangeKind(1);
  static readonly Imports = new FoldingRangeKind(2);
  static readonly Region = new FoldingRangeKind(3);
  constructor(public readonly value: number) {}
}

export class FoldingRange {
  constructor(
    public start: number,
    public end: number,
    public kind?: FoldingRangeKind,
  ) {}
}

export class TextEdit {
  private constructor(
    public readonly range: Range,
    public readonly newText: string,
  ) {}
  static replace(range: Range, newText: string): TextEdit { return new TextEdit(range, newText); }
}

/** Only the members the providers use; the real enum has ~26 kinds. */
export const SymbolKind = {
  Namespace: 2,
  Function: 11,
  Variable: 12,
} as const;

export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  constructor(
    public readonly name: string,
    public readonly detail: string,
    public readonly kind: number,
    public readonly range: Range,
    public readonly selectionRange: Range,
  ) {}
}
