export {};

import { getL10n, fmt } from '../_shared/l10n';
import type { ViewState, Intent } from './intents';
import { orderIsReplaced } from './intents';
import type { FilterLayer } from './filterPredicate';
import type { ChainProjection } from './protocol';
// One source for HTML escaping (see `pure.ts`), instead of a hand copy per file.
import { esc } from './pure';

const L = getL10n();

/**
 * The trail: the stack from left to right, as a display — not as a control
 * panel.
 *
 * ONLY the right end carries an undo. The reason is the point-in-time-x
 * semantics (spec, "The decision"): pulling a layer from the middle would mean
 * applying all those above it to a set that did not exist back then. That
 * would be a recomputation that looks like an undo.
 *
 * The user-visible texts go through `getL10n` like in the whole rest of the
 * extension. The earlier deferral ("hard-coded German, translation happens in
 * plan 9") was rejected by flameY3T1 on 2026-08-22: source text is English,
 * German comes from the bundle — even behind a flag, otherwise every text
 * would later have to be rewritten into English first.
 *
 * The base label is the SAME string as on the button
 * (`vwBaseMembers`/`vwBaseAll`, see `dimensionBrowserBody.ts`) — before, the
 * same thing was called "Members" on the button and "Baum" in the trail.
 *
 * The fallbacks behind `??` carry plain English TEXT, not the key name: if a
 * key drops out of the bundle, `vwTrailSortHier` would otherwise appear as a
 * label in the trail bar. Same rule as in `viewCtx.ts`
 * (`?? 'Only this element'`).
 */

export function layerLabel(l: FilterLayer): string {
  switch (l.kind) {
    // With an alias, its name stands instead of the word "Name": two searches
    // with the same pattern but a different alias return different rows
    // (measured live: `"*_C"` hits 272 names, but 5 aliases) — they must not
    // look the same in the trail.
    case 'pattern': return l.attr
      ? fmt(L, 'vwTrailPatternAttr', l.attr, l.pattern)
      : fmt(L, 'vwTrailPattern', l.pattern);
    case 'type': return fmt(L, 'vwTrailType', l.types.join(', '));
    case 'level': return fmt(L, 'vwTrailLevel', l.levels.join(', '));
    // Attribute AND value, because both determine the layer — "NAME" alone
    // would not say what was searched for, and "bahn" alone not where.
    // Without a chosen attribute the layer searches everywhere — that belongs
    // in the label, otherwise it looks like a filter on an attribute.
    case 'attr': return l.withName || l.attrs.length !== 1
      ? fmt(L, 'vwTrailAttrAny', l.value)
      : fmt(L, 'vwTrailAttr', l.attrs[0] ?? '', l.value);
    default: {
      const unreachable: never = l;
      throw new Error(`unbekannte Filterschicht: ${JSON.stringify(unreachable)}`);
    }
  }
}

function intentLabel(i: Intent): string {
  switch (i.kind) {
    case 'collapse': return fmt(L, 'vwTrailCollapsed', i.member);
    // Separate text for "fully": the trail should distinguish the two acts,
    // otherwise the same thing stands there twice for different things.
    case 'expand':
      return fmt(L, i.recursive ? 'vwTrailExpandedFully' : 'vwTrailExpanded', i.member);
    // What was sorted by belongs to it: by name and by alias are two
    // different orders, and in the trail they must not look the same (the same
    // reasoning as for the pattern chip).
    case 'add': return fmt(L, 'vwTrailAdded', i.names.length);
    case 'rollup': return fmt(L, 'vwTrailParents', i.member);
    // The NAME of the parent, not of the child: the trail should say what was
    // added, and "Parents of a" would be a lie here — it is a single one.
    case 'pick-parent': return fmt(L, 'vwTrailParentPicked', i.parent);
    case 'sort': {
      if (i.mode === 'hierarchy') { return L.vwTrailSortHier ?? 'HIERARCHIZE'; }
      // The index knows no alias — it is not a label.
      if (i.mode === 'index-asc') { return L.vwTrailSortIndexAsc ?? 'index ASC'; }
      if (i.mode === 'index-desc') { return L.vwTrailSortIndexDesc ?? 'index DESC'; }
      const KEYS = {
        'hier-asc': 'vwTrailSortHierAsc', 'hier-desc': 'vwTrailSortHierDesc',
        asc: 'vwTrailSortAsc', desc: 'vwTrailSortDesc',
      } as const;
      return fmt(L, KEYS[i.mode], i.attr ?? (L.optName ?? ''));
    }
    case 'filter': return layerLabel(i.layer);
    // The NUMBER, not the list: spelling out a selection of 400 elements as a
    // chip makes the trail unreadable. What exactly is meant stands in full in
    // the MDX bar above.
    case 'keep': return fmt(L, 'vwTrailKept', i.names.length);
    case 'remove': return fmt(L, 'vwTrailRemoved', i.names.length);
    default: {
      const unreachable: never = i;
      throw new Error(`unbekannte Absicht: ${JSON.stringify(unreachable)}`);
    }
  }
}

