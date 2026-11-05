/**
 * Default state of the checkbox "save as dynamic subset (MDX)".
 *
 * Base rule: on whenever a dynamic expression is available — that
 * is the form that grows along, and the browser can by now build it for almost
 * every state.
 *
 * The exception is overwriting a subset that is STATIC on the server.
 * Someone who opens a native subset, changes something and saves it back
 * does not want to turn it into a dynamic one on the side: the member list
 * would then no longer be fixed but a rule that changes with the dimension.
 * This conversion should remain a deliberate action, not a
 * default value.
 *
 * A target name that does not exist yet has no history — the base rule
 * applies there. TM1 compares subset names case-insensitively (cf. `baseIsTarget`).
 */

import { describe, it, expect } from 'vitest';
import { dynamicSaveDefaultOn } from '../webviewClient/dimensionBrowser/drillModel';

const KNOWN = [
  { name: 'StatischNord', isPrivate: false, isDynamic: false },
  { name: 'DynamischSued', isPrivate: false, isDynamic: true },
  { name: 'PrivatStatisch', isPrivate: true, isDynamic: false },
];

describe('dynamicSaveDefaultOn', () => {
  it('is on when a dynamic expression is possible and the name is new', () => {
    expect(dynamicSaveDefaultOn(true, { name: 'GanzNeu', isPrivate: false }, KNOWN)).toBe(true);
  });

  it('is off when the target is static on the server', () => {
    expect(dynamicSaveDefaultOn(true, { name: 'StatischNord', isPrivate: false }, KNOWN)).toBe(false);
  });

  it('compares the name case-insensitively — just like TM1 itself', () => {
    expect(dynamicSaveDefaultOn(true, { name: 'statischnord', isPrivate: false }, KNOWN)).toBe(false);
  });

  it('distinguishes private from public — same name, different subset', () => {
    // There is no public "PrivatStatisch", so there is no history.
    expect(dynamicSaveDefaultOn(true, { name: 'PrivatStatisch', isPrivate: false }, KNOWN)).toBe(true);
    expect(dynamicSaveDefaultOn(true, { name: 'PrivatStatisch', isPrivate: true }, KNOWN)).toBe(false);
  });

  it('stays on when the target is already dynamic', () => {
    expect(dynamicSaveDefaultOn(true, { name: 'DynamischSued', isPrivate: false }, KNOWN)).toBe(true);
  });

  it('is off as soon as no dynamic expression is available at all', () => {
    expect(dynamicSaveDefaultOn(false, { name: 'GanzNeu', isPrivate: false }, KNOWN)).toBe(false);
  });

  it('without a known subset list the base rule applies — no guessing', () => {
    // The list comes from the host; if it is (still) empty, "no history"
    // is the only statement that can be backed up.
    expect(dynamicSaveDefaultOn(true, { name: 'StatischNord', isPrivate: false }, [])).toBe(true);
  });

  it('an entry without a flag does not count as static — unknown is not native', () => {
    // `SubsetRef.isDynamic` is optional (older/partial producers such as
    // `setMode`'s `initialSubset` only identify the subset).
    const partial = [{ name: 'StatischNord', isPrivate: false }];
    expect(dynamicSaveDefaultOn(true, { name: 'StatischNord', isPrivate: false }, partial)).toBe(true);
  });
});
