// Regression guard for the `-adm` marker on the serverRoot contextValue.
//
// The danger is concrete: package.json contains roughly twenty `when` clauses
// that anchor on the EXACT forms `serverRoot-connected`, `serverRoot-connected-v12`
// and `serverRoot-disconnected`, several of them with `$`. An additional
// suffix makes every clause that was not updated along with it silently match
// nothing — half of the server context menu disappears on discovered servers,
// without any error.
//
// The test therefore reads package.json, translates every `when` clause that
// mentions `serverRoot` into a function over `viewItem` and checks: whatever
// matches on an ordinary server node must also match on the corresponding
// `-adm` node.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  contributes: { menus: Record<string, { command: string; when?: string; group?: string }[]> };
};

/** Ordinary contextValues → the form the same node carries when it comes from an admin server. */
const PAARE: [ordinary: string, adm: string][] = [
  ['serverRoot-connected', 'serverRoot-connected-adm'],
  ['serverRoot-connected-v12', 'serverRoot-connected-v12-adm'],
  ['serverRoot-disconnected', 'serverRoot-disconnected-adm'],
  ['serverRoot-connected.git', 'serverRoot-connected-adm.git'],
  ['serverRoot-connected-v12.git', 'serverRoot-connected-v12-adm.git'],
  // Forms during an impersonation — `-imp` sits BEFORE `-adm`.
  ['serverRoot-connected-imp', 'serverRoot-connected-imp-adm'],
  ['serverRoot-connected-imp.git', 'serverRoot-connected-imp-adm.git'],
];

/**
 * During an impersonation the node carries an additional `-imp`. Every
 * clause that matches on the ordinary node must also match there —
 * otherwise half of the server context menu drops away as soon as someone
 * impersonates. The only exception is the very command this suffix SUPERSEDES.
 */
const IMP_PAARE: [ordinary: string, imp: string][] = [
  ['serverRoot-connected', 'serverRoot-connected-imp'],
  ['serverRoot-connected-adm', 'serverRoot-connected-imp-adm'],
  ['serverRoot-connected.git', 'serverRoot-connected-imp.git'],
];

/**
 * Translates the `when` grammar that occurs here into JS over `v` (= viewItem):
 * `viewItem =~ /re/`, `viewItem == literal`, `view == tm1Explorer`, `&&`, `||`,
 * parentheses. If a `view` identifier is still left afterwards, the test does not
 * know the form and would rather fail loudly than silently return `true`.
 */
function compileWhen(when: string): (v: string) => boolean {
  const js = when
    .replace(/viewItem\s*=~\s*(\/(?:[^/\\]|\\.)*\/)/g, '($1.test(v))')
    .replace(/viewItem\s*==\s*([A-Za-z0-9_.-]+)/g, (_m, lit: string) => `(v === ${JSON.stringify(lit)})`)
    .replace(/view\s*==\s*tm1Explorer/g, 'true')
    // Bare context keys (`tm1.impersonating`) do not depend on the
    // contextValue but on a state of the extension. For the question this
    // guard asks — does the clause carry the `-adm` marker along? — they are
    // irrelevant, so substitute them as satisfied.
    .replace(/\btm1\.[A-Za-z0-9_.]+/g, 'true')
    // Same for the selection state of the list.
    .replace(/\blistMultiSelection\b/g, 'true');
  if (/view(Item)?\b/.test(js)) {
    throw new Error(`unbekannte when-Form: ${when}`);
  }
  return new Function('v', `return !!(${js});`) as (v: string) => boolean;
}

type Klausel = { command: string; menu: string; when: string };

const klauseln: Klausel[] = Object.entries(pkg.contributes.menus)
  .flatMap(([menu, items]) => items
    .filter(i => typeof i.when === 'string' && i.when.includes('serverRoot'))
    .map(i => ({ command: i.command, menu, when: i.when as string })));

