// src/test/commands/addServerBundleWiring.test.ts
//
// Guard for the WIRING of the add/edit server web interface — loads the
// BUILT bundle `out/webview/addServer.js` into a `node:vm` context with a
// recreated DOM and sends real host messages into it.
//
// Why via the bundle and not via the source:
//   * `tsc -p ./` excludes `src/webviewClient/` (see `tsconfig.json#exclude`),
//     so a typo there breaks no build.
//   * The pure building blocks (`protocol`, `formVisibilityPure`) are tested
//     individually — exactly the SPOT where `applyInit`, `renderCredOptions` and
//     `syncForm` call each other had no test until now. Two serious bugs
//     (field loss when editing, the dots placeholder sent as password in the
//     connection test) were green at all five gates.
// The bundle is the file that actually runs in the window; only it proves
// that the wiring holds.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';
import { buildAddServerBody } from '../../commands/serverConfig/addServerBody';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

const ROOT = join(__dirname, '../../..');
const BUNDLE = join(ROOT, 'out/webview/addServer.js');

/** Sources the bundle is built from — for the freshness check. */
const BUNDLE_SOURCES = [
  'src/webviewClient/addServer/index.ts',
  'src/webviewClient/addServer/protocol.ts',
  'src/webviewClient/addServer/formVisibilityPure.ts',
  'src/webviewClient/_shared/l10n.ts',
].map(p => join(ROOT, p));

/**
 * Without a built bundle this test must NOT pass silently — then it would be
 * exactly the kind of guard it is meant to replace. Instead it fails with
 * the instruction that makes it green. The same message for an OUTDATED
 * bundle: a source that is newer than the output would mean the test checks
 * yesterday's state and claims today's.
 */
function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(
      `Das gebaute Webview-Bundle fehlt: ${BUNDLE}\n` +
      'Dieser Test prueft die Verdrahtung im Erzeugnis, nicht in der Quelle — ' +
      'bitte einmal `npm run compile` laufen lassen (CI tut das vor den Tests).',
    );
  }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = BUNDLE_SOURCES.filter(p => existsSync(p) && statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(
      `Das Bundle ${BUNDLE} ist aelter als seine Quelle(n):\n  ` +
      stale.map(p => p.slice(ROOT.length + 1)).join('\n  ') +
      '\nDer Test wuerde sonst einen ueberholten Stand fuer gruen erklaeren — ' +
      'bitte `npm run compile` laufen lassen.',
    );
  }
  return readFileSync(BUNDLE, 'utf8');
}

// ── Minimal DOM ─────────────────────────────────────────────────────────────
//
// No jsdom in the project (and none needed): the web interface only touches
// `getElementById`, `createElement`, `querySelector(All)` and a handful of
// element properties. What matters is ONE real browser quirk without which
// the test would lie: `select.value = x` with a value for which there is no
// `<option>` sets the value to `''` — exactly what happens while the
// credential set list has not arrived yet.

class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  style: Record<string, string> = {};
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  disabled = false;
  hidden = false;
  textContent = '';
  placeholder = '';
  className = '';
  type = '';
  name = '';
  id = '';
  private _value = '';
  private _checked = false;
  /** The other buttons of the same radio group (`name="kind"`). */
  radioGroup: FakeEl[] | null = null;

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get checked(): boolean { return this._checked; }
  /** Real radio button semantics: a checked button takes the check away from
   *  the others in the group. Without that, `querySelector(':checked')` would
   *  still find the instance button after switching to "Admin server". */
  set checked(v: boolean) {
    this._checked = v;
    if (v && this.radioGroup) {
      for (const r of this.radioGroup) { if (r !== this) { r._checked = false; } }
    }
  }

  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  addEventListener(t: string, fn: (ev: unknown) => void): void {
    (this.listeners[t] ??= []).push(fn);
  }
  /** Fires the event handlers that `wire()` attached. */
  fire(t: string): void { for (const fn of this.listeners[t] ?? []) { fn({ target: this }); } }

  set innerHTML(v: string) { if (v === '') { this.children = []; } }
  get innerHTML(): string { return ''; }

  get value(): string { return this._value; }
  set value(v: string) {
    if (this.tagName === 'SELECT') {
      // Browser semantics, see above — without a matching option the value stays empty.
      this._value = this.children.some(o => o.value === String(v)) ? String(v) : '';
      return;
    }
    this._value = String(v);
  }
}

