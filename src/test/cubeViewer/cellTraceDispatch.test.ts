import { describe, it, expect, vi } from 'vitest';

const { openCellTracePanel } = vi.hoisted(() => ({
  openCellTracePanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../commands/cubeViewer/cellTracePanel', () => ({ openCellTracePanel }));

import { cubeViewerTable } from '../../commands/cubeViewer/messaging';
import type { Tm1Config } from '../../tm1Rest/transport/types';

describe('cubeViewer trace dispatch', () => {
  it('maps a trace message to openCellTracePanel cube/dims/coords/config', async () => {
    const config = { serverUrl: 'https://s' } as unknown as Tm1Config;
    const ctx = {
      panelKey: 'k', panel: {} as any, cubeName: 'C',
      existingViewName: undefined, existingViewIsPrivate: false, config,
    };
    await cubeViewerTable.trace(
      { type: 'trace', kind: 'rule', dimensions: ['D'], coordinates: ['E'] } as any,
      ctx as any,
    );
    expect(openCellTracePanel).toHaveBeenCalledWith({
      kind: 'rule', cube: 'C', dims: ['D'], coords: ['E'], config,
    });
  });
});
