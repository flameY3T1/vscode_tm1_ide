import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

import { buildAddServerBody } from '../../commands/serverConfig/addServerBody';
import { buildAddServerL10n } from '../../commands/serverConfig/addServerL10n';

// Note (Task 7): the brief sketched a `getAddServerBody(webview, extensionUri, t)`
// signature mirroring `getCubeViewerBody` — but the real module never took a
// webview/extensionUri (it renders from the l10n map alone, no icons/URIs
// involved). Using the actual export here; same assertions as specified.
function body(): string {
  return buildAddServerBody(buildAddServerL10n());
}

describe('add-server dialog: kind switch', () => {
  it('offers instance, TM1 admin server, and PAW kinds', () => {
    const html = body();
    expect(html).toContain('id="kind-instance"');
    expect(html).toContain('id="kind-admin"');
    expect(html).toContain('id="kind-paw"');
    expect(html).toContain('id="kind-saas"');
    expect(html).toContain('id="kind-v12"');
  });

  it('groups the credential fields so the admin kind can hide them', () => {
    // An admin server has no credentials — without this container the
    // switch would have to know every field individually.
    expect(body()).toContain('id="credentials-group"');
  });

  it('gives the switch a container id so edit mode can hide it', () => {
    expect(body()).toContain('id="kind-switch"');
  });

  it('hides the kind switch in edit mode, next to btn-delete', () => {
    // The client logic cannot be imported (`acquireVsCodeApi()` at
    // module level), hence a source scan — the same means as with the
    // other guards in the project. Without this line, "Admin server" +
    // Save on an existing profile creates a NEW admin server instead of
    // converting the profile (review 2026-08-27, finding 4).
    const src = readFileSync(
      join(__dirname, '..', '..', 'webviewClient', 'addServer', 'index.ts'),
      'utf8',
    );
    const applyInit = src.slice(src.indexOf('function applyInit'));
    const hide = applyInit.slice(0, applyInit.indexOf('\n}'));
    expect(hide).toMatch(/if \(mode === 'edit'\) \{ setKindView\('fixed'\); \}/);
    // ...and only the `tiles` view shows the switch.
    const view = src.slice(src.indexOf('function setKindView'));
    expect(view.slice(0, view.indexOf('\n}'))).toMatch(/kind-switch'\)\.style\.display = view === 'tiles' \? '' : 'none'/);
  });

  it('names the admin kind in both languages via the l10n map', () => {
    const t = buildAddServerL10n();
    expect(t.kindAdmin).toBe('Admin server');
    expect(t.kindInstance).toBe('TM1 server (v11)');
    expect(t.kindPaw).toBe('PAW / PA as a Service');
  });
});

describe('add-server dialog: URL placeholder follows the kind switch', () => {
  // Source scan as in the edit-mode test above: `applyInit`/`syncForm` cannot be
  // imported in isolation (acquireVsCodeApi() at module level).
  const src = readFileSync(
    join(__dirname, '..', '..', 'webviewClient', 'addServer', 'index.ts'),
    'utf8',
  );

  it('defines a fitting example URL per kind', () => {
    expect(src).toMatch(/URL_PLACEHOLDER_INSTANCE\s*=\s*'https:\/\/localhost:8010'/);
    expect(src).toMatch(/URL_PLACEHOLDER_ADMIN\s*=\s*'http:\/\/localhost:5895'/);
  });

  it('only ever writes the example to .placeholder, never to .value', () => {
    const syncFn = src.slice(src.indexOf('function syncUrlPlaceholder'));
    const body = syncFn.slice(0, syncFn.indexOf('\n}'));
    expect(body).toMatch(/f-url'\)\.placeholder\s*=/);
    expect(body).not.toMatch(/\.value\s*=/);
  });

  it('re-syncs the placeholder from syncForm() — covers both load (applyInit) and the radio switch', () => {
    // syncForm() runs from applyInit() (load, incl. a dialog pre-set to either
    // kind) AND from the kind-radio change listener wired in wire() below — one
    // call site covers both without a second, easy-to-miss listener.
    const syncFormFn = src.slice(src.indexOf('function syncForm'));
    const body = syncFormFn.slice(0, syncFormFn.indexOf('\n}'));
    expect(body).toContain('syncUrlPlaceholder();');
  });

  it('the static markup default matches the default-checked kind (instance)', () => {
    expect(body()).toContain('placeholder="https://localhost:8010"');
  });

  it('switching kinds (syncForm) never touches f-url.value — a typed URL survives', () => {
    // Click-test feedback, round B/2: the example URL must never overwrite a value
    // that has already been typed. syncForm() is the only place
    // that runs on switching (see the test above) — as long as it does not touch
    // `f-url`'s `.value`, a typed value stays untouched.
    const syncFormFn = src.slice(src.indexOf('function syncForm'));
    const body = syncFormFn.slice(0, syncFormFn.indexOf('\nfunction '));
    expect(body).not.toMatch(/f-url'\)\.value\s*=/);
  });
});
