import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createContext, runInContext } from 'vm';
import type { AuditResult, HostToWebview, WebviewToHost } from '../../webviewClient/feederAudit/protocol';
import { FEEDER_AUDIT_CSS, feederAuditBody, type FeederAuditL10n } from '../../webviews/feederAuditBodyPure';

/** Placeholder labels; the content does not matter here. */
const L: FeederAuditL10n = Object.fromEntries(
  ['heading', 'what', 'cost', 'caveatCost', 'caveatUndocumented',
    'scope', 'hits', 'noHits', 'noHitsHint', 'capped', 'dropped', 'colNr', 'openCell',
    'rangeFrom', 'rangeTo', 'rangeBad', 'next', 'cacheLabel', 'cacheHint',
    'feederHeading', 'feederNone', 'feederUnsure', 'feederSearching', 'feederFailed',
    'openRule', 'line', 'running', 'failed', 'rerun', 'details'].map((k) => [k, `<${k}>`]),
) as unknown as FeederAuditL10n;

const ROOT = join(__dirname, '../../..');
const BUNDLE = join(ROOT, 'out/webview/feederAudit.js');
const SOURCES = ['index.ts', 'protocol.ts'].map((f) => join(ROOT, 'src/webviewClient/feederAudit', f))
  .concat(join(ROOT, 'src/webviews/feederAuditBodyPure.ts'));
/** The client source — the bundle is minified, so the id scans read the source. */
const SCRIPT = readFileSync(SOURCES[0], 'utf8');
const ID_CALL = /\$(?:<\w+>)?\('([^']+)'\)/g;

/** Missing or stale bundle fails loudly instead of testing yesterday's state. */
function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(`Built webview bundle missing: ${BUNDLE}\nRun \`npm run compile\` first.`);
  }
  const built = statSync(BUNDLE).mtimeMs;
  const stale = SOURCES.filter((p) => statSync(p).mtimeMs > built);
  if (stale.length) {
    throw new Error(`Webview bundle is older than ${stale.join(', ')} — run \`npm run compile\`.`);
  }
  return readFileSync(BUNDLE, 'utf8');
}

// Minimal DOM: just what the window touches. getElementById only knows ids that
// really stand in the markup, so a wrong id throws here as it would in Electron.
class FakeEl {
  children: FakeEl[] = [];
  listeners: Record<string, (() => void)[]> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  checked = false;
  value = '';
  title = '';
  colSpan = 1;
  className = '';
  private text = '';
  constructor(public tagName: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.text = v; this.children = []; }
  get classList() {
    const parts = () => this.className.split(' ').filter(Boolean);
    return {
      add: (c: string) => { if (!parts().includes(c)) { this.className = [...parts(), c].join(' '); } },
      remove: (c: string) => { this.className = parts().filter((x) => x !== c).join(' '); },
      toggle: (c: string, on: boolean) => { if (on) { this.classList.add(c); } else { this.classList.remove(c); } },
      contains: (c: string) => parts().includes(c),
    };
  }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  addEventListener(t: string, f: () => void): void { (this.listeners[t] ??= []).push(f); }
  click(): void { (this.listeners.click ?? []).forEach((f) => f()); }
  all(): FakeEl[] { return [this, ...this.children.flatMap((c) => c.all())]; }
}

function boot() {
  const ids = new Map<string, FakeEl>();
  for (const m of feederAuditBody(L).matchAll(/id="([^"]+)"/g)) { ids.set(m[1], new FakeEl('x')); }
  const posted: WebviewToHost[] = [];
  let onMessage: ((ev: { data: HostToWebview }) => void) | undefined;
  const document = {
    getElementById: (id: string) => ids.get(id) ?? null,
    createElement: (tag: string) => new FakeEl(tag),
    // Only the one selector the window uses: tr.feeder[data-i="N"] td
    querySelector: (sel: string) => {
      const i = /^tr\.feeder\[data-i="(\d+)"\] td$/.exec(sel)?.[1];
      const tr = ids.get('rows')!.all().find((e) => e.className === 'feeder' && e.dataset.i === i);
      return tr?.children[0] ?? null;
    },
  };
  const window = {
    __feederAuditL10n: L,
    addEventListener: (t: string, f: typeof onMessage) => { if (t === 'message') { onMessage = f; } },
  };
  const ctx = createContext({
    window, document, acquireVsCodeApi: () => ({ postMessage: (m: WebviewToHost) => posted.push(m) }),
  });
  runInContext(readBundle(), ctx);
  return { ids, posted, send: (m: HostToWebview) => onMessage!({ data: m }), $: (id: string) => ids.get(id)! };
}

const RESULT: AuditResult = {
  cube: 'C', dimensionen: ['D1', 'D2'], verworfen: 1, gekappt: true, von: 1, bis: 10, cacheLeeren: true,
  treffer: [{ cube: 'C', koordinaten: ['a', 'b'] }, { cube: 'C', koordinaten: ['c', 'd'] }],
};