/**
 * Commands that are DELIBERATELY missing on a discovered server — the rule
 * "matches ordinarily, matches with -adm too" does not apply to them.
 *
 * `tm1.adminServer.detach` is the opposite case: only on discovered servers.
 *
 * `tm1.server.moveToFolder` is dropped because `detach` already brings the
 * folder choice for discovered servers along with it. When both stood side by side,
 * a server could be moved into a folder and still be left under the admin server
 * — exactly this mixed state forced the special case in `tm1.adminServer.remove`
 * that exempts children with a folder from deletion.
 *
 * The list is explicitly an enumeration, not a pattern: every further
 * entry is a decision and has to be justified here.
 */
const NUR_GEWOEHNLICH = ['tm1.server.moveToFolder'];
/** Deliberately drops away while impersonating — `tm1.impersonate.stop` takes its place. */
const NUR_OHNE_UEBERNAHME = ['tm1.impersonate.start'];
const AUSNAHMEN = ['tm1.adminServer.detach', ...NUR_GEWOEHNLICH];

describe('native TM1 Top and disconnected server menu matrix', () => {
  // Only the forms the node constructor can actually produce: `-v12` and `.git`
  // exist on CONNECTED nodes only (`tm1TreeNodes.ts`), so a disconnected server
  // is `serverRoot-disconnected` with an optional `-adm`.
  const forms = [
    ...['', '-v12'].flatMap(version => ['', '-adm'].flatMap(admin =>
      ['', '.git'].map(git => ({ state: 'connected', version, admin, value: `serverRoot-connected${version}${admin}${git}` })))),
    ...['', '-adm'].map(admin => ({ state: 'disconnected', version: '', admin, value: `serverRoot-disconnected${admin}` })),
  ];

  it.each(forms)('TM1 Top visibility for $value', ({ version, value }) => {
    const top = klauseln.filter(k => k.command === 'tm1.showTm1Top');
    expect(top).toHaveLength(1);
    expect(compileWhen(top[0].when)(value)).toBe(version === '');
  });

  it.each(forms.filter(f => f.state === 'disconnected'))('keeps profile actions for $value', ({ admin, value }) => {
    for (const command of ['tm1.server.connect', 'tm1.editServer', 'tm1.configureGit', 'tm1.server.moveToFolder']) {
      const entries = klauseln.filter(k => k.command === command && k.menu === 'view/item/context');
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(compileWhen(entry.when)(value), `${command}: ${value}`).toBe(command !== 'tm1.server.moveToFolder' || admin === '');
      }
    }
  });
});

describe('serverRoot when clauses tolerate the -adm marker', () => {
  it('finds the serverRoot clauses at all', () => {
    // If the selector falls apart, the rest of the test would be green and empty.
    expect(klauseln.length).toBeGreaterThanOrEqual(19);
  });

  it.each(klauseln.filter(k => !AUSNAHMEN.includes(k.command))
    .map(k => [`${k.menu}/${k.command}: ${k.when}`, k] as const))(
    '%s', (_label, k) => {
      const match = compileWhen(k.when);
      for (const [ordinary, adm] of PAARE) {
        if (match(ordinary)) {
          expect(`${ordinary} → ${adm}: ${match(adm)}`).toBe(`${ordinary} → ${adm}: true`);
        }
      }
    },
  );

  it('every clause matches at least one ordinary form (otherwise the test measures nothing)', () => {
    const tot = klauseln
      .filter(k => !AUSNAHMEN.includes(k.command))
      .filter(k => !PAARE.some(([ordinary]) => compileWhen(k.when)(ordinary)))
      .map(k => `${k.menu}/${k.command}`);
    expect(tot).toEqual([]);
  });
});

describe('tm1.adminServer.detach appears ONLY on discovered servers', () => {
  const detach = klauseln.filter(k => k.command === 'tm1.adminServer.detach');

  it('has exactly one menu clause', () => {
    expect(detach).toHaveLength(1);
  });

  it('matches all -adm forms and no ordinary one', () => {
    const match = compileWhen(detach[0].when);
    for (const [ordinary, adm] of PAARE) {
      expect(`${adm}: ${match(adm)}`).toBe(`${adm}: true`);
      expect(`${ordinary}: ${match(ordinary)}`).toBe(`${ordinary}: false`);
    }
  });
});

