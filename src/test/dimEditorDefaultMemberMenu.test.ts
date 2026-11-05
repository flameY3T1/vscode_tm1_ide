import { describe, it, expect, vi } from 'vitest';
import { buildDefaultMemberItems } from '../webviewClient/dimensionEditor/defaultMemberMenu';

const LABELS = {
  set: 'Als Default-Element festlegen',
  reset: 'Default-Element zuruecksetzen',
  blockedDirty: 'Erst speichern — geschrieben wird gegen den Serverstand.',
  blockedDraft: 'Element steht noch nicht auf dem Server.',
};

const base = {
  element: 'A', hier: 'D', dirty: false, onServer: true,
  state: { hierarchy: 'D', effective: 'Top', explicit: '' },
  labels: LABELS,
  onSet: () => {},
};

describe('buildDefaultMemberItems', () => {
  it('offers "set" when the element is not the one that is set', () => {
    const items = buildDefaultMemberItems(base);
    expect(items.map(i => i.label)).toContain(LABELS.set);
    expect(items.every(i => !i.disabled)).toBe(true);
  });

  it('offers "reset" when the element is the one that IS SET', () => {
    const items = buildDefaultMemberItems({
      ...base, state: { hierarchy: 'D', effective: 'A', explicit: 'A' },
    });
    expect(items.map(i => i.label)).toContain(LABELS.reset);
    expect(items.map(i => i.label)).not.toContain(LABELS.set);
  });

  it('still offers "set" when the element is only effective by DERIVATION', () => {
    // effective === 'A' without explicit: TM1 derives it. Setting turns it into
    // an explicitly set value and is therefore not a dummy.
    const items = buildDefaultMemberItems({
      ...base, state: { hierarchy: 'D', effective: 'A', explicit: '' },
    });
    expect(items.map(i => i.label)).toContain(LABELS.set);
  });

  it('blocks with a reason when the draft is dirty', () => {
    const items = buildDefaultMemberItems({ ...base, dirty: true });
    expect(items[0].disabled).toBe(true);
    expect(items[0].title).toBe(LABELS.blockedDirty);
  });

  it('blocks for an element that only exists in the draft', () => {
    const items = buildDefaultMemberItems({ ...base, onServer: false });
    expect(items[0].disabled).toBe(true);
    expect(items[0].title).toBe(LABELS.blockedDraft);
  });

  it('passes the element name when setting, null when resetting', () => {
    const onSet = vi.fn();
    buildDefaultMemberItems({ ...base, onSet })[0].onClick?.();
    expect(onSet).toHaveBeenCalledWith('A');

    const onSet2 = vi.fn();
    buildDefaultMemberItems({
      ...base, onSet: onSet2, state: { hierarchy: 'D', effective: 'A', explicit: 'A' },
    })[0].onClick?.();
    expect(onSet2).toHaveBeenCalledWith(null);
  });

  it('does not block while the state is not loaded yet, but offers "set"', () => {
    const items = buildDefaultMemberItems({ ...base, state: undefined });
    expect(items[0].label).toBe(LABELS.set);
    expect(items[0].disabled).toBeFalsy();
  });
});
