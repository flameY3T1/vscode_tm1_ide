const _cache = new Map<string, boolean>();

export function setBedrockInstalled(serverId: string, installed: boolean): void {
  _cache.set(serverId, installed);
}

export function isBedrockInstalled(serverId: string): boolean | undefined {
  return _cache.get(serverId);
}
