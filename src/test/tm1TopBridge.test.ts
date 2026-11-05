import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Tm1TopBridge } from '../tm1top/bridge';

const directory = mkdtempSync(join(tmpdir(), 'tm1top-test-'));
let next = 0;
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function bridge(script: string, timeoutMs = 3000): Tm1TopBridge {
  const file = join(directory, `${next++}.cjs`);
  writeFileSync(file, `console.log = text => require('fs').writeSync(1, String(text) + '\\n');\n${script}`);
  return new Tm1TopBridge({ helperPath: process.execPath, helperArgs: [file], bin64Dir: 'bin', timeoutMs });
}
describe('TM1 Top child process protocol', () => {
  it.each(['verify-failed', 'kill-rejected'])('preserves %s without leaking helper error text', async reason => {
    const b = bridge(`console.log(JSON.stringify({error:'private-password',reason:${JSON.stringify(reason)}}));process.exitCode=2`);
    try {
      await expect(b.kill('host', 'server', '42', 'admin', 'pw')).rejects.toMatchObject({ reason, message: reason });
    } finally { b.dispose(); }
  });
  it.each(['verifyAdmin', 'kill'] as const)('does not apply the polling timeout to %s', async operation => {
    const b = bridge('setTimeout(()=>console.log(JSON.stringify({verified:true,killed:true})),200)', 50);
    try {
      if (operation === 'kill') await expect(b.kill('host', 'server', '42', 'admin', 'pw')).resolves.toBeUndefined();
      else await expect(b.verifyAdmin('host', 'server', 'admin', 'pw')).resolves.toBe(true);
    } finally { b.dispose(); }
  });
  it('rejects malformed requests and nonpositive timeouts before spawning', async () => {
    expect(() => bridge('', 0)).toThrow('invalid-request');
    const b = bridge('throw new Error("must not spawn")');
    await expect(b.kill('host', 'server', '42x', 'admin', 'pw')).rejects.toHaveProperty('reason', 'invalid-request');
    await expect(b.verifyAdmin('host', 'server', 'admin', 'x'.repeat(4097))).rejects.toHaveProperty('reason', 'invalid-request');
    await expect(b.getState('bad\0host', 'server')).rejects.toHaveProperty('reason', 'invalid-request');
  });
  it('bounds helper output', async () => {
    const b = bridge('console.log("x".repeat(5*1024*1024))');
    await expect(b.getState('host', 'server')).rejects.toHaveProperty('reason', 'output-too-large');
  });
  it('reads rows and empty states', async () => {
    expect(await bridge('console.log(JSON.stringify({rows:["1\\tTh:Pseudo\\t-\\tIdle..."]}))').getState('host', 'server'))
      .toEqual(['1\tTh:Pseudo\t-\tIdle...']);
    expect(await bridge('console.log(JSON.stringify({rows:[]}))').getState('host', 'server')).toEqual([]);
  });
  it('enumerates servers', async () => {
    expect(await bridge('console.log(JSON.stringify({servers:["SALES"]}))').enumServers('host')).toEqual(['SALES']);
  });
  it('rejects malformed JSON, invalid schema and nonzero exit', async () => {
    for (const script of ['console.log("bad")', 'console.log(JSON.stringify({rows:[1]}))', 'console.log(JSON.stringify({rows:[]}));process.exitCode=2']) {
      await expect(bridge(script).getState('host', 'server')).rejects.toHaveProperty('name', 'Tm1TopBridgeError');
    }
  });
  it('retains native error codes without forwarding native error text', async () => {
    await expect(bridge('console.log(JSON.stringify({error:"secret",code:84}));process.exitCode=2').getState('host', 'server'))
      .rejects.toMatchObject({ reason: 'native-error', code: 84, message: 'native-error' });
  });
  it('times out and permits another process after failure', async () => {
    const b = bridge('setTimeout(()=>console.log(JSON.stringify({rows:[]})),10000)', 100);
    await expect(b.getState('host', 'server')).rejects.toHaveProperty('reason', 'timeout');
    await expect(b.getState('host', 'server')).rejects.toHaveProperty('reason', 'timeout');
    b.dispose();
  });
  it.each(['getState', 'kill'] as const)('guards concurrent calls and stops %s on disposal', async operation => {
    const b = bridge('setTimeout(()=>{},10000)');
    const first = operation === 'kill' ? b.kill('host', 'server', '42', 'admin', 'pw') : b.getState('host', 'server');
    const rejection = expect(first).rejects.toHaveProperty('reason', 'disposed');
    await expect(b.getState('host', 'server')).rejects.toHaveProperty('reason', 'in-flight');
    b.dispose();
    await rejection;
    await expect(b.getState('host', 'server')).rejects.toHaveProperty('reason', 'disposed');
  });
  it('sends credentials only through stdin, including kill re-verification credentials', async () => {
    const b = bridge(`const input=require('fs').readFileSync(0,'utf8');{
      const v=JSON.parse(input);const safe=!process.argv.includes('private-password') && v.password==='private-password' && v.username==='admin';
      console.log(JSON.stringify(process.argv.at(-1)==='kill'?{killed:safe&&v.threadId==='42'}:{verified:safe}));
    }`);
    expect(await b.verifyAdmin('host', 'server', 'admin', 'private-password')).toBe(true);
    await expect(b.kill('host', 'server', '42', 'admin', 'private-password')).resolves.toBeUndefined();
    b.dispose();
  });
});
