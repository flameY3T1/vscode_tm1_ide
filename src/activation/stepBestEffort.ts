// src/activation/stepBestEffort.ts
//
// An activation step that is allowed to fail.
//
// Four migrations ran until 2026-09-20 as bare `await`s BEFORE the first
// command registration: `initHealthStore` (removed since 2026-09-23), `migrateLegacyPasswords`,
// `migrateGlobalGitSettings`, `migrateProcessGroupSettings`. If one of them throws
// — SecretStorage unreachable, broken `globalState` — `activate`
// aborts, and NO command is registered. This becomes visible as
//   command 'tm1.cubeOverview' not found
// that is, exactly the message that already cost half an
// activation once on 2026-09-19 (`740db81c`) — there one level deeper.
//
// Why still `await` and not `void … .catch()`: the order matters
// here. `migrateLegacyPasswords` moves passwords into the
// SecretStorage, and `restoreConnectedServers` reads them right afterwards.
// Decoupled, that would be a race for credentials — a new bug for
// an old one. What this helper changes is only the CONSEQUENCE of a failure:
// the step is skipped, the extension keeps running.
//
// A failed migration means at worst: enter passwords once more,
// set the Git profile once more. A dead extension means: nothing
// works any more.
import { logBestEffort } from '../providers/bestEffortLog';

export async function stepBestEffort(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    logBestEffort('Activation', name, err);
  }
}
