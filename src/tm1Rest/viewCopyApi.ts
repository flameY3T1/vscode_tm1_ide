/**
 * Read a view from one server and create it on another.
 *
 * The shapes are measured live (viewCopyProbe{,2}.js, 11.8);
 * the reasoning is in `viewCopyPure.ts`. This file holds only what the
 * network needs: reading in the path form and writing via `createView` /
 * `updateView`.
 *
 * No vscode — the caller hands in user-facing text as an error message.
 */

import { apiRequest } from './client';
import { parseBody, parseBodySafe } from './parseRest';
import { encodeODataKey as enc } from '../utils/odataKey';
import { probeViewKind, createView, updateView, type ViewKind } from './cubeApi';
import {
  buildNativeViewCopyBody,
  buildMdxViewCopyBody,
  type RawNativeView,
  type ViewCopyPlan,
} from './viewCopyPure';
import type { Tm1Config } from './transport/types';
import { isOk } from './httpError';

/**
 * The axes are complex types: `$expand` works ONLY as a path. The options
 * form (`Rows($expand=…)`) is a 400 "Expecting '/' after property of
 * complex type in expand path".
 */
function axisExpand(axis: string): string {
  return `${axis}/Subset($select=Name,Expression,Alias;`
    + '$expand=Hierarchy($select=Name;$expand=Dimension($select=Name)),Elements($select=Name))';
}

function readPath(cube: string, view: string, isPrivate: boolean): string {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  return `Cubes('${enc(cube)}')/${collection}('${enc(view)}')`
    + `?$expand=${['Rows', 'Columns', 'Titles'].map(axisExpand).join(',')}`;
}

export interface ViewCopySource {
  kind: ViewKind;
  plan?: ViewCopyPlan;
  mdx?: string;
}

/**
 * Read a view in a way that lets it be rebuilt elsewhere.
 *
 * `null` means: the view is not readable (or does not exist). An unknown
 * type (`other`) is passed through so the caller can name it, instead of
 * writing something wrong.
 */
export async function readViewForCopy(
  cfg: Tm1Config, cube: string, view: string, isPrivate: boolean, targetName: string,
): Promise<ViewCopySource | null> {
  const kind = await probeViewKind(cfg, cube, view, isPrivate);
  if (kind === null) { return null; }

  if (kind === 'mdx') {
    const collection = isPrivate ? 'PrivateViews' : 'Views';
    const res = await apiRequest(
      'GET', `Cubes('${enc(cube)}')/${collection}('${enc(view)}')?$select=MDX`, undefined, 30000, cfg,
    );
    if (!isOk(res)) { return null; }
    const mdx = parseBodySafe<{ MDX?: string }>(res, {}).MDX ?? '';
    return mdx ? { kind, mdx } : null;
  }

  if (kind !== 'native') { return { kind }; }

  const res = await apiRequest('GET', readPath(cube, view, isPrivate), undefined, 60000, cfg);
  if (!isOk(res)) { return null; }
  // STRICT, not tolerant: a fallback to `{}` would yield a plan with three
  // empty axes, and on overwrite that is not nothing, but a loss of data —
  // `updateView` REPLACES the axes, the target view would end up empty with
  // HTTP 200 and TM1 has no way back. Broken JSON must therefore throw, so
  // the caller reports the view as failed.
  const raw = parseBody<RawNativeView>(res);
  return { kind, plan: buildNativeViewCopyBody(raw, targetName) };
}

/**
 * Does the body carry any axis with entries at all?
 *
 * A NativeView without any axis does not exist in TM1 (the POST even
 * requires EVERY cube dimension to be on some axis). A body like that is
 * therefore always a read error, never intentional.
 */
function hasAnyAxis(body: Record<string, unknown>): boolean {
  return ['Rows', 'Columns', 'Titles']
    .some(k => Array.isArray(body[k]) && (body[k] as unknown[]).length > 0);
}

/**
 * Create or overwrite a view that was read, on the target server.
 *
 * Overwriting is done via PATCH, because that replaces the axes and does not
 * open a destructive window. But: PATCH cannot change the TYPE — a
 * NativeView body against an MDX view answers 200 and changes nothing. So
 * the type over there is checked beforehand; if it does not match, this is
 * not an overwrite but a named error.
 *
 * `emptyMsg` is the text for the case where there would be no axis at all to
 * write — see `hasAnyAxis`.
 */
export async function writeViewCopy(
  targetCfg: Tm1Config, cube: string, targetName: string, isPrivate: boolean,
  source: ViewCopySource, existingKind: ViewKind | null, errorMsg?: string, emptyMsg?: string,
): Promise<void> {
  let body: Record<string, unknown>;
  if (source.kind === 'mdx') {
    body = buildMdxViewCopyBody(source.mdx ?? '', targetName);
  } else {
    // A body without axes is NEVER written. On PATCH, TM1 replaces the axes
    // (live on 11.8), so an empty axis list empties the target view — with
    // HTTP 200, and with no way back. Better to fail with a name than to
    // silently empty it.
    if (!source.plan || !hasAnyAxis(source.plan.body)) {
      throw new Error(emptyMsg ?? `View "${targetName}" has no readable axes and was not written.`);
    }
    body = source.plan.body;
  }

  if (existingKind === null) {
    await createView(targetCfg, cube, body, isPrivate, 60000, errorMsg);
    return;
  }
  if (existingKind !== source.kind) {
    throw new Error(errorMsg ?? `View "${targetName}" exists with a different type (${existingKind}).`);
  }
  // On PATCH, `@odata.type` must NOT be sent along (live: a type change
  // otherwise fails silently with HTTP 200).
  const patchBody = { ...body };
  delete (patchBody as Record<string, unknown>)['@odata.type'];
  await updateView(targetCfg, cube, targetName, patchBody, isPrivate, 60000, errorMsg);
}
