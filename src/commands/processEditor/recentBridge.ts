// Lets callers that open an editor via `openPanel.openProcess` /
// `RuleEditorManager.open` — webview panels (Find/Replace, Consistency
// Normalizer, …) and the process editor's own Ctrl+click navigation — record it
// in the "Recently opened" list, without importing the activation layer /
// RecentTreeProvider directly.
//
// The activation layer (which owns RecentTreeProvider + server-name resolution)
// registers the recorder once at startup via `setRecentRecorder`; callers then
// invoke `recordProcessOpen` / `recordRuleOpen` after opening. If no recorder is
// registered (e.g. in tests), the call is a no-op.

type RecentKind = 'process' | 'rule';
type Recorder = (kind: RecentKind, serverId: string, name: string) => void;

let recorder: Recorder | undefined;

export function setRecentRecorder(fn: Recorder): void {
  recorder = fn;
}

function record(kind: RecentKind, serverId: string | undefined, name: string): void {
  if (!recorder || !serverId || !name) { return; }
  recorder(kind, serverId, name);
}

export function recordProcessOpen(serverId: string | undefined, name: string): void {
  record('process', serverId, name);
}

export function recordRuleOpen(serverId: string | undefined, name: string): void {
  record('rule', serverId, name);
}
