import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Two profiles may share a serverUrl (other user, other v12 database). A panel
 * manager that keys its panels by the URL alone reveals A's panel when B opens
 * the same object, and that panel keeps sending with A's config — saves, cell
 * writes and process runs then go out as A or into A's database (readiness
 * review 2026-11-03, F4). These managers carry `identityTag(cfg)` in the key;
 * this scan keeps a refactor from dropping it again.
 *
 * Not on the list, deliberately: the read-only panels (overviews, logs,
 * statistics). The process editor builds its key in `state.ts#sessionScope`.
 */
const MANAGERS = [
  'src/commands/cubeViewer/manager.ts',
  'src/commands/rule/ruleEditor.ts',
  'src/commands/chore/choreEditor.ts',
  'src/commands/dimension/dimensionEditor.ts',
  'src/commands/dimension/dimensionBrowser.ts',
  'src/commands/processCoverage.ts',
  'src/commands/transactionLog.ts',
  'src/commands/threads.ts',
  'src/commands/security/cellSecurityBuilderWebview.ts',
  'src/webviews/reorderDimsWebview.ts',
  'src/webviews/findReplaceWebview.ts',
  'src/commands/processEditor/state.ts',
];

const root = path.resolve(__dirname, '../..');

describe('panel keys carry the session identity, not just the URL', () => {
  it.each(MANAGERS)('%s builds its panel key with identityTag(...)', (file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    expect(text).toMatch(/identityTag\(\s*\w+\s*\)/);
  });
});
