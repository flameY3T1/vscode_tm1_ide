import * as vscode from 'vscode';

/**
 * Lazy OutputChannels, merged by name.
 *
 * Three problems at once, all measured on 2026-08-30:
 *
 * 1. **Side effect on module load.** Five modules called
 *    `vscode.window.createOutputChannel(...)` at module level. `extension.ts`
 *    imports them in `activate()`, so all five channels came into existence on every
 *    activation — even for a user who never touches Git, chores and threads.
 *    The same forces every test that imports such a module to
 *    instantiate the VS Code API.
 * 2. **Never disposed.** None of the five was put into `context.subscriptions`, none
 *    was cleaned up in `deactivate()`. After five "Developer: Reload Window"
 *    there were up to 25 TM1 entries in the Output dropdown.
 * 3. **Two channels with the same name.** `commands/git/index.ts` and
 *    `commands/git/mirror.ts` both created a "TM1 Git"; the user could
 *    not know which one was the right one, and the mirror lines ended up in the
 *    other. Merging by name solves this without coordination between
 *    the modules: the same name is the same channel.
 *
 * The proxy facade comes from `commands/processEditor/deploy.ts` — it allows
 * `const out = outputChannel('X')` at module level without anything being
 * created. Only the first `.appendLine`/`.show` access creates the channel.
 */
const _channels = new Map<string, vscode.LogOutputChannel>();

function realChannel(name: string): vscode.LogOutputChannel {
  let ch = _channels.get(name);
  if (!ch) {
    // `log: true`: timestamped lines and a user-settable level (Developer: Set Log Level).
    ch = vscode.window.createOutputChannel(name, { log: true });
    _channels.set(name, ch);
  }
  return ch;
}

/**
 * A channel that comes into existence only on first access. Same name = same channel.
 * Safe to call at module level.
 */
export function outputChannel(name: string): vscode.LogOutputChannel {
  return new Proxy({} as vscode.LogOutputChannel, {
    get: (_t, prop) => {
      const ch = realChannel(name);
      const v = Reflect.get(ch, prop, ch);
      return typeof v === 'function' ? v.bind(ch) : v;
    },
  });
}

/** Close all created channels. Belongs in `deactivate()`. */
export function disposeAllOutputChannels(): void {
  for (const ch of _channels.values()) {
    try { ch.dispose(); } catch { /* best effort — a dead channel is no reason to throw */ }
  }
  _channels.clear();
}