/** Builds the elements the bundle touches from the real body markup. */
function parseDom(markup: string): { byId: Map<string, FakeEl>; radios: FakeEl[] } {
  const byId = new Map<string, FakeEl>();
  const radios: FakeEl[] = [];
  const tagRe = /<(\w+)([^>]*)>/g;
  let currentSelect: FakeEl | null = null;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(markup))) {
    const [, tag, attrs] = m;
    if (tag === 'option') {
      const v = /\bvalue="([^"]*)"/.exec(attrs);
      if (currentSelect) {
        const o = new FakeEl('option');
        o.value = v ? v[1] : '';
        currentSelect.children.push(o);
      }
      continue;
    }
    const el = new FakeEl(tag);
    const idM = /\bid="([^"]+)"/.exec(attrs);
    if (idM) { el.id = idM[1]; byId.set(idM[1], el); }
    const typeM = /\btype="([^"]*)"/.exec(attrs);
    if (typeM) { el.type = typeM[1]; }
    const nameM = /\bname="([^"]*)"/.exec(attrs);
    if (nameM) { el.name = nameM[1]; }
    // `value="instance"`/`value="admin"` of the radio buttons — `isAdminKind()` reads exactly that.
    const valM = /\bvalue="([^"]*)"/.exec(attrs);
    if (valM) { el.value = valM[1]; }
    if (/\bchecked\b/.test(attrs)) { el.checked = true; }
    if (/style="display:none"/.test(attrs)) { el.style.display = 'none'; }
    if (tag === 'select') { currentSelect = el; }
    if (tag === 'input' && el.type === 'radio' && el.name === 'kind') { radios.push(el); }
  }
  for (const r of radios) { r.radioGroup = radios; }
  return { byId, radios };
}

interface Harness {
  el(id: string): FakeEl;
  val(id: string): string;
  /** Message from the host into the web interface — like `panel.webview.postMessage`. */
  send(msg: unknown): void;
  /** What the web interface sent to the host. */
  posted: Record<string, unknown>[];
}

/** The host renders the markup from the l10n map; for the setup the key as
 *  text is enough — values are checked, not labels. */
const L10N_ECHO = new Proxy({ probeAdminResult: '{0} instance(s) found' }, {
  get: (t, k) => Reflect.get(t, k) ?? String(k),
}) as L10nMap;

function mount(): Harness {
  const { byId, radios } = parseDom(buildAddServerBody(L10N_ECHO));
  const posted: Record<string, unknown>[] = [];
  let onMessage: ((ev: { data: unknown }) => void) | null = null;

  const sandbox: Record<string, unknown> = {
    console,
    URL,
    document: {
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (t: string) => new FakeEl(t),
      querySelectorAll: (sel: string) => (sel.includes('name="kind"') ? radios
        : sel.includes('#db-list') ? (byId.get('db-list')?.children ?? []).map(row => row.children[0]!)
        : []),
      querySelector: (sel: string) =>
        (sel.includes('name="kind"') ? radios.find(r => r.checked) ?? null : null),
    },
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }),
    window: {
      addEventListener: (t: string, fn: (ev: { data: unknown }) => void) => {
        if (t === 'message') { onMessage = fn; }
      },
    },
    // `getL10n()` reads `globalThis.__l10n` (the host injects it via the shell).
    __l10n: L10N_ECHO,
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(readBundle(), sandbox, { filename: 'addServer.js' });

  return {
    el: (id) => {
      const e = byId.get(id);
      if (!e) { throw new Error(`Kein Element #${id} im Body-Markup`); }
      return e;
    },
    val: (id) => byId.get(id)?.value ?? '',
    send: (msg) => {
      if (!onMessage) { throw new Error('Das Bundle hat keinen message-Empfaenger angehaengt'); }
      (onMessage as (ev: { data: unknown }) => void)({ data: msg });
    },
    posted,
  };
}

/** An existing profile WITH its own credentials, as `getServerFormData`
 *  sends it when editing. */
const PROFIL = {
  name: 'SALES',
  serverUrl: 'https://tm1.example:8010',
  username: 'eigenerUser',
  password: 'eigenesPw',
  authType: 'CAM' as const,
  camNamespace: 'LDAP',
  rejectUnauthorized: true,
};

const SATZ = {
  id: 'c1', name: 'Gruppenkonto', username: 'satzUser',
  authType: 'Basic' as const, camNamespace: undefined, hasPassword: true,
};

const CRED_LIST = { type: 'credListResult', sets: [SATZ] };
const FELDER = ['f-user', 'f-pass', 'f-auth', 'f-cam'];
const PAW_INIT = {
  type: 'init', mode: 'add', kind: 'paw',
  data: {
    ...PROFIL,
    name: 'Workspace',
    serverUrl: 'https://paw.example:9443',
    authType: 'Basic' as const,
    credentialId: 'c1',
  },
} as const;

