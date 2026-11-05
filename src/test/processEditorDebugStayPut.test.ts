/**
 * During a debug pause the extension keeps polling the state. Every
 * `debugStateUpdate` reports the same stop position again. Until now, each of
 * these updates yanked the editor back to the current line via
 * `revealLineInCenter` — and via `switchToSection` even back into the tab.
 * Anyone who wanted to scroll or read up in another section while paused was
 * thrown back at every poll tick.
 *
 * Rule: only a CHANGE of the stop position (step, next breakpoint) may move
 * the tab and the viewport.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDebug, onDebugMessage } from '../webviewClient/processEditorMonaco/debug';

type Section = 'prolog' | 'metadata' | 'data' | 'epilog';

function makeHarness() {
  const revealLineInCenter = vi.fn();
  const switchToSection = vi.fn();
  const deltaDecorations = vi.fn(() => ['deco-1']);
  const model = { getLineCount: () => 100, deltaDecorations };
  const bridge = {
    getEditor: () => ({ revealLineInCenter }) as never,
    getModel: (_s: Section) => model as never,
    switchToSection,
    post: vi.fn(),
    onStateChanged: vi.fn(),
  };
  const monaco = { Range: class { constructor(..._a: number[]) { /* stub */ } } } as never;
  initDebug(monaco, bridge);
  return { revealLineInCenter, switchToSection, bridge };
}

function paused(section: Section, line: number) {
  return { type: 'debugStateUpdate', status: 'paused', currentSection: section, currentLine: line, variables: [] } as never;
}

describe('Debug pause: viewport stays put', () => {
  beforeEach(() => {
    onDebugMessage({ type: 'debugSessionEnded', status: 'Beendet' } as never);
  });

  it('moves tab and viewport on the first stop', () => {
    const h = makeHarness();
    onDebugMessage(paused('data', 42));
    expect(h.switchToSection).toHaveBeenCalledWith('data');
    expect(h.revealLineInCenter).toHaveBeenCalledWith(42);
  });

  it('repeated updates at the same position leave the editor alone', () => {
    const h = makeHarness();
    onDebugMessage(paused('data', 42));
    h.switchToSection.mockClear();
    h.revealLineInCenter.mockClear();

    onDebugMessage(paused('data', 42));
    onDebugMessage(paused('data', 42));

    expect(h.switchToSection).not.toHaveBeenCalled();
    expect(h.revealLineInCenter).not.toHaveBeenCalled();
  });

  it('keeps reporting variables even when the position is unchanged', () => {
    const h = makeHarness();
    onDebugMessage(paused('data', 42));
    h.bridge.onStateChanged.mockClear();
    onDebugMessage(paused('data', 42));
    expect(h.bridge.onStateChanged).toHaveBeenCalled();
  });

  it('jumps to the new line on a step', () => {
    const h = makeHarness();
    onDebugMessage(paused('data', 42));
    h.revealLineInCenter.mockClear();
    onDebugMessage(paused('data', 43));
    expect(h.revealLineInCenter).toHaveBeenCalledWith(43);
  });

  it('jumps into the new tab on a section change', () => {
    const h = makeHarness();
    onDebugMessage(paused('data', 42));
    h.switchToSection.mockClear();
    onDebugMessage(paused('epilog', 42));
    expect(h.switchToSection).toHaveBeenCalledWith('epilog');
  });

  it('focuses again after continuing and stopping again on the same line', () => {
    const h = makeHarness();
    onDebugMessage(paused('data', 42));
    onDebugMessage({ type: 'debugStateUpdate', status: 'running', variables: [] } as never);
    h.revealLineInCenter.mockClear();
    onDebugMessage(paused('data', 42));
    expect(h.revealLineInCenter).toHaveBeenCalledWith(42);
  });
});