describe('commands that are deliberately missing on discovered servers', () => {
  it.each(NUR_GEWOEHNLICH)('%s matches all ordinary forms and no -adm form', (command) => {
    const treffer = klauseln.filter(k => k.command === command && k.menu === 'view/item/context');
    expect(treffer).toHaveLength(1);
    const match = compileWhen(treffer[0].when);
    for (const [ordinary, adm] of PAARE) {
      expect(`${ordinary}: ${match(ordinary)}`).toBe(`${ordinary}: true`);
      expect(`${adm}: ${match(adm)}`).toBe(`${adm}: false`);
    }
  });
});

// Request 2026-09-23: too many icons behind the servers. Deleting goes through
// the button of the edit form (`addServerPanel.ts`, `msg.type === 'delete'`),
// for ordinary as well as for discovered servers.
// Request 2026-10-26: delete several selected servers at once. The
// entry appears ONLY with multi-selection, the single-item menu stays lean.
describe('tm1.server.delete shows up in the tree only with multi-selection', () => {
  it('has exactly one context entry, bound to listMultiSelection', () => {
    const eintraege = klauseln.filter(k => k.command === 'tm1.server.delete' && k.menu === 'view/item/context');
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0].when).toContain('listMultiSelection');
  });
});

// So far the test above only checks one direction: whatever matches an ordinary
// form must also match the `-adm` form. A clause that accidentally becomes
// too broad (e.g. loses the v12 gate) does NOT stand out there — it would
// simply match more forms, and "matches more" does not break the rule above.
// The following blocks therefore each pin one exclusion, named after the command
// whose whole reason for existing is exactly this exclusion.

describe('tm1.server.v12ManageDatabases is visible ONLY on v12 forms', () => {
  it('matches NO non-v12 form', () => {
    const clauses = klauseln.filter(k => k.command === 'tm1.server.v12ManageDatabases');
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    const nichtV12 = ['serverRoot-connected', 'serverRoot-connected-adm', 'serverRoot-connected.git', 'serverRoot-connected-adm.git'];
    for (const k of clauses) {
      const match = compileWhen(k.when);
      for (const form of nichtV12) {
        expect(`${form}: ${match(form)}`).toBe(`${form}: false`);
      }
    }
  });
});

describe('tm1.saveDataAll is visible ONLY outside v12 (v12 has no SaveDataAll)', () => {
  it('matches NO v12 form', () => {
    const clauses = klauseln.filter(k => k.command === 'tm1.saveDataAll');
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    const v12Formen = ['serverRoot-connected-v12', 'serverRoot-connected-v12-adm', 'serverRoot-connected-v12.git', 'serverRoot-connected-v12-adm.git'];
    for (const k of clauses) {
      const match = compileWhen(k.when);
      for (const form of v12Formen) {
        expect(`${form}: ${match(form)}`).toBe(`${form}: false`);
      }
    }
  });
});

describe('tm1.git.pullAll is visible ONLY on .git forms', () => {
  it('matches NO form without the .git suffix', () => {
    const clauses = klauseln.filter(k => k.command === 'tm1.git.pullAll');
    expect(clauses.length).toBeGreaterThanOrEqual(1);
    const ohneGit = [
      'serverRoot-connected', 'serverRoot-connected-adm',
      'serverRoot-connected-v12', 'serverRoot-connected-v12-adm',
      'serverRoot-disconnected', 'serverRoot-disconnected-adm',
    ];
    for (const k of clauses) {
      const match = compileWhen(k.when);
      for (const form of ohneGit) {
        expect(`${form}: ${match(form)}`).toBe(`${form}: false`);
      }
    }
  });
});

