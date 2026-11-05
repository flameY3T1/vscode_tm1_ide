import { describe, it, expect } from 'vitest';
import { buildRestoreSummary } from '../../commands/workbench/restoreSummaryPure';

const T = {
  restored: 'Workbench "{0}" restored — {1} of {2} windows.',
  notOpened: 'Not opened: {0}',
  cancelled: 'Cancelled, not opened: {0}',
  entry: '{0} ({1})',
};

describe('buildRestoreSummary', () => {
  it('reports a full success without a failure list', () => {
    const out = buildRestoreSummary('Quartal', [{ label: 'A', ok: true }, { label: 'B', ok: true }], T);
    expect(out).toBe('Workbench "Quartal" restored — 2 of 2 windows.');
  });

  it('names every failure with its reason', () => {
    const out = buildRestoreSummary('Quartal', [
      { label: 'Cube Viewer "Altbestand"', ok: false, reason: 'cube no longer exists' },
      { label: 'Reporting', ok: true },
    ], T);
    expect(out).toContain('1 of 2 windows');
    expect(out).toContain('Cube Viewer "Altbestand" (cube no longer exists)');
  });

  it('joins several failures with a comma', () => {
    const out = buildRestoreSummary('Q', [
      { label: 'A', ok: false, reason: 'x' },
      { label: 'B', ok: false, reason: 'y' },
    ], T);
    expect(out).toContain('A (x), B (y)');
  });

  it('survives an empty workbench', () => {
    expect(buildRestoreSummary('Leer', [], T)).toBe('Workbench "Leer" restored — 0 of 0 windows.');
  });

  // ── Cancellation is not a failure ──────────────────────────────────────
  it('names the cancelled windows in a SEPARATE line, without a reason', () => {
    const out = buildRestoreSummary('Q', [
      { label: 'A', ok: true },
      { label: 'B', ok: false, cancelled: true },
      { label: 'C', ok: false, cancelled: true },
    ], T);
    expect(out).toContain('1 of 3 windows');
    expect(out).toContain('Cancelled, not opened: B, C');
    // Not a failure: the error line must not show up at all.
    expect(out).not.toContain('Not opened: B');
  });

  it('keeps failure and cancellation apart when both occur', () => {
    const out = buildRestoreSummary('Q', [
      { label: 'A', ok: false, reason: 'cube gone' },
      { label: 'B', ok: false, cancelled: true },
    ], T);
    const lines = out.split('\n');
    expect(lines[1]).toBe('Not opened: A (cube gone)');
    expect(lines[2]).toBe('Cancelled, not opened: B');
  });
});
