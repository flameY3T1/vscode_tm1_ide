// src/webviewClient/mdxRunnerMonaco/completion.ts
import * as monaco from 'monaco-editor';
import { getMdxContext, MdxContext, pickMembers } from '../../mdx/mdxContext';
import { escapeMdx } from '../../utils/odataKey';
import {
  MDX_KEYWORDS,
  ALL_FUNCTIONS,
  MEMBER_PROPERTIES,
} from '../../mdx/mdxFunctions';
import { SNIPPET_RULE } from '../_shared/monacoEnums';
import type { CompletionContext, HostToWebview, WebviewToHost } from './protocol';

type PostMessage = (msg: WebviewToHost) => void;

interface PendingReq {
  resolve: (items: string[]) => void;
  context: CompletionContext;
}

export class CompletionBridge {
  private _nextId = 1;
  private _pending = new Map<number, PendingReq>();

  constructor(private readonly _post: PostMessage) {}

  /** Called by the message listener when the ext responds. Returns true if it handled the message. */
  handleResponse(msg: HostToWebview): boolean {
    if (msg?.type !== 'completions' || typeof msg.reqId !== 'number') { return false; }
    const p = this._pending.get(msg.reqId);
    if (!p) { return true; }
    this._pending.delete(msg.reqId);
    p.resolve(Array.isArray(msg.items) ? msg.items : []);
    return true;
  }

  request(context: CompletionContext, extra: { cube?: string; dim?: string; hier?: string } = {}): Promise<string[]> {
    const reqId = this._nextId++;
    return new Promise<string[]>((resolve) => {
      this._pending.set(reqId, { resolve, context });
      this._post({ type: 'getCompletions', context, reqId, ...extra });
      // Safety timeout: if ext never responds in 3 s, resolve empty.
      setTimeout(() => {
        if (this._pending.delete(reqId)) { resolve([]); }
      }, 3000);
    });
  }
}

export function registerMdxCompletion(bridge: CompletionBridge): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('mdx', {
    triggerCharacters: ['[', '.'],
    provideCompletionItems: async (model, position) => {
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const ctx = getMdxContext(text, offset);
      if (!ctx) { return { suggestions: [] }; }

      const wordInfo = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
      };

      return { suggestions: await buildSuggestions(ctx, range, bridge) };
    },
  });
}

async function buildSuggestions(
  ctx: MdxContext,
  range: monaco.IRange,
  bridge: CompletionBridge,
): Promise<monaco.languages.CompletionItem[]> {
  if (ctx.kind === 'cube') {
    const cubes = await bridge.request('cubes');
    return cubes.map(name => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: name,
      range,
      detail: 'Cube',
    }));
  }

  if (ctx.kind === 'dim') {
    const dims = ctx.cube
      ? await bridge.request('cubeDims', { cube: ctx.cube })
      : [];
    return dims.map(name => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: name,
      range,
      detail: ctx.cube ? `Dim of ${ctx.cube}` : 'Dimension',
    }));
  }

  if (ctx.kind === 'member') {
    const names = await bridge.request('dimElements', { dim: ctx.dim, hier: ctx.hier ?? undefined });
    // The whole text after `[` is replaced — element names carry spaces, which
    // the word range would cut.
    const memberRange = { ...range, startColumn: range.endColumn - ctx.prefix.length };
    return pickMembers(names, ctx.prefix).map(name => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.EnumMember,
      insertText: escapeMdx(name),
      filterText: name,
      range: memberRange,
      detail: ctx.hier ? `${ctx.dim}:${ctx.hier}` : ctx.dim,
    }));
  }

  if (ctx.kind === 'memberFunction') {
    const out: monaco.languages.CompletionItem[] = [];
    for (const p of MEMBER_PROPERTIES) {
      out.push({
        label: p,
        kind: monaco.languages.CompletionItemKind.Property,
        insertText: p,
        range,
        detail: 'Member Property',
      });
    }
    for (const f of ALL_FUNCTIONS) {
      out.push({
        label: f.name,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: f.snippet,
        insertTextRules: SNIPPET_RULE,
        range,
        detail: 'Function',
      });
    }
    return out;
  }

  if (ctx.kind === 'function') {
    const out: monaco.languages.CompletionItem[] = [];
    for (const kw of MDX_KEYWORDS) {
      out.push({
        label: kw,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: kw,
        range,
      });
    }
    for (const f of ALL_FUNCTIONS) {
      out.push({
        label: f.name,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: f.snippet,
        insertTextRules: SNIPPET_RULE,
        range,
        detail: 'Function',
      });
    }
    return out;
  }

  return [];
}
