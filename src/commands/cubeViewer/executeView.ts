import { apiRequest } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import { withSandbox } from '../../tm1Rest/sandboxTracker';
import { enc } from './state';
import { _executeMdxInline, _readCellsetIntoGrid } from './executeMdxInline';
import { _createCellsetFromView, type ExecResult } from './cellset';
import { assertViewExecutable } from './viewSizeGuard';
import { isOk } from '../../tm1Rest/httpError';
import { SIDE_READ_CAP_MS } from '../../tm1Rest/timeouts';

/**
 * Execute a (named/temp) view into a PERSISTENT cellset. MDXViews route through
 * ExecuteMDX (NON EMPTY semantics) via _executeMdxInline; NativeViews use
 * Views/tm1.Execute. Large results keep the cellset alive under panelKey for
 * scroll-paging; small results delete it immediately.
 */
export async function _executeView(
  cubeName: string, viewName: string, isPrivate: boolean, config: Tm1Config, panelKey?: string,
): Promise<ExecResult> {
  const collectionPre = isPrivate ? 'PrivateViews' : 'Views';
  const mdxProbe = await apiRequest(
    'GET', `Cubes('${enc(cubeName)}')/${collectionPre}('${enc(viewName)}')?$select=MDX`,
    undefined, SIDE_READ_CAP_MS, config, withSandbox(config),
  );
  if (isOk(mdxProbe)) {
    const probed = parseBodySafe<{ MDX?: string }>(mdxProbe, {});
    const mdxText = typeof probed.MDX === 'string' ? probed.MDX.trim() : '';
    if (mdxText.length > 0) { return await _executeMdxInline(mdxText, config, panelKey); }
  }

  // Before the execute, not after: TM1 materialises the cellset server-side, so
  // a check that runs later has already let the damage happen.
  await assertViewExecutable(cubeName, viewName, isPrivate, config);

  return _readCellsetIntoGrid(await _createCellsetFromView(cubeName, viewName, isPrivate, config), config, panelKey);
}
