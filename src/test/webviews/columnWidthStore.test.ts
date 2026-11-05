import { describe, it, expect, vi } from 'vitest';
import { parseColumnWidths, initColumnWidthStore, savedColumnWidths, rememberColumnWidths } from '../../webviews/columnWidthStore';

function memento() {
  const data = new Map<string, unknown>();
  return { get: (k: string) => data.get(k), update: vi.fn(async (k: string, v: unknown) => { data.set(k, v); }), keys: () => [...data.keys()] };
}

function fakePanel() {
  let handler: (m: unknown) => void = () => {};
  return {
    send: (m: unknown) => handler(m),
    panel: {
      webview: { onDidReceiveMessage: (h: (m: unknown) => void) => { handler = h; return { dispose() {} }; } },
      onDidDispose: () => ({ dispose() {} }),
    },
  };
}

describe('parseColumnWidths', () => {
  it('accepts sane widths, rounds them, and null as reset', () => {
    expect(parseColumnWidths([120.4, 80])).toEqual([120, 80]);
    expect(parseColumnWidths(null)).toBeNull();
  });
  it('rejects anything else', () => {
    for (const bad of [undefined, [], ['1'], [0], [NaN], [99999], new Array(41).fill(10), 'x']) {
      expect(parseColumnWidths(bad)).toBeUndefined();
    }
  });
});

describe('rememberColumnWidths', () => {
  it('stores per window kind, ignores other kinds, and resets on null', () => {
    const m = memento();
    initColumnWidthStore(m as never);
    const a = fakePanel();
    rememberColumnWidths(a.panel as never, 'threads');
    a.send({ columnWidths: 'threads', widths: [50, 60] });
    a.send({ columnWidths: 'messageLog', widths: [1, 2] });
    a.send({ command: 'setPaused' });
    a.send({ columnWidths: 'threads:cubes', widths: [70] });
    a.send({ columnWidths: 'threadsX', widths: [3] });
    expect(savedColumnWidths('threads')).toEqual({ threads: [50, 60], 'threads:cubes': [70] });
    expect(savedColumnWidths('messageLog')).toEqual({});
    a.send({ columnWidths: 'threads', widths: null });
    expect(savedColumnWidths('threads')).toEqual({ 'threads:cubes': [70] });
  });
});