describe('addServer bundle: wiring in the running output', () => {
  it('PAW add/edit uses group visibility, the root placeholder, and its own hint', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({
      type: 'init', mode: 'edit', kind: 'paw',
      data: {
        ...PROFIL, name: 'Workspace', serverUrl: 'https://paw.example:9443',
        authType: 'Basic', credentialId: 'c1',
      },
    });

    expect(h.el('kind-paw').checked).toBe(true);
    expect(h.el('credentials-group').style.display).toBe('none');
    expect(h.el('row-version').style.display).toBe('none');
    expect(h.el('f-url').placeholder).toBe('https://paw-host:9443');
    expect(h.el('kind-hint').textContent).toBe('kindHintPaw');
    expect(h.el('url-hint-gateway').style.display).toBe('none');
    expect(h.el('btn-save').textContent).toBe('saveGroup');
    expect(h.val('f-cred')).toBe('c1');
  });

  it('PAW keeps a wrong path on blur — trimmed, but never silently repaired', () => {
    const h = mount();
    h.send({ ...PAW_INIT, data: { ...PAW_INIT.data, name: '', serverUrl: '' } });
    h.el('f-url').value = '  https://paw.example:9443/wrong/api/v1/  ';
    h.el('f-url').fire('input');
    h.el('f-url').fire('blur');

    // `normalizeServerUrl` now also runs for PAW: whitespace and
    // trailing slashes are removed. It leaves the PATH in place — otherwise a
    // wrong input would look right afterwards, and `normalizePawGatewayUrl`
    // would only reject it during the test.
    expect(h.val('f-url')).toBe('https://paw.example:9443/wrong/api/v1');
    expect(h.el('url-preview').textContent).toBe(
      'previewPrefix https://paw.example:9443/wrong/api/v1/api/v1/tm1/Servers',
    );
  });

  it('the URL hint names the port of the selected kind, not always 8010', () => {
    const h = mount();
    h.send(PAW_INIT);
    // Otherwise the basic hint names an INSTANCE port; under a gateway that
    // is the wrong number (reported 2026-09-16).
    expect(h.el('url-hint').textContent).toBe('urlHintPaw');

    h.el('kind-paw').checked = false;
    h.el('kind-admin').checked = true;
    h.el('kind-admin').fire('change');
    expect(h.el('url-hint').textContent).toBe('urlHintAdmin');
  });

  it('PAW gets the missing scheme added on blur, like the other kinds', () => {
    const h = mount();
    h.send({ ...PAW_INIT, data: { ...PAW_INIT.data, name: '', serverUrl: '' } });
    h.el('f-url').value = 'paw.example:9443';
    h.el('f-url').fire('input');
    h.el('f-url').fire('blur');

    // Without this run the input failed at the hard scheme check in
    // `normalizePawGatewayUrl`, while instance and admin server silently
    // fixed it (review 2026-09-16, finding 1).
    expect(h.val('f-url')).toBe('https://paw.example:9443');
  });

  it('PAW probe and save carry kind, credential, and an increasing request id', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send(PAW_INIT);

    h.el('btn-test').fire('click');
    const first = h.posted.find(p => p.type === 'probeAdmin')!;
    expect(first).toMatchObject({ kind: 'paw', defaultCredentialId: 'c1', requestId: 1 });
    h.send({ type: 'adminProbeResult', requestId: 1, ok: true, count: 2 });
    h.el('btn-test').fire('click');
    expect(h.posted.filter(p => p.type === 'probeAdmin').at(-1)).toMatchObject({ requestId: 2 });
    h.send({ type: 'adminProbeResult', requestId: 2, ok: true, count: 2 });
    h.el('btn-save').fire('click');
    expect(h.posted.at(-1)).toMatchObject({
      type: 'saveAdmin', kind: 'paw', defaultCredentialId: 'c1',
    });
  });

  it('PAW needs no login profile — the list arrives anonymously', () => {
    const h = mount();
    h.send({ type: 'credListResult', sets: [] });
    h.send({ ...PAW_INIT, data: { ...PAW_INIT.data, credentialId: undefined } });

    expect(h.el('btn-test').disabled).toBe(false);
    expect(h.el('btn-save').disabled).toBe(false);
  });

  it.each([
    ['changed URL', (h: Harness) => { h.el('f-url').value = 'https://other.example'; h.el('f-url').fire('input'); }],
    ['TLS setting', (h: Harness) => { h.el('f-ssl').checked = false; h.el('f-ssl').fire('change'); }],
    ['kind', (h: Harness) => { h.el('kind-admin').checked = true; h.el('kind-admin').fire('change'); }],
  ])('discards a probe reply after editing %s and leaves the form usable', (_label, edit) => {
    const h = mount();
    h.send(CRED_LIST);
    h.send(PAW_INIT);
    h.el('btn-test').fire('click');
    edit(h);
    h.send({ type: 'adminProbeResult', requestId: 1, ok: true, count: 99 });

    expect(h.el('status').textContent).toBe('testing');
    expect(h.el('btn-test').disabled).toBe(false);
  });

  // The probe sends no credential to the host (`probeAdmin` reads kind, URL,
  // TLS and tenant). A redraw that leaves those alone must keep the probe:
  // dropping it threw away a finished browser login and re-enabled Test while
  // the first login page was still open (review 2026-11-02).
  it.each([
    ['same URL entered again', (h: Harness) => { h.el('f-url').value = PAW_INIT.data.serverUrl; h.el('f-url').fire('input'); }],
    ['credential selection', (h: Harness) => {
      h.el('f-cred').value = '';
      h.el('f-cred').fire('change');
      h.el('f-cred').value = 'c1';
      h.el('f-cred').fire('change');
    }],
    ['credential list refresh', (h: Harness) => { h.send(CRED_LIST); }],
  ])('keeps the probe through %s and applies its reply', (_label, edit) => {
    const h = mount();
    h.send(CRED_LIST);
    h.send(PAW_INIT);
    h.el('btn-test').fire('click');
    edit(h);
    expect(h.el('btn-test').disabled).toBe(true);
    h.send({ type: 'adminProbeResult', requestId: 1, ok: true, count: 99 });

    expect(h.el('status').textContent).toBe('99 instance(s) found');
    expect(h.el('btn-test').disabled).toBe(false);
  });

  it('applies a probe reply after editing and saving the selected credential', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send(PAW_INIT);
    h.el('btn-test').fire('click');
    h.el('btn-cred-edit').fire('click');
    h.el('btn-cred-save').fire('click');
    h.send({ type: 'credSaveResult', ok: true, id: 'c1' });
    h.send({ type: 'adminProbeResult', requestId: 1, ok: true, count: 99 });

    expect(h.el('status').textContent).toBe('99 instance(s) found');
    expect(h.el('btn-test').disabled).toBe(false);
  });

  it('ignores an uncorrelated reply and keeps the matching probe busy', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send(PAW_INIT);
    h.el('btn-test').fire('click');
    h.send({ type: 'adminProbeResult', ok: true, count: 99 });

    expect(h.el('status').textContent).toBe('testing');
    expect(h.el('btn-test').disabled).toBe(true);
  });

  it('an older reply cannot clear the busy state of a newer probe', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send(PAW_INIT);
    h.el('btn-test').fire('click');
    h.el('f-url').fire('input');
    h.el('btn-test').fire('click');

    h.send({ type: 'adminProbeResult', requestId: 1, ok: true, count: 99 });
    expect(h.el('status').textContent).toBe('testing');
    expect(h.el('btn-test').disabled).toBe(true);

    h.send({ type: 'adminProbeResult', requestId: 2, ok: true, count: 2 });
    expect(h.el('status').textContent).toBe('2 instance(s) found');
    expect(h.el('btn-test').disabled).toBe(false);
  });
  // Finding 1 of the final review: `applyInit` filled the four fields and a
  // subsequent `applyCredLock` wrote the empty substitute value over them — the
  // edit window of EVERY profile was empty, even without any credential set.
  // Since the selection only HIDES the fields instead of writing to them,
  // this can no longer happen structurally; the guard stays anyway.
  it('editing a profile without a credential set leaves the four fields intact (init first)', () => {
    const h = mount();
    h.send({ type: 'init', mode: 'edit', data: PROFIL, kind: 'instance' });
    expect(FELDER.map(h.val)).toEqual(['eigenerUser', 'eigenesPw', 'CAM', 'LDAP']);

    // The list arrives after `init` (the host answers `credList` only
    // after a `secrets.get` await) — the fields stay intact after that too.
    h.send(CRED_LIST);
    expect(FELDER.map(h.val)).toEqual(['eigenerUser', 'eigenesPw', 'CAM', 'LDAP']);
    expect(h.el('credentials-group').style.display ?? '').not.toBe('none');
  });

  // The stored password never comes into the webview (review 2026-10-26).
  // A SaaS key is mandatory for Test/Save — with only `hasPassword` the
  // buttons must still be enabled, and the probe must not send the dots.
  it('edit with a stored key: empty field, dots as placeholder, Test enabled, nothing sent', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({
      type: 'init', mode: 'edit', kind: 'instance',
      data: {
        name: 'Cloud', serverUrl: 'https://eu.example.com', username: 'apikey', password: '',
        hasPassword: true, authType: 'v12-basic', rejectUnauthorized: true, version: 'v12',
        v12: { authMode: 'saas', instance: 'TENANT', database: 'DB' },
      },
    });
    expect(h.val('f-pass')).toBe('');
    expect(h.el('f-pass').placeholder).toBe('••••••••');
    expect(h.el('btn-test').disabled).toBe(false);
    h.el('btn-test').fire('click');
    const probe = h.posted.find((m) => m.type === 'test') as { data: { password: string } } | undefined;
    expect(probe?.data.password).toBe('');

    h.send({ type: 'testResult', ok: true, version: '12.5' });
    expect(h.el('btn-save').disabled).toBe(false);
    h.el('btn-save').fire('click');
    const save = h.posted.find((m) => m.type === 'save') as { data: { password: string } } | undefined;
    expect(save?.data.password).toBe('');
  });

  it('editing a profile without a credential set leaves the four fields intact (credListResult first)', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({ type: 'init', mode: 'edit', data: PROFIL, kind: 'instance' });
    expect(FELDER.map(h.val)).toEqual(['eigenerUser', 'eigenesPw', 'CAM', 'LDAP']);
  });

  it('profile WITH a credential set: own fields disappear, their values stay untouched', () => {
    const h = mount();
    h.send({ type: 'init', mode: 'edit', data: { ...PROFIL, credentialId: 'c1' }, kind: 'instance' });
    // No list yet: the set is unknown, so the profile's own fields apply.
    expect(FELDER.map(h.val)).toEqual(['eigenerUser', 'eigenesPw', 'CAM', 'LDAP']);
    expect(h.el('credentials-group').style.display ?? '').not.toBe('none');

    h.send(CRED_LIST);
    expect(h.val('f-cred')).toBe('c1');
    // The group is gone — and its fields still carry unchanged what the
    // user last typed in themselves. That is exactly why no snapshot is
    // needed anymore: nothing is overwritten that would have to be rescued.
    expect(h.el('credentials-group').style.display).toBe('none');
    expect(FELDER.map(h.val)).toEqual(['eigenerUser', 'eigenesPw', 'CAM', 'LDAP']);
  });

  // The flip side of hiding: the details that `isServerFormValid` requires
  // and that the host writes into the profile must then come from the set —
  // not from the invisible fields. Otherwise "Save" would be permanently
  // disabled for a profile with an empty user field.
  it('with a selected set, its user and auth type are sent, not those of the own fields', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({ type: 'init', mode: 'edit', data: { ...PROFIL, credentialId: 'c1' }, kind: 'instance' });

    h.el('btn-test').fire('click');
    const data = h.posted.filter(p => p.type === 'test')[0].data as
      { username: string; authType: string; camNamespace?: string };
    expect(data.username).toBe('satzUser');
    expect(data.authType).toBe('Basic');
    expect(data.camNamespace).toBeUndefined();
  });


  // Addendum to the final review: the selection field was visible and
  // usable in the v12 branch, but `collect()` returns no `credentialId` there
  // at all — the selection was silently lost on save. The test walks the full
  // switching path v11 -> v12 -> v11: nothing may get stuck, and the selection
  // of a v11 profile must survive it.
  it('v12 hides the credential set selection and unlocks the fields, v11 restores both', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({ type: 'init', mode: 'edit', data: { ...PROFIL, credentialId: 'c1' }, kind: 'instance' });

    // Starting point v11: field visible, set selected, own fields hidden.
    expect(h.el('cred-select-group').style.display ?? '').not.toBe('none');
    expect(h.val('f-cred')).toBe('c1');
    expect(h.el('credentials-group').style.display).toBe('none');

    h.el('f-version').value = 'v12';
    h.el('f-version').fire('change');

    expect(h.el('cred-select-group').style.display).toBe('none');
    // Nothing is stuck: in v12, user/password are the app client ID and its
    // secret — the group must be back and unchanged.
    expect(h.el('credentials-group').style.display ?? '').not.toBe('none');
    expect(h.val('f-user')).toBe('eigenerUser');
    expect(h.val('f-pass')).toBe('eigenesPw');
    expect(h.val('f-pass')).not.toContain('\u2022');

    h.el('f-version').value = 'v11';
    h.el('f-version').fire('change');

    // The selection survived the excursion, the group is gone again.
    expect(h.el('cred-select-group').style.display ?? '').not.toBe('none');
    expect(h.val('f-cred')).toBe('c1');
    expect(h.el('credentials-group').style.display).toBe('none');
  });

  it('admin server branch still shows the selection — there it is the default set', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({ type: 'init', mode: 'add', data: { ...PROFIL, name: '', serverUrl: '' }, kind: 'admin' });
    expect(h.el('cred-select-group').style.display ?? '').not.toBe('none');
  });

  // Finding 5: the New/Edit/Delete buttons were inside `credentials-group`,
  // which `syncKind()` hides for an admin server. Anyone who set up the
  // main use case first — enter the admin server, set the default
  // set — saw an empty selection list and no way to create a set.
  it('admin server branch hides the own credentials, but not the set controls', () => {
    const h = mount();
    h.send({ type: 'init', mode: 'add', data: { ...PROFIL, name: '', serverUrl: '' }, kind: 'admin' });

    expect(h.el('credentials-group').style.display).toBe('none');
    expect(h.el('cred-select-group').style.display ?? '').not.toBe('none');

    // And the button actually does something there: it opens the edit field.
    expect(h.el('cred-edit-panel').style.display).toBe('none');
    h.el('btn-cred-new').fire('click');
    expect(h.el('cred-edit-panel').style.display).toBe('');
  });

  // Finding 2: the dots placeholder is a DISPLAY, not a password. If it went
  // to the host as `data.password`, the connection test logged in to the real
  // server with the set's real user name and a wrong password —
  // with a group account that is a few clicks away from a lockout.
  // (The actual bolt sits host-side in `addServerPanel.ts`; this is
  // the second half: the web interface is not a password source.)
  it('connection test with a selected set never sends the dots placeholder as password', () => {
    const h = mount();
    h.send(CRED_LIST);
    h.send({ type: 'init', mode: 'edit', data: { ...PROFIL, credentialId: 'c1' }, kind: 'instance' });

    h.el('btn-test').fire('click');
    const test = h.posted.filter(p => p.type === 'test');
    expect(test).toHaveLength(1);
    const data = test[0].data as { password: string; credentialId?: string };
    expect(data.credentialId).toBe('c1');
    expect(data.password).toBe('');
    expect(data.password).not.toContain('•');
  });

  it('type tiles and sign-in choices drive the hidden version and auth-mode selects', () => {
    const h = mount();
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, authType: 'Basic', camNamespace: undefined } });
    expect(h.el('si-basic').checked).toBe(true);
    expect(h.el('si-row-saas').style.display).toBe('none');

    // PA as a Service is the API key; its browser login moved to the gateway tile.
    h.el('kind-saas').checked = true;
    h.el('kind-saas').fire('change');
    expect(h.val('f-version')).toBe('v12');
    expect(h.val('f-authmode')).toBe('saas');
    expect(h.el('si-saas').checked).toBe(true);
    expect(h.el('si-row-saas-browser').style.display).toBe('none');
    expect(h.el('si-row-basic').style.display).toBe('none');
    expect(h.el('btn-saas-lists').style.display).toBe('none');

    // v12 never keeps a SaaS mode, back to v11 restores the v11 choices.
    h.el('kind-v12').checked = true;
    h.el('kind-v12').fire('change');
    expect(h.val('f-authmode')).toBe('basic-s2s');
    expect(h.el('si-s2s').checked).toBe(true);
    h.el('kind-instance').checked = true;
    h.el('kind-instance').fire('change');
    expect(h.val('f-version')).toBe('v11');
    expect(h.el('si-row-basic').style.display).toBe('');
  });

  it('v12 API-key mode explains itself: tenant label, API key label, no username or v11 login row', () => {
    const h = mount();
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, authType: 'Basic', camNamespace: undefined } });
    h.el('f-version').value = 'v12';
    h.el('f-version').fire('change');
    h.el('f-authmode').value = 'saas';
    h.el('f-authmode').fire('change');

    expect(h.el('row-auth').style.display).toBe('none');
    expect(h.el('row-user').style.display).toBe('none');
    expect(h.el('lbl-instance').textContent).toBe('tenantId');
    expect(h.el('lbl-pass').textContent).toBe('apiKey');
    expect(h.el('authmode-hint').textContent).toBe('authModeHintSaas');

    // The stale username from the hidden row must not reach the probe; the key loses its whitespace.
    h.el('f-instance').value = 'TENANT1';
    h.el('f-database').value = 'db';
    h.el('f-pass').value = ' key \n';
    h.el('f-pass').fire('input');
    h.el('btn-test').fire('click');
    const data = h.posted.filter(p => p.type === 'test').at(-1)!.data as { username: string; password: string };
    expect(data.username).toBe('apikey');
    expect(data.password).toBe('key');

    h.el('f-authmode').value = 'basic-native';
    h.el('f-authmode').fire('change');
    expect(h.el('row-user').style.display).toBe('');
    expect(h.el('lbl-instance').textContent).toBe('instance');
    expect(h.el('lbl-pass').textContent).toBe('password');
    expect(h.el('authmode-hint').textContent).toBe('authModeHintNative');
  });

  it('a PAW instance URL keeps its database when the list arrives only after login', () => {
    const h = mount();
    h.send({ type: 'credListResult', sets: [] });
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, serverUrl: '' } });
    h.el('f-url').value = 'https://paw.example:9443/tm1/Sales';
    h.el('f-url').fire('input');
    h.el('f-url').fire('blur');
    const req = h.posted.filter(p => p.type === 'detect').at(-1)!;
    // Protected list: detection names the database but cannot list any.
    h.send({
      type: 'detectResult', requestId: req.requestId, ok: true, kind: 'paw',
      serverUrl: 'https://paw.example:9443', databases: [], pawDatabase: 'Sales',
    });

    h.el('btn-test').fire('click');
    const probe = h.posted.filter(p => p.type === 'probeAdmin').at(-1)!;
    h.send({
      type: 'adminProbeResult', requestId: probe.requestId, ok: true, count: 2,
      databases: [{ name: 'Planning', acceptingClients: true }, { name: 'Sales', acceptingClients: true }],
    });

    const ticks = h.el('db-list').children.map(row => [row.children[0]!.value, row.children[0]!.checked]);
    expect(ticks).toEqual([['Planning', false], ['Sales', true]]);
  });

  // Review 2026-11-02: a gateway probe that ends on a single database moves
  // Save to the instance route — which the probe did not test.
  it('a gateway probe listing one database leaves the instance route untested', () => {
    const h = mount();
    h.send({ type: 'credListResult', sets: [] });
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, serverUrl: '' } });
    h.el('f-url').value = 'https://paw.example:9443/tm1/Sales';
    h.el('f-url').fire('input');
    h.el('f-url').fire('blur');
    const req = h.posted.filter(p => p.type === 'detect').at(-1)!;
    h.send({
      type: 'detectResult', requestId: req.requestId, ok: true, kind: 'paw',
      serverUrl: 'https://paw.example:9443', databases: [], pawDatabase: 'Sales',
    });
    h.el('btn-test').fire('click');
    const probe = h.posted.filter(p => p.type === 'probeAdmin').at(-1)!;
    h.send({
      type: 'adminProbeResult', requestId: probe.requestId, ok: true, count: 1,
      databases: [{ name: 'Sales', acceptingClients: true }],
    });

    h.el('btn-save').fire('click');
    expect(h.posted.at(-1)!.type).toBe('test');
  });

  // Review 2026-11-02: only typing in the URL dropped a running detection; a
  // sign-in picked meanwhile was set back by the answer.
  it('a sign-in chosen while detection runs survives its answer', () => {
    const h = mount();
    h.send({ type: 'credListResult', sets: [] });
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, authType: 'Basic' } });
    h.el('f-url').fire('blur');
    const req = h.posted.filter(p => p.type === 'detect').at(-1)!;
    h.el('f-auth').value = 'CAM';
    h.el('f-auth').fire('change');
    h.send({ type: 'detectResult', requestId: req.requestId, ok: true, kind: 'v11', auth: 'Basic', serverUrl: PROFIL.serverUrl });

    expect(h.val('f-auth')).toBe('CAM');
  });

  it('typing a new URL discards the detection answer for the old one', () => {
    const h = mount();
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, serverUrl: '' } });
    h.el('f-url').value = 'https://a.example:8010';
    h.el('f-url').fire('input');
    h.el('f-url').fire('blur');
    const req = h.posted.filter(p => p.type === 'detect').at(-1)!;
    expect(req.serverUrl).toBe('https://a.example:8010');

    h.el('f-url').value = 'https://b.example:8010';
    h.el('f-url').fire('input');
    h.send({ type: 'detectResult', requestId: req.requestId, ok: true, kind: 'v11', auth: 'Basic', serverUrl: 'https://a.example:8010' });
    expect(h.val('f-url')).toBe('https://b.example:8010');

    // Same URL typed again after the answer was dropped: blur detects anew.
    h.el('f-url').value = 'https://a.example:8010';
    h.el('f-url').fire('input');
    h.el('f-url').fire('blur');
    expect(h.posted.filter(p => p.type === 'detect')).toHaveLength(2);
  });
});

