export type ServerDisposer = (serverUrl: string) => void;

interface Entry {
  readonly name: string;
  readonly dispose: ServerDisposer;
}

const _entries: Entry[] = [];

export function registerServerDisposer(name: string, dispose: ServerDisposer): void {
  _entries.push({ name, dispose });
}

export function disposeAllForServer(serverUrl: string): void {
  for (const { name, dispose } of _entries) {
    try {
      dispose(serverUrl);
    } catch (e) {
      console.error(`[serverDispose] ${name} failed for ${serverUrl}:`, e);
    }
  }
}

export function _getRegistryForTest(): ReadonlyArray<Entry> {
  return _entries;
}

export function _clearRegistryForTest(): void {
  _entries.length = 0;
}
