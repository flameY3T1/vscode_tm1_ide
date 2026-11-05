// Guard: the debug type in the manifest and in the code are the same string, and it is
// not `tm1`.
//
// VS Code keeps ONE adapter factory list per extension host, keyed only by the type
// (`extensionHostProcess.js`, `getAdapterDescriptorFactoryByType`).
// A second registration throws
//   a DebugAdapterDescriptorFactory can only be registered once per a type.
// A foreign extension with `debuggers[].type === 'tm1'` (measured 2026-09-19)
// thereby broke our complete activation: the
// registration sat in the argument of a single `context.subscriptions.push`,
// so the chore, cube, dimension, security and language registrations
// were skipped — visible as `command 'tm1.cubeOverview' not found`.
//
// No other gate catches a deviation: tsc does not see `package.json`, and
// a manifest with a foreign type is syntactically flawless. The bug only shows
// up on a machine on which the other extension is installed alongside.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TM1_DEBUG_TYPE } from '../debug/tm1DebugAdapter';

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
) as {
  contributes: {
    debuggers: Array<{ type: string; initialConfigurations?: Array<{ type: string }> }>;
  };
};

describe('debug type: manifest and code agree', () => {
  it('carries exactly one debugger, namely TM1_DEBUG_TYPE', () => {
    const types = manifest.contributes.debuggers.map(d => d.type);
    expect(types).toEqual([TM1_DEBUG_TYPE]);
  });

  it('names the same type in initialConfigurations', () => {
    for (const dbg of manifest.contributes.debuggers) {
      for (const cfg of dbg.initialConfigurations ?? []) {
        expect(cfg.type).toBe(TM1_DEBUG_TYPE);
      }
    }
  });

  it('does not claim the `tm1` taken by someone else', () => {
    expect(TM1_DEBUG_TYPE).not.toBe('tm1');
  });

  it('sets a type literal instead of the constant in no launch call', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../activation/registerProcessCommands.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/type:\s*['"]tm1/);
    expect(src).not.toMatch(/registerDebugAdapterDescriptorFactory\(\s*['"]/);
  });
});
