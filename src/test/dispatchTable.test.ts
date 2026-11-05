import { describe, it, expect, vi } from 'vitest';
import { dispatch, type DispatchTable } from '../webviews/dispatchTablePure';

type Msg =
  | { type: 'ping'; id: number }
  | { type: 'load'; q: string };

interface Ctx {
  post: (s: string) => void;
}

describe('dispatch (webview message dispatch table)', () => {
  it('routes to the matching handler with narrowed msg + injected ctx', async () => {
    const post = vi.fn();
    const table: DispatchTable<Msg, Ctx> = {
      ping: (msg, ctx) => { ctx.post(`pong:${msg.id}`); },
      load: (msg, ctx) => { ctx.post(`data:${msg.q}`); },
    };

    await dispatch(table, { type: 'ping', id: 7 }, { post });
    await dispatch(table, { type: 'load', q: 'abc' }, { post });

    expect(post).toHaveBeenNthCalledWith(1, 'pong:7');
    expect(post).toHaveBeenNthCalledWith(2, 'data:abc');
  });

  it('awaits async handlers', async () => {
    const order: string[] = [];
    const table: DispatchTable<Msg, Ctx> = {
      ping: async () => {
        await Promise.resolve();
        order.push('handler');
      },
      load: () => { /* noop */ },
    };

    await dispatch(table, { type: 'ping', id: 1 }, { post: () => {} });
    order.push('after');

    expect(order).toEqual(['handler', 'after']);
  });

  it('is a no-op when no handler is registered for the message type', async () => {
    const post = vi.fn();
    const table = { ping: (_m: Msg, ctx: Ctx) => ctx.post('x') } as unknown as DispatchTable<Msg, Ctx>;

    // 'load' has no handler → must not throw, must not call post
    await expect(
      dispatch(table, { type: 'load', q: 'z' }, { post }),
    ).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('propagates handler errors to the caller', async () => {
    const table: DispatchTable<Msg, Ctx> = {
      ping: () => { throw new Error('boom'); },
      load: () => {},
    };

    await expect(
      dispatch(table, { type: 'ping', id: 1 }, { post: () => {} }),
    ).rejects.toThrow('boom');
  });
});