// Save on an untested instance runs the probe first (2026-11-01). A detection
// answer may land on either side of the probe's answer (review 2026-11-01
// evening: before the fix, one landing during the probe dropped the save).
describe('addServer bundle: Save probes first, whatever the detection does', () => {
  /** Add form with a typed instance, Save clicked before detection answers. */
  function saveWhileDetecting(): { h: Harness; detectId: unknown } {
    const h = mount();
    h.send({ type: 'credListResult', sets: [] });
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, authType: 'Basic' } });
    h.el('f-url').fire('blur');
    const detectId = h.posted.find(p => p.type === 'detect')!.requestId;
    h.el('btn-save').fire('click');
    return { h, detectId };
  }
  const types = (h: Harness): unknown[] => h.posted.map(p => p.type);
  const sameAnswer = (id: unknown) => ({ type: 'detectResult', requestId: id, ok: true, kind: 'v11', auth: 'Basic', serverUrl: PROFIL.serverUrl });

  it('detection answers during the probe with the same values: the save still follows', () => {
    const { h, detectId } = saveWhileDetecting();
    h.send(sameAnswer(detectId));
    h.send({ type: 'testResult', ok: true });
    expect(types(h)).toEqual(['ready', 'credList', 'detect', 'test', 'save']);
  });

  it('detection answers after the probe: the save has already gone', () => {
    const { h, detectId } = saveWhileDetecting();
    h.send({ type: 'testResult', ok: true });
    h.send(sameAnswer(detectId));
    expect(types(h)).toEqual(['ready', 'credList', 'detect', 'test', 'save']);
  });

  it('detection changes the sign-in during the probe: the new values are probed, then saved', () => {
    const { h, detectId } = saveWhileDetecting();
    h.send({ ...sameAnswer(detectId), auth: 'CAM' });
    h.send({ type: 'testResult', ok: true });
    expect(types(h)).toEqual(['ready', 'credList', 'detect', 'test', 'test']);
    h.send({ type: 'testResult', ok: true });
    expect(types(h).at(-1)).toBe('save');
    expect((h.posted.at(-1)!.data as { authType: string }).authType).toBe('CAM');
  });

  it('a failed probe saves nothing', () => {
    const { h } = saveWhileDetecting();
    h.send({ type: 'testResult', ok: false, message: 'nope' });
    expect(types(h)).not.toContain('save');
  });
});

