import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../tm1Client';
import { fetchViewDimAliases } from '../commands/cubeViewer/alias';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const CONFIG = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' };
const ok = (body: unknown) => ({ statusCode: 200, body: JSON.stringify(body) });

/**
 * The alias of a TITLE dimension never came along.
 *
 * `fetchViewDimAliases` only queried `Rows` and `Columns`. But a
 * title dimension carries its alias just the same — measured live on `Reporting/APS`
 * (11.8, 2026-08-23):
 *
 *   Rows:   Stations -> SITENAME
 *   Titles: Datenquellen -> Name, AllocCostCenters -> ALIAS_TEXT
 *
 * The query WITH `Titles/Subset(...)` answers 200 and delivers exactly that.
 * Without it, the Dimension Browser opened on raw element names for a title dimension,
 * while the grid next to it showed the alias.
 */
describe('title alias of a native view', () => {
  beforeEach(() => mockApi.mockReset());

  it('also queries Titles — in the path form', async () => {
    mockApi.mockResolvedValue(ok({ Rows: [], Columns: [], Titles: [] }));
    await fetchViewDimAliases('Reporting', 'APS', false, CONFIG as never);
    const url = decodeURIComponent(String(mockApi.mock.calls[0][1]));
    expect(url).toContain('Titles/Subset(');
    expect(url).not.toMatch(/Titles\(\$expand/);
  });

  it('reads out the alias of the title dimension', async () => {
    mockApi.mockResolvedValue(ok({
      Rows: [{ Subset: { Alias: 'SITENAME', Hierarchy: { Name: 'Stations' } } }],
      Columns: [{ Subset: { Alias: '', Hierarchy: { Name: 'Jahre' } } }],
      Titles: [
        { Subset: { Alias: 'Name', Hierarchy: { Name: 'Datenquellen' } } },
        { Subset: { Alias: 'ALIAS_TEXT', Hierarchy: { Name: 'AllocCostCenters' } } },
      ],
    }));
    const out = await fetchViewDimAliases('Reporting', 'APS', false, CONFIG as never);
    expect(out).toEqual({
      Stations: 'SITENAME',
      Datenquellen: 'Name',
      AllocCostCenters: 'ALIAS_TEXT',
    });
  });
});
