// src/commands/cube/picklistCube.ts
// Create and delete the picklist control cube `}PickList_<Cube>`.
//
// Deliberately ONLY these two commands: once the cube exists, it is edited
// with the existing tools — cells in the Cube Viewer, definitions as a rule
// in the Rule Editor (both reachable once "Show control objects" is on).
// The exact same division of labor as in TM1 Architect. A dedicated editor
// would be duplicate work.
//
// What does NOT happen: automatically opening the freshly created cube in
// the Cube Viewer. The control cube is as large as its base cube, and a
// full read on it took, in measurement, more than 10 minutes (see
// docs/architecture/cube-viewer.md and the picklist measurement notes).
// The user opens it themselves if they want to.
import * as vscode from 'vscode';
import { getServerConfig } from '../../serverState/state';
import { confirmAndRun } from '../confirmAndRun';
import { apiRequest } from '../../tm1Rest/client';
import {
  createCube, deleteCube, cubeExists, getCubeDimensionNames,
} from '../../tm1Rest/cubeApi';
import { createDimension } from '../../tm1Rest/dimensionApi';
import { RuleEditorManager } from '../rule/ruleEditor';
import { encodeODataKey } from '../../utils/odataKey';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import {
  PICKLIST_DIM, picklistCubeName, buildPicklistCubeBody, buildPicklistDimensionBody,
} from '../../providers/picklistCubePure';
import { isOk } from '../../tm1Rest/httpError';

/**
 * Creates `}PickList` if it is missing.
 *
 * On servers with an established history, it exists (11.8 test server: one
 * string element `Value`). On a server that has never seen a picklist, it
 * can be missing — and then `POST /Cubes` fails on an unresolvable
 * `Dimensions@odata.bind` with a message that does not name the reason.
 * `POST /Dimensions` with a `}` name is allowed (verified live, 201).
 */
async function ensurePicklistDimension(cfg: Tm1Config): Promise<void> {
  const url = `Dimensions('${encodeODataKey(PICKLIST_DIM)}')?$select=Name`;
  const res = await apiRequest('GET', url, undefined, undefined, cfg);
  if (isOk(res)) { return; }
  await createDimension(
    cfg,
    buildPicklistDimensionBody(),
    vscode.l10n.t('Control dimension "{0}" could not be created', PICKLIST_DIM),
  );
}

/** Tree command `tm1.createPicklistCube`. */
export async function createPicklistCubeCommand(
  node: { meta?: Record<string, any> } | undefined,
  refresh: () => void,
): Promise<void> {
  const cubeName = node?.meta?.cubeName as string | undefined;
  const serverId = node?.meta?.serverId as string | undefined;
  if (!cubeName) { return; }
  const target = picklistCubeName(cubeName);

  const cfg = getServerConfig(serverId as string);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server connected.'));
    return;
  }

  // The menu entry depends on the tree state — that can be stale if someone
  // else has since created the cube. So do not POST blindly in that case.
  if (await cubeExists(cfg, target)) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('TM1: Picklist cube "{0}" already exists.', target),
    );
    refresh();
    return;
  }

  await confirmAndRun({
    confirm: vscode.l10n.t(
      'Create picklist cube "{0}"? It gets the dimensions of "{1}" plus "{2}". This changes the server schema.',
      target, cubeName, PICKLIST_DIM,
    ),
    confirmLabel: vscode.l10n.t('Create'),
    serverId,
    invalidate: ['Cubes', 'Dimensions'],
    run: async (c) => {
      const baseDims = await getCubeDimensionNames(c, cubeName);
      await ensurePicklistDimension(c);
      await createCube(
        c,
        buildPicklistCubeBody(cubeName, baseDims),
        vscode.l10n.t('Picklist cube "{0}" could not be created', target),
      );
      // Read back: a schema change that the server acknowledged but did
      // not actually carry out would otherwise only be noticed on the next
      // open.
      if (!await cubeExists(c, target)) {
        throw new Error(vscode.l10n.t('Server reported success but "{0}" does not exist.', target));
      }
    },
    success: vscode.l10n.t(
      'TM1: Picklist cube "{0}" created. Visible in the tree once control objects are shown.', target,
    ),
    failure: (d) => vscode.l10n.t('TM1: Picklist cube "{0}" could not be created: {1}', target, d),
    refresh,
  });
}

/** Tree command `tm1.deletePicklistCube`. */
export async function deletePicklistCubeCommand(
  node: { meta?: Record<string, any> } | undefined,
  refresh: () => void,
): Promise<void> {
  const cubeName = node?.meta?.cubeName as string | undefined;
  const serverId = node?.meta?.serverId as string | undefined;
  if (!cubeName) { return; }
  const target = picklistCubeName(cubeName);

  await confirmAndRun({
    confirm: vscode.l10n.t(
      'Really delete picklist cube "{0}"? All picklist definitions stored in it are lost. This cannot be undone.',
      target,
    ),
    serverId,
    invalidate: ['Cubes'],
    run: (c) => deleteCube(c, target),
    // Same reason as with `tm1.deleteCube`: a rule editor left open on the
    // control cube would, on save, write onto a new cube of the same name.
    afterSuccess: (c) => RuleEditorManager.disposePanelForCube(target, c.serverUrl),
    success: vscode.l10n.t('TM1: Picklist cube "{0}" was deleted.', target),
    failure: (d) => vscode.l10n.t('TM1: Picklist cube "{0}" could not be deleted: {1}', target, d),
    refresh,
  });
}