// The host posts `fallbackApplied` right after a `testResult` with
// `fallbackFollows`. It may only apply when that test still matched the form
// (review 2026-11-02: a stale one wrote the old URL back and turned Save green
// for values nobody had tested).
describe('addServer bundle: a connection fallback applies only to a current test', () => {
  const FALLBACK = { type: 'fallbackApplied', serverUrl: 'http://tm1.example:8010', note: 'http' };
  function testRunning(): Harness {
    const h = mount();
    h.send({ type: 'credListResult', sets: [] });
    h.send({ type: 'init', mode: 'add', kind: 'instance', data: { ...PROFIL, authType: 'Basic' } });
    h.el('btn-test').fire('click');
    return h;
  }

  // Save on a tested form posts `save`; on an untested one it probes first.
  const saveClickPosts = (h: Harness): unknown => { h.el('btn-save').fire('click'); return h.posted.at(-1)!.type; };

  it('fields unchanged: the fallback rewrites the URL and counts as tested', () => {
    const h = testRunning();
    h.send({ type: 'testResult', ok: true, fallbackFollows: true });
    h.send(FALLBACK);
    expect(h.val('f-url')).toBe('http://tm1.example:8010');
    expect(saveClickPosts(h)).toBe('save');
  });

  it('a field changed during the test: the fallback is dropped and Save probes again', () => {
    const h = testRunning();
    h.el('f-user').value = 'someoneElse';
    h.el('f-user').fire('input');
    h.send({ type: 'testResult', ok: true, fallbackFollows: true });
    h.send(FALLBACK);
    expect(h.val('f-url')).toBe(PROFIL.serverUrl);
    expect(saveClickPosts(h)).toBe('test');
  });
});
