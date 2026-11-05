import { describe, it, expect } from 'vitest';
import { restoreAtActivation } from '../../activation/restoreTriggerPure';

// Review V8: an offline `.pro`/`.rux` must not reconnect the last servers.
describe('restoreAtActivation', () => {
  it('defers when a TM1 file language is open (onLanguage activation)', () => {
    expect(restoreAtActivation({ openLanguageIds: ['ti'], tm1NotebookOpen: false })).toBe(false);
    expect(restoreAtActivation({ openLanguageIds: ['markdown', 'tm1rules'], tm1NotebookOpen: false })).toBe(false);
  });

  it('restores at once without a TM1 file (command, view, debugger)', () => {
    expect(restoreAtActivation({ openLanguageIds: [], tm1NotebookOpen: false })).toBe(true);
    expect(restoreAtActivation({ openLanguageIds: ['typescript'], tm1NotebookOpen: false })).toBe(true);
  });

  it('restores at once for a TM1 notebook, even with TI cells open', () => {
    expect(restoreAtActivation({ openLanguageIds: ['ti'], tm1NotebookOpen: true })).toBe(true);
  });
});
