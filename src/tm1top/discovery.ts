import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';

export class Tm1TopUnavailable extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'Tm1TopUnavailable';
  }
}
export interface NativeRuntimeOptions {
  nativeApiPath?: string;
  extensionPath: string;
  storagePath: string;
}
export interface DiscoveryDependencies {
  platform: string;
  arch: string;
  env: NodeJS.ProcessEnv;
  exists(file: string): Promise<boolean>;
  read(file: string): Promise<Buffer>;
  mkdir(directory: string): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
  remove(file: string): Promise<void>;
  compile(compiler: string, args: string[]): Promise<void>;
}
const defaults: DiscoveryDependencies = {
  platform: process.platform, arch: process.arch, env: process.env,
  exists: async file => { try { return (await fs.stat(file)).isFile(); } catch { return false; } },
  read: file => fs.readFile(file), mkdir: directory => fs.mkdir(directory, { recursive: true }),
  rename: (from, to) => fs.rename(from, to), remove: file => fs.rm(file, { force: true }),
  compile: (compiler, args) => new Promise((resolve, reject) => {
    execFile(compiler, args, { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }, error => {
      if (error) reject(new Tm1TopUnavailable('compile-failed')); else resolve();
    });
  }),
};
const compilations = new Map<string, Promise<void>>();

export async function resolveNativeRuntime(options: NativeRuntimeOptions,
  dependencies: DiscoveryDependencies = defaults): Promise<{ bin64Dir: string; helperPath: string }> {
  const d = dependencies;
  if (d.platform !== 'win32' || d.arch !== 'x64') throw new Tm1TopUnavailable('unsupported-platform');
  const configured = options.nativeApiPath?.trim();
  const dirOf = (p: string) => path.win32.basename(p).toLowerCase() === 'tm1api.dll' ? path.win32.dirname(p) : p;
  // Installation layouts differ: the server and PA Local put bin64 under ibm\cognos\, older
  // standalone installs directly under ibm\. Probe both instead of naming only one.
  const candidates = configured ? [dirOf(configured), path.win32.join(dirOf(configured), 'bin64')] : [
    path.win32.join(d.env.ProgramFiles ?? 'C:\\Program Files', 'ibm', 'cognos', 'tm1_64', 'bin64'),
    path.win32.join(d.env.ProgramFiles ?? 'C:\\Program Files', 'ibm', 'tm1_64', 'bin64'),
    path.win32.join(d.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'ibm', 'cognos', 'tm1_64', 'bin64'),
  ];
  let bin64Dir = '';
  for (const candidate of candidates) {
    if (await d.exists(path.win32.join(candidate, 'tm1api.dll'))) { bin64Dir = candidate; break; }
  }
  if (!bin64Dir) throw new Tm1TopUnavailable('dll-missing');
  // The keystore is not required up front: an admin server without SSL never reads it. The helper
  // uses it when present and reports 'keystore-missing' only if the native call then fails.
  const framework = path.win32.join(d.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  if (!await d.exists(path.win32.join(framework, 'clr.dll'))) throw new Tm1TopUnavailable('dotnet-missing');
  const resources = path.join(options.extensionPath, 'resources', 'native', 'win32-x64');
  const packaged = path.join(resources, 'tm1top.exe');
  if (await d.exists(packaged)) return { bin64Dir, helperPath: packaged };
  const compiler = path.win32.join(framework, 'csc.exe');
  const source = path.join(resources, 'Tm1TopHelper.cs');
  let sourceBytes: Buffer;
  try { sourceBytes = await d.read(source); } catch { throw new Tm1TopUnavailable('source-missing'); }
  const hash = createHash('sha256').update(sourceBytes).digest('hex').slice(0, 20);
  const cache = path.join(options.storagePath, 'tm1top', hash);
  const helperPath = path.join(cache, 'tm1top.exe');
  let pending = compilations.get(helperPath);
  if (!pending) {
    pending = (async () => {
      if (await d.exists(helperPath)) return;
      if (!await d.exists(compiler)) throw new Tm1TopUnavailable('compiler-missing');
      try { await d.mkdir(cache); } catch { throw new Tm1TopUnavailable('cache-unwritable'); }
      const temporary = path.join(cache, `tm1top-${process.pid}-${Date.now()}.exe`);
      try {
        await d.compile(compiler, ['-nologo', '-platform:x64', '-r:System.Web.Extensions.dll', `-out:${temporary}`, source]);
        if (!await d.exists(temporary)) throw new Tm1TopUnavailable('compile-failed');
        await d.rename(temporary, helperPath);
      } catch { throw new Tm1TopUnavailable('compile-failed'); }
      finally { try { await d.remove(temporary); } catch { /* Best-effort temporary cleanup. */ } }
    })();
    compilations.set(helperPath, pending);
  }
  try { await pending; } finally { compilations.delete(helperPath); }
  return { bin64Dir, helperPath };
}
