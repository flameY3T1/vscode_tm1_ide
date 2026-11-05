import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerServerDisposer,
  disposeAllForServer,
  _getRegistryForTest,
  _clearRegistryForTest,
} from '../../serverState/serverDisposeRegistry';

describe('serverDisposeRegistry', () => {
  beforeEach(() => {
    _clearRegistryForTest();
  });

  it('register pushes entry', () => {
    registerServerDisposer('a', () => undefined);
    expect(_getRegistryForTest()).toHaveLength(1);
    expect(_getRegistryForTest()[0].name).toBe('a');
  });

  it('disposeAllForServer calls every registered disposer with serverUrl', () => {
    const calls: Array<[string, string]> = [];
    registerServerDisposer('m1', (url) => calls.push(['m1', url]));
    registerServerDisposer('m2', (url) => calls.push(['m2', url]));
    disposeAllForServer('http://srv:8001');
    expect(calls).toEqual([
      ['m1', 'http://srv:8001'],
      ['m2', 'http://srv:8001'],
    ]);
  });

  it('swallows thrown error and continues with remaining disposers', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const calls: string[] = [];
    registerServerDisposer('boom', () => { throw new Error('nope'); });
    registerServerDisposer('after', () => calls.push('after'));
    disposeAllForServer('http://srv');
    expect(calls).toEqual(['after']);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('[serverDispose] boom failed');
    errSpy.mockRestore();
  });

  it('preserves registration order', () => {
    const order: string[] = [];
    registerServerDisposer('first', () => order.push('first'));
    registerServerDisposer('second', () => order.push('second'));
    registerServerDisposer('third', () => order.push('third'));
    disposeAllForServer('x');
    expect(order).toEqual(['first', 'second', 'third']);
  });
});
