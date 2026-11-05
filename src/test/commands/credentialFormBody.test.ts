import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const body = readFileSync(join(__dirname, '../../commands/serverConfig/addServerBody.ts'), 'utf8');
const client = readFileSync(join(__dirname, '../../webviewClient/addServer/index.ts'), 'utf8');
const css = readFileSync(join(__dirname, '../../commands/serverConfig/addServerCss.ts'), 'utf8');

describe('Credential set controls in the form', () => {
  it('has the selection field and the three buttons', () => {
    for (const id of ['f-cred', 'btn-cred-new', 'btn-cred-edit', 'btn-cred-del']) {
      expect(body).toContain(id);
    }
  });

  // Final check 2026-08-28, finding 5: the buttons were in
  // `credentials-group`, which `syncKind()` hides for an admin server —
  // there the default set was selectable, but none could be created. The two
  // groups are siblings, so the order in the markup is the proof of
  // the nesting.
  it('set controls sit in cred-select-group, not in the group of the own fields', () => {
    const select = body.indexOf('id="cred-select-group"');
    const own = body.indexOf('id="credentials-group"');
    expect(select).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(select);
    for (const id of ['btn-cred-new', 'btn-cred-edit', 'btn-cred-del', 'cred-edit-panel']) {
      expect(body.indexOf(`id="${id}"`)).toBeGreaterThan(select);
      expect(body.indexOf(`id="${id}"`)).toBeLessThan(own);
    }
    // The four OWN fields still belong after it — an admin server really
    // does not have those.
    for (const id of ['f-auth', 'f-cam', 'f-user', 'f-pass']) {
      expect(body.indexOf(`id="${id}"`)).toBeGreaterThan(own);
    }
  });

  // Review round 1, findings 1+3 were the consequence of a selected
  // credential profile FILLING the four own fields with its values and
  // locking them — that brought snapshot, restore and the
  // dots placeholder, which could be saved as a real password when switching
  // back. Since the fields are only hidden instead, this write path
  // no longer exists; here is the source guard
  // against its return. The behavior itself is checked by
  // `addServerBundleWiring.test.ts` on the built artifact.
  it('no longer locks the own fields and toggles their group in exactly one place', () => {
    // No `disabled` on the four fields: a lock would again have to display values,
    // that is, write and rescue them.
    for (const feld of ['f-user', 'f-pass', 'f-auth', 'f-cam']) {
      expect(client).not.toMatch(new RegExp(`\\('${feld}'\\)\\.disabled`));
    }
    // Exactly one write access to the visibility — two places were the
    // reason why something got stuck when switching (kind, version, selection).
    // It runs through `syncForm`'s `show()` helper; nobody may go past it straight to the DOM.
    expect(client.match(/show\('credentials-group',/g) ?? []).toHaveLength(1);
    expect(client).not.toMatch(/\$\('credentials-group'\)\.style\.display\s*=/);
  });

  // Click test 2026-08-29: the three buttons ran into the expanding
  // edit field, and auth type/user/password stuck together,
  // while display name and server URL had 12px. Cause: `.form` gives
  // spacing only to its DIRECT children, and each field group is itself one
  // child. That is why the groups carry the same flex layout as `.form`.
  it('the field groups carry the same row spacing as the form itself', () => {
    expect(css).toMatch(/#cred-select-group[^{]*,[^{]*#credentials-group[^{]*\{[^}]*flex-direction:column[^}]*gap:12px/);
  });

  it('the edit field is a set-off box with a heading', () => {
    // It expands IN THE MIDDLE of the form — without a border nothing showed that
    // name/user/password below belong to the profile and not to the server.
    expect(css).toMatch(/#cred-edit-panel\{[^}]*border:/);
    expect(body).toContain('id="cred-edit-title"');
    // And the heading says which of the two cases is currently running.
    expect(client).toContain('credEditExisting');
    expect(client).toContain('credEditNew');
  });

  // `.row{display:grid}` (author sheet) beats the UA `[hidden]`, so the
  // OIDC row stayed visible even though `syncForm` sets the attribute.
  it('the hidden attribute wins against the row grid', () => {
    expect(css).toContain('[hidden]{display:none !important;}');
  });

  it('requests the sets when opening', () => {
    expect(client).toContain("type: 'credList'");
  });
});
