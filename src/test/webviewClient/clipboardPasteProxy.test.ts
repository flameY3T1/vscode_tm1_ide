// The paste proxy has two paths: the native `paste` event and a
// Ctrl+V fallback via Monaco's key handling. The fallback only checked
// `ctrlKey` — but on macOS the paste key is Cmd, so the
// fallback came to nothing there as soon as the webview delivered no `paste` event
// (the MDX Runner and the TI console had checked both before the shared helper).
//
// The timer separates the two paths; that is why the test runs with fake
// timers and checks the NUMBER of `requestPaste` messages: exactly one when
// no event came, and none when one came.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as monacoType from 'monaco-editor';
import { installPasteProxy } from '../../webviewClient/_shared/clipboardProxy';

type KeyHandler = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; keyCode: number }) => void;
type PasteHandler = (e: { clipboardData: { getData(): string } | null; preventDefault(): void; stopPropagation(): void }) => void;

const KEY_V = 52;

interface Rig {
  posted: { type: string }[];
  druecke(mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; keyCode?: number }): void;
  natives(text: string): void;
}

function baue(fokus = true): Rig {
  let onKey: KeyHandler | undefined;
  let onPaste: PasteHandler | undefined;
  const editor = {
    hasTextFocus: () => fokus,
    onKeyDown: (fn: KeyHandler) => { onKey = fn; },
    getSelection: () => ({}),
    executeEdits: () => { /* stub */ },
    focus: () => { /* stub */ },
  } as unknown as monacoType.editor.IStandaloneCodeEditor;
  const monaco = { KeyCode: { KeyV: KEY_V } } as unknown as typeof monacoType;

  // The tests run in the Node environment: `document` does not exist here, and
  // the proxy only needs `addEventListener` from it.
  const vorher = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    addEventListener: (t: string, fn: unknown) => { if (t === 'paste') { onPaste = fn as PasteHandler; } },
  };

  const posted: { type: string }[] = [];
  try {
    installPasteProxy(monaco, editor, m => { posted.push(m); });
  } finally {
    (globalThis as { document?: unknown }).document = vorher;
  }

  return {
    posted,
    druecke(mods) {
      onKey?.({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, keyCode: KEY_V, ...mods });
    },
    natives(text) {
      onPaste?.({ clipboardData: { getData: () => text }, preventDefault: () => {}, stopPropagation: () => {} });
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('installPasteProxy — fallback via the keyboard', () => {
  it.each([
    ['Ctrl+V', { ctrlKey: true }],
    ['Cmd+V', { metaKey: true }],
  ])('%s without a native event asks the host exactly once', (_name, mods) => {
    const rig = baue();
    rig.druecke(mods);
    vi.advanceTimersByTime(100);
    expect(rig.posted).toEqual([{ type: 'requestPaste' }]);
  });

  it.each([
    ['Ctrl+V', { ctrlKey: true }],
    ['Cmd+V', { metaKey: true }],
  ])('%s with a timely native event does not ask the host at all', (_name, mods) => {
    const rig = baue();
    rig.druecke(mods);
    rig.natives('text aus der Zwischenablage');
    vi.advanceTimersByTime(100);
    expect(rig.posted).toEqual([]);
  });

  it('ignores Shift and Alt variants', () => {
    const rig = baue();
    rig.druecke({ metaKey: true, shiftKey: true });
    rig.druecke({ ctrlKey: true, altKey: true });
    rig.druecke({ ctrlKey: true, keyCode: 99 });
    rig.druecke({});
    vi.advanceTimersByTime(100);
    expect(rig.posted).toEqual([]);
  });

  it('fetches the text from the host when the native event arrives EMPTY', () => {
    const rig = baue();
    rig.natives('');
    expect(rig.posted).toEqual([{ type: 'requestPaste' }]);
  });
});
