/**
 * What comes back from a webview before it goes into `globalState`.
 *
 * Pure and vscode-free, because this is where the two quantities are
 * intercepted that would otherwise silently bloat a workbench — and both
 * are values that the webview sends along OBLIVIOUSLY, not by the user's
 * intent.
 */

/**
 * Cap for a saved MDX expression.
 *
 * 64 KiB. An ordinary expression sits at a few hundred bytes; a deeply
 * expanded tree writes every expansion as a `DRILLDOWNMEMBER` term and grows
 * without bound as a result. `globalState` is not a place to store
 * megabytes, and a workbench carries up to 20 windows.
 */
export const MDX_BYTE_CAP = 64 * 1024;

function byteLen(s: string): number {
  // Not `s.length`: an umlaut is two bytes in UTF-8, an emoji four. Counting
  // characters would let the multiple through.
  return Buffer.byteLength(s, 'utf8');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** The control shell of a cube viewer — what the chips need. */
export interface CubeViewerUi {
  titleAssignments?: Record<string, string>;
  dimAliases?: Record<string, string>;
  suppressRows?: boolean;
  suppressCols?: boolean;
  decimals?: number;
  decComma?: boolean;
  /** Display formats per dimension and element (grid only, never on the server). */
  displayFormats?: Record<string, Record<string, string>>;
}

export interface CubeViewerState {
  viewName?: string;
  isPrivate?: boolean;
  mdx?: string;
  ui?: CubeViewerUi;
  /** `false` = the webview did not answer. Visible in the selection window. */
  stateRead?: boolean;
  /** `true` = the MDX was over the cap and was discarded. */
  mdxDropped?: boolean;
}

/** What is known without an answer from the webview: cut from the panel key. */
export interface CubeViewerCoarse {
  viewName?: string;
  isPrivate?: boolean;
  mdx?: string;
}

/**
 * Webview answer + coarse state → what gets saved.
 *
 * The view name stays ALONGSIDE the MDX. Without it, the window would come
 * back as an anonymous query — it would show the same thing but could no
 * longer be controlled through the chips. That is exactly the "picture +
 * controllability" decision.
 */
export function sanitizeCubeViewerState(raw: unknown, coarse: CubeViewerCoarse): CubeViewerState {
  const out: CubeViewerState = { ...coarse };
  if (!isRecord(raw)) {
    out.stateRead = false;
    return out;
  }
  out.stateRead = true;

  const mdx = str(raw.mdx) ?? coarse.mdx;
  if (mdx !== undefined) {
    if (byteLen(mdx) > MDX_BYTE_CAP) {
      // Keep the shell, discard the picture: a controllable window without
      // a preloaded result is better than a workbench that can no longer
      // be saved.
      out.mdx = undefined;
      out.mdxDropped = true;
    } else {
      out.mdx = mdx;
    }
  }

  if (isRecord(raw.ui)) { out.ui = raw.ui as CubeViewerUi; }
  return out;
}

export interface DimBrowserState {
  hierarchy?: string;
  alias?: string;
  subset?: { name: string; isPrivate: boolean };
  /**
   * The set expression that produces the visible rows (`currentMdx()`).
   *
   * IT is the statement, not a list of names: only the expression carries
   * the collapse state (a collapsed consolidation shows up in it as a
   * `DRILLUPMEMBER` term; a list of names shows no trace of that). This is
   * exactly how the cube viewer passes its axis on to the dimension
   * browser.
   */
  mdx?: string;
  /** `true` = the expression was over the cap and was discarded. */
  mdxDropped?: boolean;
  stateRead?: boolean;
}

/**
 * Dimension browser answer → what gets saved.
 *
 * What is saved is the EXPRESSION, not the stack of intents. Two reasons:
 *
 *  1. It is the complete statement — collapse state included — and stays
 *     dynamic if the hierarchy changes.
 *  2. Restoring it needs NO new machinery for that:
 *     `DimBrowserOptions.initialSourceMdx` passes it on to `startView`,
 *     exactly the way the cube viewer hands over its axis.
 *
 * A list of names, by contrast, would come back with 295,000 entries and
 * would still have lost the collapse state.
 */
export function sanitizeDimBrowserState(raw: unknown): DimBrowserState {
  if (!isRecord(raw)) { return { stateRead: false }; }

  const out: DimBrowserState = { stateRead: true };
  out.hierarchy = str(raw.hierarchy);
  out.alias = str(raw.alias);

  if (isRecord(raw.subset)) {
    const name = str(raw.subset.name);
    if (name !== undefined) {
      out.subset = { name, isPrivate: raw.subset.isPrivate === true };
    }
  }

  const mdx = str(raw.mdx);
  if (mdx !== undefined) {
    if (byteLen(mdx) > MDX_BYTE_CAP) {
      // A deeply expanded tree writes every expansion as a
      // `DRILLDOWNMEMBER` term. Better to open without the expression than
      // to blow up storage.
      out.mdxDropped = true;
    } else {
      out.mdx = mdx;
    }
  }

  // Don't carry fields without a value along as `undefined` — otherwise
  // they end up as keys in storage.
  for (const k of Object.keys(out) as (keyof DimBrowserState)[]) {
    if (out[k] === undefined) { delete out[k]; }
  }
  return out;
}
