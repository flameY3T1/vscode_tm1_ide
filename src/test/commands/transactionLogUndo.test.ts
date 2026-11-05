/**
 * The write-back path of the transaction log: read, plan, ask,
 * write. The building blocks (`planCellUndo`, `readCurrent`) are tested
 * individually; this is about the order in between — above all, that WITHOUT
 * consent nothing goes into the cube and that only the planned values
 * are written (review 2026-09-23, W1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

const apiRequest = vi.hoisted(() => vi.fn());
const updateCells = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/client', () => ({ apiRequest }));
vi.mock('../../tm1Client', () => ({ apiRequest }));
vi.mock('../../tm1Rest/cubeApi', () => ({ getCubeDimensionNames: vi.fn(async () => ['D1', 'D2']) }));
vi.mock('../../cubeViewer/cubeWriteApi', () => ({ updateCells }));
vi.mock('../../commands/cubeViewer/manager', () => ({ CubeViewerManager: { open: vi.fn() } }));

import { undoEntries } from '../../commands/transactionLog';
import type { UndoEntry } from '../../commands/transactionLogPure';

const cfg = { serverUrl: 'http://tm1' } as never;
const warn = vi.mocked(vscode.window.showWarningMessage);

/** Current cell values in tuple order, as `ExecuteMDX` delivers them. */
function serverHolds(...values: unknown[]): void {
  apiRequest.mockImplementation(async (method: string) => (method === 'POST'
    ? { statusCode: 201, body: JSON.stringify({ ID: 'cs', Cells: values.map((Value, Ordinal) => ({ Ordinal, Value })) }) }
    : { statusCode: 204, body: '' }));
}
const entry = (tuple: string[], at: string, OldValue: number, NewValue: number): UndoEntry =>
  ({ Cube: 'C', Tuple: tuple, TimeStamp: at, OldValue, NewValue });

beforeEach(() => {
  apiRequest.mockReset();
  updateCells.mockReset();
  updateCells.mockResolvedValue({ statusCode: 204, body: '' });
  warn.mockReset();
});

describe('undoEntries', () => {
  it('writes nothing when the confirmation is dismissed', async () => {
    serverHolds(5);
    warn.mockResolvedValueOnce(undefined as never);
    expect(await undoEntries(cfg, [entry(['a', 'b'], '2026-09-23T10:00:00Z', 1, 5)])).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(updateCells).not.toHaveBeenCalled();
  });

  it('asks before writing and writes the old value of the chain', async () => {
    serverHolds(5);
    warn.mockImplementationOnce(async () => {
      expect(updateCells).not.toHaveBeenCalled();
      return 'Undo' as never;
    });
    const done = await undoEntries(cfg, [
      entry(['a', 'b'], '2026-09-23T10:00:00Z', 1, 3),
      entry(['a', 'b'], '2026-09-23T10:01:00Z', 3, 5),
    ]);
    expect(done).toBe(true);
    expect(updateCells).toHaveBeenCalledTimes(1);
    expect(updateCells.mock.calls[0][1]).toEqual([{ Dimensions: ['D1', 'D2'], Coordinates: ['a', 'b'], Value: 1 }]);
  });

  it('leaves changed cells alone when the user skips them', async () => {
    // Cell x: changed further since then (9 instead of 5) — conflict. Cell y: clean.
    serverHolds(9, 7);
    warn.mockResolvedValueOnce('Skip changed cells' as never);
    await undoEntries(cfg, [
      entry(['x', 'b'], '2026-09-23T10:00:00Z', 1, 5),
      entry(['y', 'b'], '2026-09-23T10:00:00Z', 2, 7),
    ]);
    expect(updateCells).toHaveBeenCalledTimes(1);
    expect(updateCells.mock.calls[0][1][0]).toMatchObject({ Coordinates: ['y', 'b'], Value: 2 });
  });

  it('does not write a cell that is already at the old value', async () => {
    serverHolds(1);
    warn.mockResolvedValueOnce('Overwrite later changes too' as never);
    await undoEntries(cfg, [entry(['a', 'b'], '2026-09-23T10:00:00Z', 1, 5)]);
    expect(updateCells).not.toHaveBeenCalled();
  });

  it('asks nothing and writes nothing when no cell can be read', async () => {
    apiRequest.mockResolvedValue({ statusCode: 500, body: 'down' });
    expect(await undoEntries(cfg, [entry(['a', 'b'], '2026-09-23T10:00:00Z', 1, 5)])).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(updateCells).not.toHaveBeenCalled();
  });
});
