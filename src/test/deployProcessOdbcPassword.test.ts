import { it, expect, vi } from 'vitest';

const getProcess = vi.hoisted(() => vi.fn());
vi.mock('../tm1Rest/processApi', () => ({ getProcess, PROCESS_FULL_SELECT: 'Name' }));

import { readProcessForCopy } from '../commands/deploy/copyOne';

// Live 11.8 → 11.8 (2026-10-27): the ciphertext is bound to its server; the
// target re-encrypts it as plaintext, so carrying it gives a wrong password.
it('leaves the ODBC password out of a cross-server copy and says so', async () => {
  getProcess.mockResolvedValue({
    DataSource: { Type: 'ODBC', dataSourceNameForServer: 'dsn', userName: 'u', password: 'CIPHER' },
  });
  const copy = await readProcessForCopy({} as never, 'p');
  expect(copy.dataSource).toEqual({ Type: 'ODBC', dataSourceNameForServer: 'dsn', userName: 'u' });
  expect(copy.odbcPasswordDropped).toBe(true);
});

it('reports nothing for a source without a password', async () => {
  getProcess.mockResolvedValue({ DataSource: { Type: 'ASCII', dataSourceNameForServer: 'f.csv' } });
  const copy = await readProcessForCopy({} as never, 'p');
  expect(copy.odbcPasswordDropped).toBe(false);
  expect(copy.dataSource).toEqual({ Type: 'ASCII', dataSourceNameForServer: 'f.csv' });
});
