import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { importHelperOutputs } from '../../../commands/tiTest/capture';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

const cfg = {} as Tm1Config;
const dataDir = path.join('/tmp', 'test', 'data');

/** Build an injectable io whose reader serves the given file→content map,
 *  and whose writer records everything written. */
function makeIo(served: Record<string, string>) {
  const written = new Map<string, string>();
  return {
    written,
    io: {
      read: async (_cfg: Tm1Config, fileName: string) => {
        const content = served[fileName];
        return content !== undefined
          ? { found: true, content }
          : { found: false, content: '' };
      },
      write: async (filePath: string, content: string) => {
        written.set(filePath, content);
      },
    },
  };
}

describe('importHelperOutputs', () => {
  it('deletes each server file only after its local copy landed', async () => {
    const removed: string[] = [];
    const io = {
      read: async (_c: Tm1Config, f: string) => ({ found: true, content: f }),
      write: async (p: string) => {
        if (p.endsWith('_source.txt')) throw new Error('disk full');
      },
      remove: async (_c: Tm1Config, f: string) => {
        removed.push(f);
      },
    };
    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', true, io);
    expect(landed).toEqual(['MyProc_log.txt']);
    expect(removed).toEqual(['TM1ProcessError_MyProc_output.log']);
  });

  it('reads the TM1ProcessError_*.log op-log and writes plain <base>_log.txt into data/', async () => {
    const { written, io } = makeIo({ 'TM1ProcessError_MyProc_output.log': 'CellPutN,cube,e1,e2,42\n' });

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', false, io);

    expect(landed).toEqual(['MyProc_log.txt']);
    expect(written.get(path.join(dataDir, 'MyProc_log.txt'))).toBe('CellPutN,cube,e1,e2,42\n');
    // No source requested/written when hasSourceVars is false.
    expect(written.has(path.join(dataDir, 'MyProc_source.txt'))).toBe(false);
  });

  it('also imports the source dump (TM1ProcessError_*_source.log → <base>_source.txt)', async () => {
    const { written, io } = makeIo({
      'TM1ProcessError_MyProc_output.log': 'log-rows\n',
      'TM1ProcessError_MyProc_source.log': 'row1\nrow2\n',
    });

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', true, io);

    expect(landed).toEqual(['MyProc_log.txt', 'MyProc_source.txt']);
    expect(written.get(path.join(dataDir, 'MyProc_source.txt'))).toBe('row1\nrow2\n');
  });

  it('strips the leading UTF-8 BOM that ASCIIOutput emits', async () => {
    const { written, io } = makeIo({ 'TM1ProcessError_MyProc_output.log': '﻿"cube","e1","1"\n' });

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', false, io);

    expect(landed).toEqual(['MyProc_log.txt']);
    expect(written.get(path.join(dataDir, 'MyProc_log.txt'))).toBe('"cube","e1","1"\n');
  });

  it('returns empty and writes nothing when the log is missing (fallback path)', async () => {
    const { written, io } = makeIo({});

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', true, io);

    expect(landed).toEqual([]);
    expect(written.size).toBe(0);
  });

  it('does NOT report a file as landed when the LOCAL write fails (routes to fallback)', async () => {
    // Reader finds the op-log, but the local fs write rejects (disk full /
    // permission / lock). The file never hit disk, so it must NOT be in landed[]
    // — otherwise the caller shows a success toast and skips the manual-copy
    // fallback warning.
    const io = {
      read: async (_cfg: Tm1Config, fileName: string) =>
        fileName === 'TM1ProcessError_MyProc_output.log'
          ? { found: true, content: 'CellPutN,cube,e1,e2,42\n' }
          : { found: false, content: '' },
      write: async () => {
        throw new Error('ENOSPC: no space left on device');
      },
    };

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', false, io);

    // Empty landed[] → caller's `landed.includes(<base>_log.txt)` is false →
    // manual-copy fallback warning fires.
    expect(landed).toEqual([]);
  });

  it('reports only the files whose write succeeded on a PARTIAL failure', async () => {
    // op-log writes fine; source dump write rejects. Only the log lands.
    const io = {
      read: async (_cfg: Tm1Config, fileName: string) =>
        fileName === 'TM1ProcessError_MyProc_output.log'
          ? { found: true, content: 'log-rows\n' }
          : { found: true, content: 'row1\nrow2\n' },
      write: async (filePath: string) => {
        if (filePath === path.join(dataDir, 'MyProc_source.txt')) {
          throw new Error('EACCES: permission denied');
        }
      },
    };

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', true, io);

    expect(landed).toEqual(['MyProc_log.txt']);
  });

  it('imports an EMPTY log as a valid no-writes baseline (not a fallback)', async () => {
    // A process that logs no writes (pure computation / no datasource) produces
    // an empty ASCIIOutputOpen-created log. That's a clean empty test, not a miss.
    const { written, io } = makeIo({ 'TM1ProcessError_MyProc_output.log': '' });

    const landed = await importHelperOutputs(cfg, dataDir, 'MyProc', false, io);

    expect(landed).toEqual(['MyProc_log.txt']);
    expect(written.get(path.join(dataDir, 'MyProc_log.txt'))).toBe('');
  });
});
