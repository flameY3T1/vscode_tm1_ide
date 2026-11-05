// src/webviewClient/mdxRunnerMonaco/validation.ts
import * as monaco from 'monaco-editor';
import { extractElementRefs } from '../../mdx/mdxRefs';
import { getL10n, fmt } from '../_shared/l10n';
import type { HostToWebview, InvalidRef, WebviewToHost } from './protocol';

type PostMessage = (msg: WebviewToHost) => void;

const L = getL10n();

const MARKER_OWNER = 'mdx-validator';
const DEBOUNCE_MS = 800;

const REASON_MESSAGE: Record<InvalidRef['reason'], (r: InvalidRef) => string> = {
  'unknown-element':   (r) => fmt(L, 'unknownElement', r.element, r.dim),
  'unknown-dimension': (r) => fmt(L, 'unknownDimension', r.dim),
  'dim-not-in-cube':   (r) => fmt(L, 'dimNotInCube', r.dim),
};

export class ValidationBridge {
  private _version = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly _model: monaco.editor.ITextModel,
    private readonly _post: PostMessage,
  ) {}

  /** Re-run validation. Called on every model change. */
  schedule(): void {
    if (this._timer) { clearTimeout(this._timer); }
    this._timer = setTimeout(() => this._run(), DEBOUNCE_MS);
  }

  handleResponse(msg: HostToWebview): boolean {
    if (msg?.type !== 'validationResult') { return false; }
    if (typeof msg.version !== 'number' || msg.version < this._version - 1) {
      // Stale — drop.
      return true;
    }
    const invalid = Array.isArray(msg.invalid) ? msg.invalid : [];
    this._applyMarkers(invalid);
    return true;
  }

  dispose(): void {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    monaco.editor.setModelMarkers(this._model, MARKER_OWNER, []);
  }

  private _run(): void {
    const text = this._model.getValue();
    const refs = extractElementRefs(text);
    const version = ++this._version;
    if (refs.length === 0) {
      monaco.editor.setModelMarkers(this._model, MARKER_OWNER, []);
      return;
    }
    // Extract FROM [Cube] once so ext knows which cube to cross-check.
    const fromMatch = /FROM\s+\[([^\]\n]+)\]/i.exec(text);
    const cube = fromMatch ? fromMatch[1] : null;

    this._post({
      type: 'validateNames',
      version,
      cube,
      refs,
    });
  }

  private _applyMarkers(invalid: InvalidRef[]): void {
    const markers: monaco.editor.IMarkerData[] = invalid.map(ref => {
      const start = this._model.getPositionAt(ref.offset);
      const end = this._model.getPositionAt(ref.offset + ref.length);
      return {
        severity: monaco.MarkerSeverity.Warning,
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        message: REASON_MESSAGE[ref.reason](ref),
        source: MARKER_OWNER,
      };
    });
    monaco.editor.setModelMarkers(this._model, MARKER_OWNER, markers);
  }
}
