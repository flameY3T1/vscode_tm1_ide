import { describe, it, expect } from 'vitest';
import { attrColPickerHtml, attrColLabel } from '../webviewClient/dimensionBrowser/viewControls';
import { COL_INDEX, COL_WEIGHT } from '../webviewClient/dimensionBrowser/attrColumns';

const defs = [
  { Name: 'SITENAME', Type: 'Alias' },
  { Name: 'Kostenstelle', Type: 'String' },
  { Name: 'Jahr', Type: 'Numeric' },
];

describe('attrColPickerHtml — the checkbox list', () => {
  it('offers ALL attributes, not only the alias types', () => {
    // For displaying a value there is no reason to restrict the
    // type — unlike with the label, where a numeric
    // attribute would be a mix-up.
    const html = attrColPickerHtml(defs, []);
    // 3 attributes + the two placeholders Index/Weight.
    expect(html.match(/type="checkbox"/g)!.length).toBe(5);
    expect(html).toContain('Jahr');
  });

  it('marks alias attributes, and only those', () => {
    const html = attrColPickerHtml(defs, []);
    expect(html.match(/vw-attrcol-tag/g)!.length).toBe(1);
    expect(html).toMatch(/value="SITENAME">SITENAME<span class="vw-attrcol-tag">/);
  });

  it('ALWAYS offers Index and Weight, before the attributes and separated', () => {
    const html = attrColPickerHtml(defs, []);
    expect(html.indexOf('value="' + COL_INDEX + '"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('value="' + COL_WEIGHT + '"')).toBeGreaterThan(html.indexOf('value="' + COL_INDEX + '"'));
    // Both BEFORE the first real attribute, with the separator in between.
    expect(html.indexOf('value="' + COL_WEIGHT + '"')).toBeLessThan(html.indexOf('value="SITENAME"'));
    expect(html.indexOf('vw-attrcol-sep')).toBeLessThan(html.indexOf('value="SITENAME"'));
  });

  it('shows the placeholders with their label, not with the NUL name', () => {
    const html = attrColPickerHtml([], []);
    // The NUL stands in the `value`, but never in the visible text.
    expect(html).toContain('>' + attrColLabel(COL_INDEX) + '<');
    expect(html).toContain('>' + attrColLabel(COL_WEIGHT) + '<');
  });

  it('checks the chosen ones', () => {
    const html = attrColPickerHtml(defs, ['Jahr']);
    const jahr = html.slice(html.indexOf('value="Jahr"'));
    expect(jahr.slice(0, 60)).toContain('checked');
  });

  it('escapes names with special characters', () => {
    const html = attrColPickerHtml([{ Name: `A"<b>` }], []);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('without attributes a message instead of an empty area', () => {
    expect(attrColPickerHtml([], [])).toContain('vw-attrcol-empty');
  });

  it('without attributes Index and Weight are still there', () => {
    // They hang on the element, not on an attribute definition — a
    // dimension entirely without attributes must not lose them.
    const html = attrColPickerHtml([], []);
    expect(html.match(/type="checkbox"/g)!.length).toBe(2);
  });

  it('checks a chosen placeholder', () => {
    const html = attrColPickerHtml(defs, [COL_WEIGHT]);
    const w = html.slice(html.indexOf('value="' + COL_WEIGHT + '"'));
    expect(w.slice(0, 60)).toContain('checked');
    const i = html.slice(html.indexOf('value="' + COL_INDEX + '"'));
    expect(i.slice(0, 40)).not.toContain('checked');
  });
});
