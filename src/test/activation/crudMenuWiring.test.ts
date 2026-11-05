import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// vitest runs with the project root directory as cwd — same approach as
// src/test/i18n/bundleParity.test.ts, so that no resolveJsonModule is needed.
function loadJson<T>(...seg: string[]): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), ...seg), 'utf8')) as T;
}

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    menus: Record<string, Array<{ command?: string; when?: string; group?: string }>>;
  };
}

interface Expectation {
  command: string;
  /** Complete, exact `when` string from the manifest — no substring check. */
  when: string;
  group: string;
  /**
   * Further entries with the same command + group that are NOT meant here
   * (e.g. `tm1.openCubeViewer` sits in `1_actions@0` on both the cube and the
   * view node). They are filtered out before the uniqueness check.
   */
  notWhen?: string[];
}

const EXPECTED: Expectation[] = [
  // Control row: already exists — must pass.
  { command: 'tm1.deleteSubset', when: 'viewItem == subset', group: '2_crud@0' },
  // The three delete commands DELIBERATELY match only the non-control form of the
  // contextValues (`dimension`, `cube`/`cube-v12`, `hierarchy`). Control objects
  // (`}…`) carry `-control` and therefore drop out of the menu — see CONTROL_AWARE.
  // Without `!listMultiSelection`: both commands take the selection as their second
  // argument (`deleteCubesCommand`/`deleteDimensionsCommand`). With the
  // clause, the entry disappeared as soon as someone selected more than one — and
  // did so silently.
  { command: 'tm1.deleteDimension', when: 'viewItem == dimension', group: '2_crud@1' },
  { command: 'tm1.deleteCube', when: String.raw`viewItem =~ /^cube(-v12)?(-haspick)?(\.loaded|\.unloaded)?$/`, group: '2_crud@1' },
  { command: 'tm1.createHierarchy', when: 'viewItem =~ /^dimension(-control)?$/ && !listMultiSelection', group: '2_crud@0' },
  { command: 'tm1.deleteHierarchy', when: 'viewItem == hierarchy && !listMultiSelection', group: '2_crud@1' },
  // Picklist control cube: the two entries are mutually
  // exclusive. `-haspick` says that `}PickList_<Cube>` already exists — then
  // Delete is in the menu, otherwise Create. Control cubes carry no `-haspick` and
  // drop out of both (a `}PickList_X` has none itself).
  { command: 'tm1.createPicklistCube', when: String.raw`viewItem =~ /^cube(-v12)?(\.loaded|\.unloaded)?$/`, group: '5_maintenance@6' },
  { command: 'tm1.deletePicklistCube', when: String.raw`viewItem =~ /^cube(-v12)?-haspick(\.loaded|\.unloaded)?$/`, group: '5_maintenance@7' },
];

// Building blocks of the control-aware `when` clauses. Control nodes carry the
// suffix `-control`, which is why `viewItem == dimension` is no longer enough.
// `-haspick` marks a base cube that already has a `}PickList_<Cube>`.
// Every anchored cube rule must take the suffix along, otherwise all menu
// entries disappear on exactly these cubes.
// `.loaded`/`.unloaded`: Load and Unload are either-or (see tm1TreeNodes.ts);
// every other cube entry has to accept both suffixes and their absence.
const CUBE = String.raw`viewItem =~ /^cube(-v12)?(-control)?(-haspick)?(\.loaded|\.unloaded)?$/`;
const DIM = String.raw`viewItem =~ /^dimension(-control)?$/`;
const HIER = String.raw`viewItem =~ /^hierarchy(-control)?$/`;
const DIM_TRIO = `${DIM} || viewItem == cubeDimension || ${HIER}`;

/**
 * Every menu entry that targets cube/dimension/hierarchy nodes and MUST be kept
 * for control objects (delete excepted, see EXPECTED).
 *
 * Identified via command + group, because individual commands (openCubeViewer,
 * openCubeRules) contribute several times with different `when` clauses.
 */
const CONTROL_AWARE: Expectation[] = [
  { command: 'tm1.openCubeViewer', when: CUBE, group: '1_actions@0', notWhen: ['viewItem == cubeView'] },
  { command: 'tm1.openCubeRules', when: CUBE, group: '1_actions@1' },
  { command: 'tm1.newMdxView', when: CUBE, group: '1_actions@2' },
  // v11-only: `cube-v12` stays out, `cube-control` must be in.
  // Not on `.unloaded`: an unloaded cube has nothing in memory to save.
  { command: 'tm1.cubeSaveData', when: String.raw`viewItem =~ /^cube(-control)?(-haspick)?(\.loaded)?$/`, group: '5_maintenance@0' },
  // Same slot, either-or: without a known state (no suffix) both show.
  { command: 'tm1.cubeUnload', when: String.raw`viewItem =~ /^cube(-v12)?(-control)?(-haspick)?(\.loaded)?$/`, group: '5_maintenance@1' },
  { command: 'tm1.cubeLoad', when: String.raw`viewItem =~ /^cube(-v12)?(-control)?(-haspick)?(\.unloaded)?$/`, group: '5_maintenance@1' },
  { command: 'tm1.reorderCubeDimensions', when: CUBE, group: '5_maintenance@5' },
  { command: 'tm1.security.element', when: DIM_TRIO, group: 'security' },
  { command: 'tm1.security.cell', when: CUBE, group: 'security' },
  { command: 'tm1.browseElements', when: DIM_TRIO, group: '1_actions' },
  { command: 'tm1.editDimension', when: DIM_TRIO, group: '1_actions@1' },
  {
    command: 'tm1.findReferences',
    when: `(${CUBE} || ${DIM} || viewItem == cubeDimension || ${HIER}`
      + String.raw` || viewItem =~ /^process($|\.git$)/ || viewItem == chore) && !listMultiSelection`,
    group: '3_refs@0',
  },
  {
    command: 'tm1.insertNodeRef',
    when: String.raw`(viewItem =~ /^process($|\.git$)/ || viewItem == chore || `
      + `${CUBE} || ${DIM} || viewItem == cubeDimension || ${HIER}) && !listMultiSelection`,
    group: '3_refs@1',
  },
  {
    command: 'tm1.copyName',
    when: String.raw`(viewItem =~ /^process($|\.git$)/ || viewItem =~ /^processGroup(\.grouped)?$/ || `
      + `${CUBE}` + String.raw` || viewItem =~ /^cubeRule($|\.git$)/ || viewItem == cubeView || `
      + `viewItem == cubeDimension || ${DIM} || ${HIER}`
      + ` || viewItem == attribute || viewItem == subset || viewItem == chore) && !listMultiSelection`,
    group: '9_clipboard',
  },
];

