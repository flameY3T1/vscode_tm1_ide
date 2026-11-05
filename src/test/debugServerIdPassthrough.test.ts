import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guard for the connection identity of a debug session.
 *
 * The bug: `tm1.debugProcess` / `tm1.debugProcessFromTree` resolved the correct
 * `Tm1Config` and then dropped it — the launch configuration carried only
 * `processName` + `parameters`, so `Tm1DebugAdapter` fell back to the global
 * `getConfig()` of whichever server was connected LAST. Two profiles pointing at
 * the same gateway URL (different user, or different v12 database) are
 * indistinguishable below `serverId`, so the debugger silently ran against the
 * wrong connection.
 *
 * Every fixture below therefore uses ONE shared serverUrl for both profiles —
 * anything that resolves by URL cannot pass.
 */

const SHARED_URL = 'http://tm1-gateway:8010';

const CFG_A = {
  serverUrl: SHARED_URL, username: 'alice', password: 'pw-a',
  rejectUnauthorized: true, authType: 'Basic',
} as const;

const CFG_B = {
  serverUrl: SHARED_URL, username: 'bob', password: 'pw-b',
  rejectUnauthorized: true, authType: 'Basic',
} as const;

/** Stand-in for serverManager's `_connectedConfigs` map. */
const connected = new Map<string, unknown>();

vi.mock('../serverState/state', () => ({
  getServerConfig: (id: string) => connected.get(id),
  getConnectedIds: () => [...connected.keys()],
  getConnectedIdsRestored: async () => [...connected.keys()],
}));

// `getConfig()` is the legacy "last active server" path — the exact source of
// the bug. It always answers A here, so any test that expects B proves the
// serverId actually travelled.
vi.mock('../tm1Rest/client', () => ({
  getConfig: () => CFG_A,
}));

const clientCtorArgs: unknown[] = [];
vi.mock('../debug/tm1DebugClient', async (orig) => ({
  ...(await orig<typeof import('../debug/tm1DebugClient')>()),
  Tm1DebugClient: class {
    constructor(cfg: unknown) { clientCtorArgs.push(cfg); }
    isEnded() { return false; }
    startDebug() { return Promise.resolve({ id: 'dbg1', status: 'Paused' }); }
    getCallStack() { return Promise.resolve([]); }
  },
}));

vi.mock('../tm1Rest/logsApi', () => ({ fetchProcessMessageLog: vi.fn() }));

import { resolveLaunchConfig, Tm1DebugAdapter } from '../debug/tm1DebugAdapter';

beforeEach(() => {
  connected.clear();
  clientCtorArgs.length = 0;
});

/** Drives a `launch` request through the adapter and returns the DAP messages. */
function launch(args: Record<string, unknown>): { messages: any[]; adapter: Tm1DebugAdapter } {
  const adapter = new Tm1DebugAdapter();
  const messages: any[] = [];
  adapter.onDidSendMessage(m => messages.push(m));
  adapter.handleMessage({ type: 'request', seq: 7, command: 'launch', arguments: args });
  return { messages, adapter };
}

describe('resolveLaunchConfig — serverId decides, not the last active server', () => {
  it('picks the named profile even when another profile on the SAME url is active', () => {
    connected.set('srv-a', CFG_A);
    connected.set('srv-b', CFG_B);

    // Pre-fix the adapter called getConfig() → CFG_A regardless of the node clicked.
    expect(resolveLaunchConfig('srv-b')).toBe(CFG_B);
    expect(resolveLaunchConfig('srv-a')).toBe(CFG_A);
  });

  it('refuses a serverId that is not connected instead of falling back', () => {
    connected.set('srv-a', CFG_A);

    expect(() => resolveLaunchConfig('srv-gone')).toThrowError(/srv-gone/);
  });

  it('refuses to guess when several profiles are connected and no serverId is given', () => {
    connected.set('srv-a', CFG_A);
    connected.set('srv-b', CFG_B);

    expect(() => resolveLaunchConfig(undefined)).toThrowError(/serverId/);
  });

  it('resolves a hand-written launch.json without serverId when exactly one server is connected', () => {
    connected.set('srv-b', CFG_B);

    expect(resolveLaunchConfig(undefined)).toBe(CFG_B);
  });

  it('falls back to the legacy workspace-settings config when no profile is connected', () => {
    expect(resolveLaunchConfig(undefined)).toBe(CFG_A);
  });
});

describe('Tm1DebugAdapter launch request', () => {
  it('builds the debug client from the serverId in the launch arguments', () => {
    connected.set('srv-a', CFG_A);
    connected.set('srv-b', CFG_B);

    const { messages } = launch({ processName: 'P.Load', parameters: [], serverId: 'srv-b' });

    expect(clientCtorArgs).toEqual([CFG_B]);
    const response = messages.find(m => m.type === 'response' && m.command === 'launch');
    expect(response.success).toBe(true);
    expect(messages.some(m => m.type === 'event' && m.event === 'initialized')).toBe(true);
  });

  it('fails the launch — and opens no connection — when the serverId is unknown', () => {
    connected.set('srv-a', CFG_A);

    const { messages } = launch({ processName: 'P.Load', parameters: [], serverId: 'srv-gone' });

    expect(clientCtorArgs).toEqual([]);
    const response = messages.find(m => m.type === 'response' && m.command === 'launch');
    expect(response.success).toBe(false);
    expect(response.message).toMatch(/srv-gone/);
    expect(messages.some(m => m.type === 'event' && m.event === 'initialized')).toBe(false);
  });

  it('fails the launch when several servers are connected and no serverId was passed', () => {
    connected.set('srv-a', CFG_A);
    connected.set('srv-b', CFG_B);

    const { messages } = launch({ processName: 'P.Load', parameters: [] });

    expect(clientCtorArgs).toEqual([]);
    const response = messages.find(m => m.type === 'response' && m.command === 'launch');
    expect(response.success).toBe(false);
    expect(response.message).toMatch(/serverId/);
  });
});

/**
 * Source-level guard for the two producers. Executing the command callbacks
 * would require standing up the whole `registerProcessCommands` activation
 * graph; what has to stay true is narrow and structural: both `startDebugging`
 * launch objects must name a serverId, or the adapter is back to guessing.
 */
describe('registerProcessCommands passes serverId into startDebugging', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../activation/registerProcessCommands.ts'), 'utf8',
  );

  it('has exactly two startDebugging call sites', () => {
    expect(src.match(/startDebugging\(/g)?.length).toBe(2);
  });

  it('carries serverId in every startDebugging launch object', () => {
    // Slice from each call site to its closing `});` and require serverId inside.
    const sites = [...src.matchAll(/startDebugging\(undefined, \{/g)].map(m => {
      const rest = src.slice(m.index!);
      return rest.slice(0, rest.indexOf('});') + 3);
    });
    expect(sites).toHaveLength(2);
    for (const site of sites) {
      expect(site).toMatch(/\bserverId\b/);
    }
  });

  it('derives the serverId of the editor-driven command from the picked config, not its url', () => {
    // Reference identity against the connected-servers map — matching on
    // serverUrl would collapse two profiles sharing one gateway.
    expect(src).toMatch(/getConnectedIds\(\)\.find\(id => getServerConfig\(id\) === debugCfg\)/);
  });
});