describe('serverRoot when clauses tolerate the -imp marker', () => {
  it.each(klauseln.filter(k => !NUR_OHNE_UEBERNAHME.includes(k.command))
    .map(k => [`${k.menu}/${k.command}: ${k.when}`, k] as const))(
    '%s', (_label, k) => {
      const match = compileWhen(k.when);
      for (const [ordinary, imp] of IMP_PAARE) {
        if (match(ordinary)) {
          expect(`${ordinary} → ${imp}: ${match(imp)}`).toBe(`${ordinary} → ${imp}: true`);
        }
      }
    },
  );

  it('start and stop exclude each other', () => {
    const start = klauseln.find(k => k.command === 'tm1.impersonate.start' && k.menu === 'view/item/context');
    const stop = klauseln.find(k => k.command === 'tm1.impersonate.stop' && k.menu === 'view/item/context');
    expect(start && stop).toBeTruthy();
    const s = compileWhen((start as Klausel).when);
    const e = compileWhen((stop as Klausel).when);
    for (const form of ['serverRoot-connected', 'serverRoot-connected-adm', 'serverRoot-connected.git']) {
      expect(`${form} start/stop: ${s(form)}/${e(form)}`).toBe(`${form} start/stop: true/false`);
    }
    for (const form of ['serverRoot-connected-imp', 'serverRoot-connected-imp-adm', 'serverRoot-connected-imp.git']) {
      expect(`${form} start/stop: ${s(form)}/${e(form)}`).toBe(`${form} start/stop: false/true`);
    }
  });
});

// Deliberate decision (2026-09-20): the context menu of the instance was
// overloaded. Edit, Disconnect and Delete sit as handles in the row —
// there and only there. And "Find and Replace" carries the same
// subdivision on the server as on the process category, instead of a bare entry.
describe('instance menu: handles in the row, not additionally in the menu', () => {
  const menu = pkg.contributes.menus['view/item/context'] as
    { command?: string; submenu?: string; when?: string; group?: string }[];

  it.each(['tm1.editServer', 'tm1.server.disconnect'])(
    '%s appears only inline', (command) => {
      const eintraege = menu.filter(m => m.command === command);
      expect(eintraege.length).toBeGreaterThan(0);
      for (const e of eintraege) { expect(e.group ?? '', command).toMatch(/^inline/); }
    },
  );

  it('offers Find and Replace as a submenu, not as a bare entry', () => {
    expect(menu.filter(m => m.command === 'tm1.findReplaceObjects')).toHaveLength(0);
    const sub = menu.filter(m => m.submenu === 'tm1.findReplace');
    // ONE entry for BOTH node kinds. Until 2026-09-20 there were two here, and
    // VS Code silently discarded the second one ("The tm1.findReplace submenu was
    // already contributed to the view/item/context menu") — so the submenu was
    // missing entirely on the process category. The rule behind it is held
    // by `submenuContributedOnce.test.ts` for ALL submenus.
    expect(sub).toHaveLength(1);
    expect(sub[0].when ?? '').toMatch(/serverRoot-connected/);
    expect(sub[0].when ?? '').toMatch(/category-processes/);
    expect(pkg.contributes.menus['tm1.findReplace'].length).toBeGreaterThanOrEqual(3);
  });
});

// Order of the handles in the row (request 2026-09-20): Refresh,
// Edit, Disconnect, Delete. VS Code sorts inline entries by the
// group string, so the order is carried here.
describe('instance menu: order of the row handles', () => {
  const menu = pkg.contributes.menus['view/item/context'] as
    { command?: string; when?: string; group?: string }[];
  const inlineGruppe = (command: string) => {
    const e = menu.filter(m => m.command === command && (m.group ?? '').startsWith('inline'));
    expect(e, command).toHaveLength(1);
    return e[0].group!;
  };

  it('connected: refresh, edit, disconnect', () => {
    const folge = ['tm1.server.refresh', 'tm1.editServer', 'tm1.server.disconnect']
      .map(inlineGruppe);
    expect(folge).toEqual([...folge].sort());
    expect(new Set(folge).size).toBe(folge.length);
  });

  it('disconnected: edit, connect — connect takes the slot of disconnect', () => {
    const folge = ['tm1.editServer', 'tm1.server.connect'].map(inlineGruppe);
    expect(inlineGruppe('tm1.server.connect')).toBe(inlineGruppe('tm1.server.disconnect'));
    expect(folge).toEqual([...folge].sort());
    expect(new Set(folge).size).toBe(folge.length);
  });
});
