import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  Tm1NodeType,
  Tm1TreeNode,
  getIconForNodeType,
  getDescriptionForNode,
} from '../providers/tm1TreeNodes';
import { DYNAMIC_SUBSET_MARK } from '../utils/dynamicSubsetMark';
import { ThemeIcon, TreeItemCollapsibleState, Uri } from './__mocks__/vscode';

/**
 * All Tm1NodeType values for enumeration-based tests.
 */
const allNodeTypes: Tm1NodeType[] = [
  'root',
  'category',
  'cube',
  'cubeSubCategory',
  'cubeDimension',
  'dimension',
  'dimSubCategory',
  'hierarchy',
  'attribute',
  'subset',
  'process',
  'processGroup',
  'chore',
  'thread',
  'cubeRule',
  'cubeView',
  'error',
];

describe('Custom SVG icons (Architect-style)', () => {
  const extUri = Uri.parse('file:///mock/ext');

  function expectIconPath(icon: any, lightName: string, darkName: string = lightName) {
    expect(icon).toHaveProperty('light');
    expect(icon).toHaveProperty('dark');
    expect(icon.light.fsPath.endsWith(`media/icons/light/${lightName}.svg`)).toBe(true);
    expect(icon.dark.fsPath.endsWith(`media/icons/dark/${darkName}.svg`)).toBe(true);
  }

  it('cube returns cube.svg pair', () => {
    expectIconPath(getIconForNodeType('cube', {}, extUri), 'cube');
  });

  it('dimension returns dimension.svg pair', () => {
    expectIconPath(getIconForNodeType('dimension', {}, extUri), 'dimension');
  });

  it('cubeDimension reuses dimension.svg', () => {
    expectIconPath(getIconForNodeType('cubeDimension', {}, extUri), 'dimension');
  });

  it('process returns process.svg pair', () => {
    expectIconPath(getIconForNodeType('process', {}, extUri), 'process');
  });

  it('processGroup uses the plural processes.svg', () => {
    expectIconPath(getIconForNodeType('processGroup', {}, extUri), 'processes');
  });

  it('thread returns thread.svg pair', () => {
    expectIconPath(getIconForNodeType('thread', {}, extUri), 'thread');
  });

  it('hierarchy returns hierarchy.svg pair', () => {
    expectIconPath(getIconForNodeType('hierarchy', {}, extUri), 'hierarchy');
  });

  it('attribute returns attribute.svg pair', () => {
    expectIconPath(getIconForNodeType('attribute', {}, extUri), 'attribute');
  });

  it('cubeRule returns cube-rule.svg pair', () => {
    expectIconPath(getIconForNodeType('cubeRule', {}, extUri), 'cube-rule');
  });

  it('messageLog returns message-log.svg pair', () => {
    expectIconPath(getIconForNodeType('messageLog', {}, extUri), 'message-log');
  });

  it('mdxRunner returns mdx-runner.svg pair', () => {
    expectIconPath(getIconForNodeType('mdxRunner', {}, extUri), 'mdx-runner');
    expectIconPath(getIconForNodeType('toolAction', { toolIcon: 'lineage' }, extUri), 'lineage');
    expect((getIconForNodeType('toolAction', { toolIcon: '$(symbol-variable)' }, extUri) as unknown as ThemeIcon).id).toBe('symbol-variable');
  });

  describe('variants', () => {
    it('serverRoot connected → server-live.svg, expired session → server-idle.svg', () => {
      expectIconPath(getIconForNodeType('serverRoot', { connected: true }, extUri), 'server-live');
      expectIconPath(getIconForNodeType('serverRoot', { connected: true, sessionIdle: true }, extUri), 'server-idle');
    });
    it('serverRoot disconnected → server-disconnected.svg', () => {
      expectIconPath(getIconForNodeType('serverRoot', { connected: false }, extUri), 'server-disconnected');
    });
    it('chore active → chore-active.svg', () => {
      expectIconPath(getIconForNodeType('chore', { active: true }, extUri), 'chore-active');
    });
    it('chore inactive → chore-inactive.svg', () => {
      expectIconPath(getIconForNodeType('chore', { active: false }, extUri), 'chore-inactive');
    });
    it('subset public → subset.svg', () => {
      expectIconPath(getIconForNodeType('subset', { isPrivate: false }, extUri), 'subset');
    });
    it('subset private → subset-private.svg', () => {
      expectIconPath(getIconForNodeType('subset', { isPrivate: true }, extUri), 'subset-private');
    });
    it('cubeView public → cube-view.svg', () => {
      expectIconPath(getIconForNodeType('cubeView', { isPrivate: false }, extUri), 'cube-view');
    });
    it('cubeView private → cube-view-private.svg', () => {
      expectIconPath(getIconForNodeType('cubeView', { isPrivate: true }, extUri), 'cube-view-private');
    });
  });

  describe('category folders', () => {
    it('Cubes → cube.svg (Perspectives-style reuse)', () => {
      expectIconPath(getIconForNodeType('category', { categoryKey: 'Cubes' }, extUri), 'cube');
    });
    it('Dimensions → dimension.svg', () => {
      expectIconPath(getIconForNodeType('category', { categoryKey: 'Dimensions' }, extUri), 'dimension');
    });
    it('Processes → processes.svg', () => {
      expectIconPath(getIconForNodeType('category', { categoryKey: 'Processes' }, extUri), 'processes');
    });
    it('Chores → chore-active.svg', () => {
      expectIconPath(getIconForNodeType('category', { categoryKey: 'Chores' }, extUri), 'chore-inactive');
    });
    it('Threads → thread.svg', () => {
      expectIconPath(getIconForNodeType('category', { categoryKey: 'Threads' }, extUri), 'thread');
    });
  });

  describe('sub-categories reuse entity icons (Perspectives-style)', () => {
    it('cubeSubCategory Dimensions → dimension.svg', () => {
      expectIconPath(getIconForNodeType('cubeSubCategory', { subKey: 'Dimensions' }, extUri), 'dimension');
    });
    it('cubeSubCategory Views → cube-view.svg', () => {
      expectIconPath(getIconForNodeType('cubeSubCategory', { subKey: 'Views' }, extUri), 'cube-view');
    });
    it('dimSubCategory Hierarchies → hierarchy.svg', () => {
      expectIconPath(getIconForNodeType('dimSubCategory', { subKey: 'Hierarchies' }, extUri), 'hierarchy');
    });
    it('dimSubCategory Attributes → attribute.svg', () => {
      expectIconPath(getIconForNodeType('dimSubCategory', { subKey: 'Attributes' }, extUri), 'attribute');
    });
    it('dimSubCategory Subsets → subset.svg', () => {
      expectIconPath(getIconForNodeType('dimSubCategory', { subKey: 'Subsets' }, extUri), 'subset');
    });
  });

  describe('folder-like sub-categories use the folder-action SVG', () => {
    it('cubeSubCategory without subKey uses folder-action.svg', () => {
      expectIconPath(getIconForNodeType('cubeSubCategory', {}, extUri), 'folder-action');
    });
    it('dimSubCategory without subKey uses folder-action.svg', () => {
      expectIconPath(getIconForNodeType('dimSubCategory', {}, extUri), 'folder-action');
    });
    it('snippetsRoot returns snippets.svg pair', () => {
      expectIconPath(getIconForNodeType('snippetsRoot', {}, extUri), 'snippets');
    });
    it('snippet returns snippets.svg pair', () => {
      expectIconPath(getIconForNodeType('snippet', {}, extUri), 'snippets');
    });
    it('error uses ThemeIcon error', () => {
      const icon = getIconForNodeType('error', {}, extUri);
      expect(icon).toBeInstanceOf(ThemeIcon);
      expect((icon as any).id).toBe('error');
    });
  });
});