function baseLabel(v: ViewState): string {
  switch (v.base.kind) {
    case 'tree': return L.vwBaseMembers ?? 'Members';
    case 'set': return L.vwBaseAll ?? 'All';
    case 'roots': return L.vwBaseRoots ?? 'Roots';
    case 'explicit': return fmt(L, 'vwBaseExplicit', v.base.names.length);
    case 'mdx': return v.base.label || (L.vwBaseMdx ?? 'MDX');
    default: {
      const unreachable: never = v.base;
      throw new Error(`unbekannte Basis: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function trailHtml(v: ViewState, preview?: FilterLayer | null): string {
  const parts = [`<span class="vw-trail-base">${esc(baseLabel(v))}</span>`];
  v.intents.forEach((i, idx) => {
    const last = idx === v.intents.length - 1;
    const pop = last
      ? `<button class="vw-trail-pop" title="${esc(L.vwTrailPopTitle ?? '')}">&times;</button>`
      : '';
    parts.push(`<span class="vw-trail-chip">${esc(intentLabel(i))}${pop}</span>`);
  });
  // The typed layer is appended at the end, WITH its own class and WITHOUT `x`.
  // Without the special treatment the undo `x` would sit on it — and a click
  // on it would remove the topmost REAL layer, because `popLayer` acts on
  // `intents`, where a preview never lies. An `x` that deletes something other
  // than what it is labeled.
  if (preview) {
    parts.push(`<span class="vw-trail-chip vw-trail-pending"`
      + ` title="${esc(L.vwTrailPendingTitle ?? '')}">${esc(layerLabel(preview))}</span>`);
  }
  return parts.join('<span class="vw-trail-sep">&rsaquo;</span>');
}

/**
 * Which chain projection this stack needs (task 2).
 *
 * Only order what is needed: `'name+element'` quadruples the payload (110 kB
 * to 381 kB, spec block D), but costs no time. A pattern filter gets by with
 * the names.
 *
 * `switch` per filter layer instead of `.some(... i.layer.kind === 'type' ||
 * i.layer.kind === 'level')` (final review 2026-08-22): a third filter kind
 * that needs per-ancestor metadata — the attribute filter of the next plan is
 * exactly that — would silently fall back to `'name'` with the `||` chain and
 * set up the display wrongly, without a compiler error reporting it. The
 * `never` trap here has the same form as `filterPredicate.ts#matchesLayer`.
 */
function layerNeedsElement(l: FilterLayer): boolean {
  switch (l.kind) {
    case 'type': return true;
    case 'level': return true;
    case 'pattern': return false;
    // The attribute filter needs an ATTRIBUTE VALUE per ancestor, not type and
    // level — that is the second, independent axis of the projection (see
    // `chainFor`). Ordering the element projection as well cost 6.72 instead
    // of 2.85 MB per window (live 2026-08-23) for fields nobody reads.
    case 'attr': return false;
    default: {
      const unreachable: never = l;
      throw new Error(`unbekannte Filterschicht: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Which attributes this layer needs per ancestor. */
function layerAttrs(l: FilterLayer): readonly string[] {
  switch (l.kind) {
    case 'attr': return l.attrs;
    // A search with a display alias compares the ALIAS, not the name — so the
    // ancestor needs it too, otherwise the display indents wrongly.
    case 'pattern': return l.attr ? [l.attr] : [];
    case 'type': return [];
    case 'level': return [];
    default: {
      const unreachable: never = l;
      throw new Error(`unbekannte Filterschicht: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Which chain projection the current stack needs.
 *
 * TWO independent axes, since the attribute filter exists: type/level
 * (`kind`) and an attribute value (`attr`). Throwing them together would mean
 * ordering fields for an attribute filter that nobody reads.
 *
 * `keep`/`remove` do NOT report here: they compare names, and the name is in
 * every projection.
 *
 * SEVERAL attributes are possible since the search follows the display alias:
 * an attribute filter on `5-Stellig` under a search in the alias `NAME` needs
 * both. What becomes of that is decided by `buildSetExprQuery` — the path form
 * carries only one, with several it goes to the whole collection.
 */
export function chainFor(v: ViewState): ChainProjection {
  let kind: 'name' | 'name+element' = 'name';
  const attrs: string[] = [];
  for (const i of v.intents) {
    if (i.kind !== 'filter') { continue; }
    if (layerNeedsElement(i.layer)) { kind = 'name+element'; }
    for (const a of layerAttrs(i.layer)) {
      if (a && attrs.indexOf(a) < 0) { attrs.push(a); }
    }
  }
  // All parents of EVERY row, as soon as the answer is NOT in tree order.
  //
  // They are only needed there: over a tree order the ancestor chain already
  // answers the indentation question. Over a foreign set, by contrast, the
  // server names the NATURAL parent, which does not occur in the list at all
  // (live `Cube A/Default`, 11.8, 2026-08-23) — the display therefore stayed
  // flat. Costs measured: window 200 with 456 ms / 33.8 KB, without 504 ms /
  // 20.3 KB — no second round trip, no noticeable time.
  const parents = orderIsReplaced(v);
  const basis = parents ? { kind, parents } : { kind };
  return attrs.length ? { ...basis, attrs } : basis;
}
