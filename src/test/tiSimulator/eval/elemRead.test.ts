import { describe, it, expect } from 'vitest';
import { findBuiltin } from '../../../tiSimulator/eval/builtins';
import { emptyFixtures, attrKey, subsetKey } from '../../../tiSimulator/types';

function fx() {
  const f = emptyFixtures();
  f.dimensions.set('Konten', [
    { name: 'Total', level: 1, children: ['A', 'B'] },
    { name: 'A', level: 0 },
    { name: 'B', level: 0 },
  ]);
  f.attributes.set(attrKey('Konten', 'A', 'Desc'), 'Alpha');
  f.attributes.set(attrKey('Konten', 'A', 'Num'), 42);
  f.attributes.set(attrKey('Konten', '', 'DimDesc'), 'KontenDim');
  f.subsets.set(subsetKey('Konten', 'MySub'), ['A', 'B']);
  f.subsetProps.set(subsetKey('Konten', '', 'MySub'), { mdx: '{TM1SUBSETALL}' });
  return f;
}
const call = (name: string, args: (string | number)[]) => findBuiltin(name)!.invoke(args, fx());

describe('element/dim read builtins', () => {
  it('ElementIndex / ElementName', () => {
    expect(call('ElementIndex', ['Konten', '', 'B'])).toBe(3);
    expect(call('ElementIndex', ['Konten', '', 'nope'])).toBe(0);
    expect(call('ElementName', ['Konten', '', 2])).toBe('A');
    expect(call('ElementName', ['Konten', '', 99])).toBe('');
  });

  it('ElementType / ElementLevel', () => {
    expect(call('ElementType', ['Konten', '', 'Total'])).toBe('C');
    expect(call('ElementType', ['Konten', '', 'A'])).toBe('N');
    expect(call('ElementLevel', ['Konten', '', 'Total'])).toBe(1);
    expect(call('ElementLevel', ['Konten', '', 'A'])).toBe(0);
  });

  it('ElementComponent / ElementComponentCount (overrides stub)', () => {
    expect(call('ElementComponent', ['Konten', '', 'Total', 2])).toBe('B');
    expect(call('ElementComponentCount', ['Konten', '', 'Total'])).toBe(2);
    expect(call('ElementComponentCount', ['Konten', '', 'A'])).toBe(0);
  });

  it('ElementParent / ElementParentCount / ElementIsAncestor / ElementWeight', () => {
    expect(call('ElementParent', ['Konten', '', 'A', 1])).toBe('Total');
    expect(call('ElementParentCount', ['Konten', '', 'A'])).toBe(1);
    expect(call('ElementIsAncestor', ['Konten', '', 'Total', 'A'])).toBe(1);
    expect(call('ElementIsAncestor', ['Konten', '', 'A', 'Total'])).toBe(0);
    expect(call('ElementWeight', ['Konten', '', 'Total', 'A'])).toBe(1);
    expect(call('ElementWeight', ['Konten', '', 'Total', 'X'])).toBe(0);
  });

  it('ElementAttrS/N', () => {
    // Hierarchy as the second parameter, mandatory — the three-argument form is called
    // `ATTRS`/`ATTRN` (measured live on 11.8 with a compile probe, 2026-08-12).
    expect(call('ElementAttrS', ['Konten', 'Konten', 'A', 'Desc'])).toBe('Alpha');
    expect(call('ElementAttrN', ['Konten', 'Konten', 'A', 'Num'])).toBe(42);
    expect(call('ElementAttrS', ['Konten', 'Konten', 'A', 'None'])).toBe('');
  });

  it('legacy EL* / ATTR*', () => {
    expect(call('ELCOMP', ['Konten', 'Total', 1])).toBe('A');
    expect(call('ELCOMPN', ['Konten', 'Total'])).toBe(2);
    expect(call('ELPAR', ['Konten', 'A', 1])).toBe('Total');
    expect(call('ELPARN', ['Konten', 'A'])).toBe(1);
    expect(call('ELWEIGHT', ['Konten', 'Total', 'A'])).toBe(1);
    expect(call('ELISPAR', ['Konten', 'A', 'Total'])).toBe(1);
    expect(call('DNLEV', ['Konten'])).toBe(2);
    expect(call('ATTRS', ['Konten', 'A', 'Desc'])).toBe('Alpha');
    expect(call('ATTRN', ['Konten', 'A', 'Num'])).toBe(42);
  });

  it('DimensionElementExists', () => {
    expect(call('DimensionElementExists', ['Konten', 'A'])).toBe(1);
    expect(call('DimensionElementExists', ['Konten', 'X'])).toBe(0);
  });

  it('subset reads (Batch ⑤)', () => {
    expect(call('SubsetElementGetIndex', ['Konten', 'MySub', 'B'])).toBe(2);
    expect(call('SubsetElementGetIndex', ['Konten', 'MySub', 'X'])).toBe(0);
    expect(call('SubsetElementExists', ['Konten', 'MySub', 'A'])).toBe(1);
    expect(call('SubsetElementExists', ['Konten', 'MySub', 'X'])).toBe(0);
    expect(call('SubsetMDXGet', ['Konten', 'MySub'])).toBe('{TM1SUBSETALL}');
    expect(call('ReturnViewHandle', ['Reporting', 'MyView'])).toBe('MyView');
  });

  it('attr-locale + dimension attr + component/principal (Batch ⑤)', () => {
    expect(call('AttrSL', ['Konten', 'A', 'Desc', 'de'])).toBe('Alpha'); // locale ignored
    expect(call('ElementAttrNL', ['Konten', 'Konten', 'A', 'Num'])).toBe(42);
    expect(call('DimensionAttrS', ['Konten', 'DimDesc'])).toBe('KontenDim');
    expect(call('ElementIsComponent', ['Konten', '', 'Total', 'A'])).toBe(1);
    expect(call('ElementIsComponent', ['Konten', '', 'Total', 'X'])).toBe(0);
    expect(call('HierarchyElementPrincipalName', ['Konten', '', 'a'])).toBe('A');
  });

  it('security/sort writes are no-ops', () => {
    expect(call('ElementSecurityPut', ['Read', 'Konten', 'A', 'Grp'])).toBe(1);
    expect(call('DimensionSortOrder', ['Konten', '', 'ByName', 'Ascending', ''])).toBe(1);
  });
});
