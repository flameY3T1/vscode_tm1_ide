import type * as monacoType from 'monaco-editor';
import type { WebviewToHost } from './protocol';

import type { SectionKey } from './sectionTypes';

export interface IdentifierInfo {
  kind: 'param' | 'datasource' | 'local-literal' | 'local-param' | 'local-datasource' | 'local-dynamic' | 'function' | 'unknown';
  title: string;
  details: string[];
  type?: 'String' | 'Numeric' | string;
  value?: string;
  source?: { kind: 'param' | 'datasource'; name: string; type?: string };
}

interface HoverBridge {
  /** Returns the section a given Monaco model belongs to — used to derive
   *  the section key from the hover provider's `model` argument. */
  sectionOfModel(model: monacoType.editor.ITextModel): SectionKey | null;
  /** Sends the resolveIdentifier message to the extension. The caller is
   *  expected to enrich the message with inline sections/params/vars. */
  post(msg: WebviewToHost): void;
}

const pending = new Map<string, (info: IdentifierInfo | null) => void>();
let bridge: HoverBridge | null = null;
let nextRequestId = 1;

export function initIdentifierHover(monaco: typeof monacoType, b: HoverBridge): void {
  bridge = b;

  monaco.languages.registerHoverProvider('ti', {
    provideHover: (model, position) => {
      if (!bridge) { return null; }
      const section = bridge.sectionOfModel(model);
      if (!section) { return null; }
      const word = model.getWordAtPosition(position);
      if (!word) { return null; }

      const requestId = 'ih-' + (nextRequestId++);
      const request: Promise<monacoType.languages.Hover | null> = new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          if (pending.has(requestId)) { pending.delete(requestId); resolve(null); }
        }, 1500);
        pending.set(requestId, (info) => {
          window.clearTimeout(timeout);
          if (!info || info.kind === 'function' || info.kind === 'unknown') {
            // The function-hover provider from `completions.ts` already covers
            // KNOWN_SIGNATURES — don't duplicate. For unknown identifiers we
            // deliberately don't show anything.
            resolve(null);
            return;
          }
          resolve({
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            },
            contents: buildHoverContents(info),
          });
        });
      });

      bridge.post({
        type: 'resolveIdentifier',
        requestId,
        word: word.word,
        section,
        line: position.lineNumber,
      });

      return request;
    },
  });
}

export function receiveIdentifierInfo(requestId: string, info: IdentifierInfo | null): void {
  const resolver = pending.get(requestId);
  if (!resolver) { return; }
  pending.delete(requestId);
  resolver(info);
}

function buildHoverContents(info: IdentifierInfo): Array<{ value: string }> {
  // Two lines: `<name> = <wert>` and `<woher> (<typ>)`. For params/ds-vars the
  // first line is just the name (no concrete runtime value at edit time).
  const first = renderFirstLine(info);
  const second = renderSecondLine(info);
  return [{ value: second ? `${first}\n\n${second}` : first }];
}

function renderFirstLine(info: IdentifierInfo): string {
  switch (info.kind) {
    case 'local-literal': {
      const v = info.value ?? '';
      const rendered = info.type === 'Numeric' ? v : `"${v}"`;
      return `**${info.title}** = \`${rendered}\``;
    }
    case 'local-param':
    case 'local-datasource': {
      const src = info.source?.name;
      return src ? `**${info.title}** = \`${src}\`` : `**${info.title}**`;
    }
    case 'local-dynamic':
      return `**${info.title}** = _dynamic_`;
    case 'param':
    case 'datasource':
    default:
      return `**${info.title}**`;
  }
}

function renderSecondLine(info: IdentifierInfo): string {
  const paren = (t?: string) => (t ? ` (${t})` : '');
  switch (info.kind) {
    case 'param':           return `Parameter${paren(info.type)}`;
    case 'datasource':      return `DataSource-Variable${paren(info.type)}`;
    case 'local-literal':   return `Variable${paren(info.type)}`;
    case 'local-param':     return `Variable${paren(info.source?.type)} · aus Parameter`;
    case 'local-datasource':return `Variable${paren(info.source?.type)} · aus DataSource-Variable`;
    case 'local-dynamic':   return `Variable`;
    default:                return '';
  }
}