describe('Feeder-Audit-Fenster', () => {
  // The bundle is what really runs in the window; tsc and eslint see the source,
  // only this run proves the wiring between markup, bundle and host messages.
  it('the built bundle boots against the markup and renders a result', () => {
    const w = boot();
    expect(w.$('rows').children).toHaveLength(0);
    w.send({ type: 'result', ergebnis: structuredClone(RESULT) });
    expect(w.$('tbl').hidden).toBe(false);
    expect(w.$('controls').hidden).toBe(false);
    expect(w.$('von').value).toBe('1');
    expect(w.$('bis').value).toBe('10');
    expect(w.$('cache').checked).toBe(true);
    expect(w.$('scope').textContent).toBe('<scope>');
    expect(w.$('status').textContent).toBe('<hits><capped><dropped>');
    expect(w.$('head').children.map((c) => c.textContent)).toEqual(['<colNr>', 'D1', 'D2']);
    // A hit row plus its hidden feeder row per hit.
    const rows = w.$('rows').children;
    expect(rows.map((r) => r.className)).toEqual(['zelle', 'feeder', 'zelle', 'feeder']);
    expect(rows[1].hidden).toBe(true);
    expect(rows[1].textContent).toBe('<feederSearching>');

    // Expanding asks the host once; the answer fills the box; a feeder line opens the rule.
    rows[0].click();
    expect(rows[1].hidden).toBe(false);
    expect(w.posted).toEqual([{ type: 'matchCell', index: 0 }]);
    w.send({ type: 'cellFeeder', index: 0, feeder: [{ zeile: 4, text: 'F', sicher: false, grund: 'g' }] });
    const item = rows[1].all().find((e) => e.className === 'feeder-item unsure')!;
    expect(item.textContent).toBe('<line>F  \u2014 <feederUnsure>');
    item.click();
    expect(w.posted.at(-1)).toEqual({ type: 'openRule', zeile: 4 });
    rows[0].click();
    rows[0].click();
    expect(w.posted.filter((m) => m.type === 'matchCell')).toHaveLength(1);

    // Next shifts the range by its own width and starts a run.
    w.$('weiter').click();
    expect(w.posted.at(-1)).toEqual({ type: 'rerun', von: 11, bis: 20, cacheLeeren: true });
    expect(w.$('status').textContent).toBe('<running>');
    expect(w.$('tbl').hidden).toBe(true);

    // An invalid range does not post.
    const before = w.posted.length;
    w.$('von').value = '5';
    w.$('bis').value = '5';
    w.$('rerun').click();
    expect(w.$('bereichFehler').hidden).toBe(false);
    expect(w.posted).toHaveLength(before);

    w.send({ type: 'result', ergebnis: { ...RESULT, fehler: 'boom' } });
    expect(w.$('status').classList.contains('err')).toBe(true);
    expect(w.$('status').textContent).toBe('<failed>');
  });

  // "A laid wire is not a connected wire": the script accesses elements
  // by their id. If one is missing from the markup, `textContent` throws on `null` — and
  // only at runtime, in the middle of building, so that the rest of the page is missing.
  it('every id the script looks for is in the markup', () => {
    const body = feederAuditBody(L);
    const gesucht = [...SCRIPT.matchAll(ID_CALL)].map((m) => m[1]);
    expect(gesucht.length).toBeGreaterThan(5);
    const fehlend = [...new Set(gesucht)].filter((id) => !body.includes(`id="${id}"`));
    expect(fehlend, 'Ids im Script ohne Gegenstueck im Markup').toEqual([]);
  });

  // Conversely: an id in the markup that nobody touches is either dead or
  // a forgotten connection. Both should stand out.
  it('every id in the markup is used by the script', () => {
    const body = feederAuditBody(L);
    const vorhanden = [...body.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const unbenutzt = vorhanden.filter((id) => !SCRIPT.includes(`'${id}'`));
    expect(unbenutzt, 'Ids im Markup, die das Script nie anfasst').toEqual([]);
  });

  it('all labels of the markup come from the l10n table', () => {
    const body = feederAuditBody(L);
    // Every label that the markup sets itself must be a placeholder.
    for (const schluessel of [
      'details', 'caveatCost', 'caveatUndocumented', 'running', 'rerun', 'heading', 'what', 'cost',
      'rangeFrom', 'rangeTo', 'rangeBad', 'next', 'cacheLabel', 'cacheHint',
    ]) {
      expect(body).toContain(`<${schluessel}>`);
    }
  });

  // `[hidden]` loses against every author rule with `display` — the browser sheet
  // brings it along, an own sheet beats it. Without `!important` the
  // rows hidden in advance would stay visible.
  it('the stylesheet enforces [hidden]', () => {
    expect(FEEDER_AUDIT_CSS).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
});
