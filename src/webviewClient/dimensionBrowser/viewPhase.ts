/**
 * The ONE switch for the coarse view of the Dimension Browser webview.
 *
 * Five elements share the window - loading indicator, error banner, placeholder,
 * the pane and the table frame inside it. Which of them is visible is decided
 * exclusively by the inline style this file sets; the CSS initial values (all
 * `display:none`) apply only until the first switch.
 *
 * S2-17 (review 2026-08-02): previously every branch toggled its own selection of
 * the five, and none toggled all five. K26 was exactly that: `setError` hid the
 * loading indicator and the table but not the pane - whose header line
 * ("Available 0 / 0") then stayed permanently above an empty frame, because
 * `setLoading(false)` had already uncovered it via inline style and thereby
 * overridden the CSS initial value.
 *
 * That is why the table below is COMPLETE: every phase states for EACH of the
 * five elements whether it is visible. A new phase is a compile error until it
 * is classified, and a new element has to go into `PhaseStyles` - that is the
 * whole point. A branch that toggles only "its" elements can no longer exist.
 *
 * That the completion upsets nothing depends on the order in which the host
 * sends (`dimensionBrowserHandlers.ts#fetchElements`, `dimensionBrowser.ts`):
 * `setLoading(true)` ... `setElementPage` ... `setLoading(false)`; in the error
 * case `setLoading(false)` ... `setError` or `setError` directly. In each of
 * these sequences the end state is the same as before - what is new is only that
 * an element left standing in between can no longer survive it.
 */

/** The three coarse states of the window. */
export type ViewPhase = 'loading' | 'error' | 'ready';

/** One field per element that the phases switch. */
interface PhaseStyles {
  loading: string;
  errorBanner: string;
  placeholder: string;
  paneSingle: string;
  tableContainer: string;
}

/**
 * `Record<ViewPhase, ...>` forces a new phase to be classified here - it MUST
 * be, otherwise it would silently fall through and leave its predecessor's view
 * standing. The values carry the layout requirements from
 * `dimensionBrowserCss.ts` along: `#loading` and `#pane-single` are flex
 * containers, `#table-container` and the error banner are blocks.
 */
const PHASE: Record<ViewPhase, PhaseStyles> = {
  // Loading: only the spinner. The pane stays hidden, otherwise its header line
  // flashes above an empty table while a large dimension loads.
  loading: {
    loading: 'flex', errorBanner: 'none', placeholder: 'none',
    paneSingle: 'none', tableContainer: 'none',
  },
  // Error: only the banner. Nothing comes below it any more - no pane either (K26).
  error: {
    loading: 'none', errorBanner: 'block', placeholder: 'none',
    paneSingle: 'none', tableContainer: 'none',
  },
  // Ready: pane and table. A banner from a previous failed attempt goes away
  // here - it does not describe the data that has just arrived.
  ready: {
    loading: 'none', errorBanner: 'none', placeholder: 'none',
    paneSingle: 'flex', tableContainer: 'block',
  },
};

function _show(id: string, display: string): void {
  const el = document.getElementById(id) as HTMLElement | null;
  if (el) { el.style.display = display; }
}

/** Set the coarse view to `phase` - all five elements, in one go. */
export function setViewPhase(phase: ViewPhase): void {
  const s = PHASE[phase];
  _show('loading', s.loading);
  _show('error-banner', s.errorBanner);
  _show('placeholder', s.placeholder);
  _show('pane-single', s.paneSingle);
  _show('table-container', s.tableContainer);
}