/** `when` can appear in the manifest as the string "false" or as the boolean false. */
function isHidden(when: unknown): boolean {
  return when === false || when === 'false';
}

describe('explorer CRUD menu wiring', () => {
  const pkg = loadJson<Manifest>('package.json');
  const nlsEn = loadJson<Record<string, string>>('package.nls.json');
  const nlsDe = loadJson<Record<string, string>>('package.nls.de.json');
  // The "Recent" list carries its own copies on its own contextValue;
  // recentTreeProvider.test.ts pins those.
  const items = (pkg.contributes.menus['view/item/context'] ?? [])
    .filter((m) => !(m.when ?? '').startsWith('view == tm1.recent'));
  const palette = pkg.contributes.menus['commandPalette'] ?? [];

  for (const e of EXPECTED) {
    it(`${e.command} declared, titled in EN+DE and wired with when="${e.when}"`, () => {
      const decl = pkg.contributes.commands.find((c) => c.command === e.command);
      expect(decl, `${e.command} fehlt in contributes.commands`).toBeDefined();
      expect(decl!.title).toBe(`%${e.command}.title%`);
      expect(nlsEn[`${e.command}.title`], 'EN-Titel fehlt').toBeTruthy();
      expect(nlsDe[`${e.command}.title`], 'DE-Titel fehlt').toBeTruthy();

      const menu = items.filter((m) => m.command === e.command);
      expect(menu.length, `${e.command} fehlt in view/item/context`).toBe(1);
      expect(menu[0].when).toBe(e.when);
      expect(menu[0].group).toBe(e.group);

      // Tree commands do not belong in the command palette: there is no
      // node there, and the handler returned without a word.
      const hidden = palette.filter((m) => m.command === e.command);
      expect(hidden.length, `${e.command} fehlt in menus.commandPalette`).toBe(1);
      expect(isHidden(hidden[0].when), `${e.command} ist in der Palette nicht ausgeblendet`).toBe(true);
    });
  }
});

describe('control objects keep every non-delete menu entry', () => {
  const pkg = loadJson<Manifest>('package.json');
  const items = (pkg.contributes.menus['view/item/context'] ?? [])
    .filter((m) => !(m.when ?? '').startsWith('view == tm1.recent'));

  for (const e of CONTROL_AWARE) {
    it(`${e.command} (${e.group}) also matches the -control form`, () => {
      const menu = items.filter((m) =>
        m.command === e.command
        && m.group === e.group
        && !(e.notWhen ?? []).includes(m.when ?? ''));
      expect(menu.length, `${e.command} in Gruppe ${e.group} nicht eindeutig in view/item/context`).toBe(1);
      expect(menu[0].when).toBe(e.when);
    });
  }

  it('no menu entry checks plain equality on dimension/hierarchy', () => {
    // `viewItem == dimension` / `viewItem == hierarchy` excludes control nodes.
    // This is only allowed for the two delete commands — exactly there it is
    // intended and pinned down exactly in EXPECTED.
    const deleteOnly = new Set(['tm1.deleteDimension', 'tm1.deleteHierarchy']);
    const offenders = items
      .filter((m) => !deleteOnly.has(m.command ?? ''))
      .filter((m) => /viewItem == (dimension|hierarchy)\b/.test(m.when ?? ''))
      .map((m) => `${m.command} [${m.group}]`);
    expect(offenders).toEqual([]);
  });

  it('only deleteCube and createPicklistCube use the control-less cube regex', () => {
    // `createPicklistCube` deliberately belongs here: on a `}PickList_X` there is
    // nothing to create, and on a cube with `-haspick` there is nothing left to create either.
    const controlLessOk = new Set(['tm1.deleteCube', 'tm1.createPicklistCube']);
    const offenders = items
      .filter((m) => !controlLessOk.has(m.command ?? ''))
      .filter((m) => (m.when ?? '').includes(String.raw`/^cube(-v12)?(\.loaded|\.unloaded)?$/`))
      .map((m) => `${m.command} [${m.group}]`);
    expect(offenders).toEqual([]);
  });
});
