import { describe, it, expect, vi } from 'vitest';
import { resolveNativeRuntime, DiscoveryDependencies } from '../tm1top/discovery';

const options = { extensionPath: '/extension', storagePath: '/storage', nativeApiPath: 'C:\\TM1\\bin64' };
function deps(missing = ''): DiscoveryDependencies {
  return {
    platform: 'win32', arch: 'x64', env: {},
    exists: async file => !missing || !file.endsWith(missing),
    read: async () => Buffer.from('source'), mkdir: async () => undefined,
    rename: async () => undefined, remove: async () => undefined,
    compile: vi.fn(async () => undefined),
  };
}
describe('TM1 Top native runtime discovery', () => {
  it.each(['linux', 'darwin'])('rejects %s extension hosts', async platform => {
    await expect(resolveNativeRuntime(options, { ...deps(), platform })).rejects.toHaveProperty('reason', 'unsupported-platform');
  });
  it('rejects non-x64 hosts', async () => {
    await expect(resolveNativeRuntime(options, { ...deps(), arch: 'arm64' })).rejects.toHaveProperty('reason', 'unsupported-platform');
  });
  it.each([['tm1api.dll', 'dll-missing'], ['clr.dll', 'dotnet-missing']])('names missing %s', async (file, reason) => {
    await expect(resolveNativeRuntime(options, deps(file))).rejects.toMatchObject({ name: 'Tm1TopUnavailable', reason });
  });
  it.each(['ibmtm1.kdb', 'ibmtm1.sth'])('accepts a bin64 directory without %s', async file => {
    expect((await resolveNativeRuntime(options, deps(file))).bin64Dir).toBe('C:\\TM1\\bin64');
  });
  it('descends into bin64 when the parent directory was configured', async () => {
    const d = deps();
    d.exists = async file => !file.endsWith('tm1api.dll') || file.includes('bin64\\tm1api.dll');
    expect((await resolveNativeRuntime({ ...options, nativeApiPath: 'E:\\NEU' }, d)).bin64Dir).toBe('E:\\NEU\\bin64');
  });
  it('accepts a DLL path and prefers the packaged executable', async () => {
    const d = deps();
    const result = await resolveNativeRuntime({ ...options, nativeApiPath: 'C:\\TM1\\bin64\\tm1api.dll' }, d);
    expect(result.bin64Dir).toBe('C:\\TM1\\bin64');
    expect(result.helperPath).toMatch(/resources.*tm1top.exe$/);
    expect(d.compile).not.toHaveBeenCalled();
  });
  it('prefers the cognos installation layout when nothing is configured', async () => {
    expect((await resolveNativeRuntime({ ...options, nativeApiPath: undefined }, deps())).bin64Dir)
      .toBe('C:\\Program Files\\ibm\\cognos\\tm1_64\\bin64');
  });
  it('falls back to the standalone layout when cognos has no DLL', async () => {
    const d = deps();
    d.exists = async file => !(file.includes('cognos') && file.endsWith('tm1api.dll'));
    expect((await resolveNativeRuntime({ ...options, nativeApiPath: undefined }, d)).bin64Dir)
      .toBe('C:\\Program Files\\ibm\\tm1_64\\bin64');
  });
  it('names a missing compiler', async () => {
    const d = deps(); d.exists = async file => !file.endsWith('tm1top.exe') && !file.endsWith('csc.exe');
    await expect(resolveNativeRuntime(options, d)).rejects.toHaveProperty('reason', 'compiler-missing');
  });
  it('compiles once for concurrent callers and reuses the source cache', async () => {
    const d = deps(); let compiled = false;
    d.exists = async file => !file.endsWith('.exe') || file.endsWith('csc.exe') || (compiled && file.startsWith('/storage'));
    d.compile = vi.fn(async () => { compiled = true; });
    const [a, b] = await Promise.all([resolveNativeRuntime(options, d), resolveNativeRuntime(options, d)]);
    expect(a).toEqual(b);
    d.exists = async file => !file.endsWith('csc.exe') && (!file.endsWith('.exe') || file.startsWith('/storage'));
    await resolveNativeRuntime(options, d);
    expect(d.compile).toHaveBeenCalledTimes(1);
    expect(d.compile).toHaveBeenCalledWith(expect.stringContaining('csc.exe'), expect.arrayContaining(['-platform:x64', '-r:System.Web.Extensions.dll']));
  });
  it('names missing helper sources and compile failures', async () => {
    const d = deps(); d.exists = async file => !file.endsWith('.exe') || file.endsWith('csc.exe');
    d.read = async () => { throw new Error('missing'); };
    await expect(resolveNativeRuntime(options, d)).rejects.toHaveProperty('reason', 'source-missing');
    d.read = async () => Buffer.from('source');
    await expect(resolveNativeRuntime(options, d)).rejects.toHaveProperty('reason', 'compile-failed');
  });
  it('removes partial compiler output and retries without caching failure', async () => {
    const d = deps();
    const files = new Set<string>();
    d.exists = async file => !file.endsWith('.exe') || file.endsWith('csc.exe') || files.has(file);
    d.compile = vi.fn(async (_compiler: string, args: string[]) => {
      files.add(args.find(arg => arg.startsWith('-out:'))!.slice(5));
      throw new Error('compiler failed after creating a partial executable');
    });
    d.rename = vi.fn(async () => undefined);
    d.remove = vi.fn(async file => { files.delete(file); });
    await expect(resolveNativeRuntime(options, d)).rejects.toHaveProperty('reason', 'compile-failed');
    expect(files.size).toBe(0);
    expect(d.rename).not.toHaveBeenCalled();
    await expect(resolveNativeRuntime(options, d)).rejects.toHaveProperty('reason', 'compile-failed');
    expect(d.compile).toHaveBeenCalledTimes(2);
    expect(d.remove).toHaveBeenCalledTimes(2);
  });
});
