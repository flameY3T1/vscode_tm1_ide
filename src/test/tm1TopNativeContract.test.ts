import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

// Native cancellation must never be exercised against a real server by tests.
// Pin the reviewed authorization sequence independently of the fake-helper tests:
// a prior verifyAdmin process cannot authorize a fresh kill connection.
const source = readFileSync(path.resolve(__dirname, '../../resources/native/win32-x64/Tm1TopHelper.cs'), 'utf8');
const run = source.slice(source.indexOf('static object Run('), source.indexOf('static int Main('));

describe('TM1 Top native authorization contract', () => {
  it('does not forward potentially sensitive native exception text to stdout', () => {
    const main = source.slice(source.indexOf('static int Main('));
    expect(main).not.toContain('ex.Message');
    expect(main).toContain('code = ex.Code');
  });

  it('verifies encrypted credentials on the same connection before allowing cancellation', () => {
    const connect = run.indexOf('conn = candidate;');
    const verify = run.indexOf('TM1TopVerifyAdmin(pool, conn, TM1ValStringW(pool, username, 0), TM1ValStringEncryptW(pool, password, 0))');
    const booleanCheck = run.indexOf('Check(h, verified) == BoolType && TM1ValBoolGet(h, verified) != 0');
    const deny = run.indexOf('if (!allowed) throw');
    const kill = run.indexOf('TM1TopKillTiProcessString(pool, conn, TM1ValStringW(pool, threadId, 0))');
    expect(connect).toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(connect);
    expect(booleanCheck).toBeGreaterThan(verify);
    expect(deny).toBeGreaterThan(booleanCheck);
    expect(kill).toBeGreaterThan(deny);
    expect(run.match(/TM1TopKillTiProcessString\(/g)).toHaveLength(1);
    expect(run.slice(verify, kill)).not.toMatch(/conn\s*=/);
  });

  it('uses the recovered pool-first signatures and disconnects before releasing native values', () => {
    expect(source).toContain('TM1TopVerifyAdmin(IntPtr pool, IntPtr conn, IntPtr user, IntPtr encryptedPassword)');
    expect(source).toContain('TM1TopKillTiProcessString(IntPtr pool, IntPtr conn, IntPtr threadId)');
    const cleanup = run.slice(run.lastIndexOf('// Keep the connection'));
    expect(cleanup.indexOf('TM1SystemServerDisconnect(pool, conn)')).toBeGreaterThanOrEqual(0);
    expect(cleanup.indexOf('TM1ValPoolDestroy(pool)')).toBeGreaterThan(cleanup.indexOf('TM1SystemServerDisconnect(pool, conn)'));
    expect(cleanup.indexOf('TM1SystemClose(h)')).toBeGreaterThan(cleanup.indexOf('TM1ValPoolDestroy(pool)'));
  });
});
