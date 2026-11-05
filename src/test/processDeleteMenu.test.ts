import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

interface MenuItem { command?: string; when?: string }
interface Manifest { contributes: { menus: Record<string, MenuItem[]> } }

describe('TM1 Explorer process delete menu', () => {
  it('remains available while multiple processes are selected', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
    const item = pkg.contributes.menus['view/item/context']
      .find(entry => entry.command === 'tm1.deleteProcess' && entry.when?.includes('/^process'));

    expect(item).toBeDefined();
    expect(item?.when).not.toContain('!listMultiSelection');
  });
});
