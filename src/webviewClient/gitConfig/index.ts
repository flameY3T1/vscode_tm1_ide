// src/webviewClient/gitConfig/index.ts
// Bundle of the per-server Git settings form (commands/git/gitConfigPanel.ts).
// Until 2026-10 an inline script in the host's template literal.
import { getVsCodeApi } from '../_shared/vscodeApi';

type WebviewToHost = { type: 'save'; enabled: boolean; repoPath: string; parallelFetch: string; includeServerFolder: boolean };
interface GitInit { enabled?: boolean; repoPath?: string; includeServerFolder?: boolean; parallelFetch?: number }

const vscode = getVsCodeApi<WebviewToHost>();
const init = (window as unknown as { __GIT_INIT__?: GitInit }).__GIT_INIT__ ?? {};
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

input('git-enabled').checked = !!init.enabled;
input('git-repoPath').value = init.repoPath || '';
input('git-includeServerFolder').checked = init.includeServerFolder !== false;
input('git-parallelFetch').value = String(init.parallelFetch || 8);
input('git-save').addEventListener('click', () => {
  vscode.postMessage({
    type: 'save',
    enabled: input('git-enabled').checked,
    repoPath: input('git-repoPath').value,
    includeServerFolder: input('git-includeServerFolder').checked,
    parallelFetch: input('git-parallelFetch').value,
  });
});