// Feature: tm1-object-explorer, Property 5: Chore-Knoten spiegeln den Aktivierungsstatus wider
describe('Property 5: Chore-Knoten spiegeln den Aktivierungsstatus wider', () => {
  // **Validates: Requirements 2.10, 11.3**
  const extUri = Uri.parse('file:///mock/ext');

  it('active chores get icon "chore-active.svg" and description "Aktiv"', () => {
    fc.assert(
      fc.property(
        fc.record({ name: fc.string(), active: fc.constant(true) }),
        (chore) => {
          const icon: any = getIconForNodeType('chore', { active: chore.active }, extUri);
          const desc = getDescriptionForNode('chore', { active: chore.active });

          expect(icon.light.fsPath.endsWith('chore-active.svg')).toBe(true);
          expect(icon.dark.fsPath.endsWith('chore-active.svg')).toBe(true);
          expect(desc).toBe('Active');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('inactive chores get icon "chore-inactive.svg" and description "Inaktiv"', () => {
    fc.assert(
      fc.property(
        fc.record({ name: fc.string(), active: fc.constant(false) }),
        (chore) => {
          const icon: any = getIconForNodeType('chore', { active: chore.active }, extUri);
          const desc = getDescriptionForNode('chore', { active: chore.active });

          expect(icon.light.fsPath.endsWith('chore-inactive.svg')).toBe(true);
          expect(icon.dark.fsPath.endsWith('chore-inactive.svg')).toBe(true);
          expect(desc).toBe('Inactive');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any boolean active status, icon and description are consistent', () => {
    fc.assert(
      fc.property(
        fc.record({ name: fc.string(), active: fc.boolean() }),
        (chore) => {
          const icon: any = getIconForNodeType('chore', { active: chore.active }, extUri);
          const desc = getDescriptionForNode('chore', { active: chore.active });

          if (chore.active) {
            expect(icon.light.fsPath.endsWith('chore-active.svg')).toBe(true);
            expect(desc).toBe('Active');
          } else {
            expect(icon.light.fsPath.endsWith('chore-inactive.svg')).toBe(true);
            expect(desc).toBe('Inactive');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('serverFolder description shows connected/total when connectedCount present', () => {
    expect(getDescriptionForNode('serverFolder', { serverCount: 3, connectedCount: 2 })).toBe('2/3 connected');
    expect(getDescriptionForNode('serverFolder', { serverCount: 3, connectedCount: 0 })).toBe('0/3 connected');
    // falls back to plain count when connectedCount is absent
    expect(getDescriptionForNode('serverFolder', { serverCount: 3 })).toBe('3');
    expect(getDescriptionForNode('serverFolder', {})).toBeUndefined();
  });

  // A DYNAMIC subset resolves its members from an MDX expression. Without this
  // the tree presented it exactly like a static one — the reported confusion.
  it('subset description marks dynamic subsets with the shared ƒx symbol', () => {
    // Same glyph the Dimension Browser's subset dropdown appends (shared
    // constant — the dropdown side is asserted in dimBrowserDynamicSubset), and
    // it is a SYMBOL: untranslated, so no l10n key backs it.
    expect(getDescriptionForNode('subset', { isPrivate: false, isDynamic: true })).toBe(DYNAMIC_SUBSET_MARK);
    expect(getDescriptionForNode('subset', { isPrivate: true, isDynamic: true })).toBe(`private ${DYNAMIC_SUBSET_MARK}`);
    expect(getDescriptionForNode('subset', { isPrivate: true, isDynamic: false })).toBe('private');
    expect(getDescriptionForNode('subset', { isPrivate: false, isDynamic: false })).toBeUndefined();
    // Flag absent (older meta) → previous behaviour, unchanged.
    expect(getDescriptionForNode('subset', { isPrivate: true })).toBe('private');
    expect(getDescriptionForNode('subset', {})).toBeUndefined();
  });

  it('cubeView description is unaffected by the subset change', () => {
    expect(getDescriptionForNode('cubeView', { isPrivate: true, isDynamic: true })).toBe('private');
    expect(getDescriptionForNode('cubeView', { isPrivate: false })).toBeUndefined();
  });
});


// Feature: tm1-object-explorer, Property 6: Jeder Knotentyp hat ein definiertes Icon
describe('Property 6: Jeder Knotentyp hat ein definiertes Icon', () => {
  // **Validates: Requirements 11.1**
  const extUri = Uri.parse('file:///mock/ext');

  it('every node type returns either a ThemeIcon or a light/dark iconPath', () => {
    for (const nodeType of allNodeTypes) {
      const meta = buildMetaForType(nodeType);
      const icon: any = getIconForNodeType(nodeType, meta, extUri);
      const isThemeIcon = icon instanceof ThemeIcon;
      const isPath = !!(icon && typeof icon === 'object' && icon.light && icon.dark);
      expect(isThemeIcon || isPath).toBe(true);
    }
  });

  it('category nodes for each TM1 categoryKey return a custom SVG iconPath', () => {
    const categoryKeys = ['Cubes', 'Dimensions', 'Processes', 'Chores', 'Threads'];
    for (const key of categoryKeys) {
      const icon: any = getIconForNodeType('category', { categoryKey: key }, extUri);
      expect(icon.light).toBeDefined();
      expect(icon.dark).toBeDefined();
      expect(icon.light.fsPath.endsWith('.svg')).toBe(true);
    }
  });

  it('cube and category:Cubes share cube.svg (Perspectives-style)', () => {
    const cubeIcon: any = getIconForNodeType('cube', {}, extUri);
    const cubesCat: any = getIconForNodeType('category', { categoryKey: 'Cubes' }, extUri);
    expect(cubeIcon.light.fsPath).toBe(cubesCat.light.fsPath);
  });

  it('dimension and cubeDimension share dimension.svg (same entity)', () => {
    const dim: any = getIconForNodeType('dimension', {}, extUri);
    const cubeDim: any = getIconForNodeType('cubeDimension', {}, extUri);
    expect(dim.light.fsPath).toBe(cubeDim.light.fsPath);
  });

  it('processGroup and category:Processes share process.svg', () => {
    const procGroup: any = getIconForNodeType('processGroup', {}, extUri);
    const procCat: any = getIconForNodeType('category', { categoryKey: 'Processes' }, extUri);
    expect(procGroup.light.fsPath).toBe(procCat.light.fsPath);
  });

  it('cubeSubCategory and dimSubCategory share the folder-action SVG', () => {
    const cubeSub = getIconForNodeType('cubeSubCategory', {}, extUri) as any;
    const dimSub = getIconForNodeType('dimSubCategory', {}, extUri) as any;
    expect(cubeSub.dark.fsPath.endsWith('media/icons/dark/folder-action.svg')).toBe(true);
    expect(dimSub.dark.fsPath.endsWith('media/icons/dark/folder-action.svg')).toBe(true);
  });
});

describe('processGroup node id', () => {
  it('encodes serverId and groupName so it stays stable across refresh', () => {
    const node = new Tm1TreeNode(
      'processGroup',
      '_Load_#####',
      TreeItemCollapsibleState.Collapsed,
      { groupName: '_Load_#####', children: ['_Load_#####', '_Load_A'], serverId: 'srv1' },
    );
    expect(node.id).toBe('srv1:procGroup:_Load_#####');
  });
});

/** Helper: build reasonable meta for a given node type */
function buildMetaForType(nodeType: Tm1NodeType): Record<string, any> {
  switch (nodeType) {
    case 'category':
      return { categoryKey: 'Cubes' };
    case 'chore':
      return { active: true };
    case 'thread':
      return { state: 'Run', user: 'admin' };
    default:
      return {};
  }
}

describe('cube load state in the contextValue', () => {
  it('known state adds .loaded / .unloaded, unknown adds nothing', async () => {
    const { Tm1TreeNode } = await import('../providers/tm1TreeNodes');
    const cv = (loaded?: boolean) => new Tm1TreeNode('cube', 'Sales', 1 as never, { cubeName: 'Sales', serverId: 's', loaded }).contextValue;
    expect(cv(true)).toBe('cube.loaded');
    expect(cv(false)).toBe('cube.unloaded');
    expect(cv(undefined)).toBe('cube');
  });
});
