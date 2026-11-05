/**
 * Column width by dragging for list tables (log window, TM1 Top,
 * overviews, MDX result, feeder audit, users/groups).
 *
 * A table takes part if it carries `data-resizable`. Several tables
 * in one window give the attribute a value (`data-resizable="cubes"`),
 * which is then stored under `kind:value`. Tables that are drawn later or anew
 * are bound afterwards by a MutationObserver. Every header cell
 * gets a handle on the right. On the first drag all column widths are
 * frozen and the table is set to `table-layout: fixed`; from then on
 * the dragged width applies, and content that is too long is shortened with "…".
 * Double-click on a handle releases the table again (automatic
 * widths).
 *
 * The LAST column always fills up to the edge: it carries no fixed width,
 * and the table is at least as wide as its container. Previously the
 * sum of the columns could be dragged narrower than the window, and on the right an
 * empty strip without a header remained. Its dragged width counts only as a lower bound —
 * it is stored as 0 ("rest") as long as it was not dragged itself,
 * otherwise it would grow into the store with every wider window.
 *
 * The widths sit on the `th`, not on the rows — a redraw of the
 * `tbody` (poll tick, filter) therefore leaves them standing.
 *
 * Storage is per window kind (`kind`), not per server: the columns are
 * the same everywhere. After dragging, the script reports the widths
 * (`{ columnWidths: kind, widths }`, double-click: `widths: null`),
 * `webviews/columnWidthStore.ts` stores them, and on the next open
 * they are already in the script. If the column count no longer fits (a column was added),
 * the automatic width applies again.
 *
 * Floor of the last column: its natural width before freezing, after its own
 * drag the dragged width. With a floor of MIN it shrank to 30 px in a table
 * wider than its container as soon as ANY column was dragged.
 */

/** Stylesheet for the handle and the frozen table. No backticks in here — the constant ends up in template literals. */
export const COLUMN_RESIZE_CSS = `
  table[data-resizable] th .col-grip {
    position: absolute; top: 0; right: -3px; width: 7px; height: 100%;
    cursor: col-resize; user-select: none; z-index: 1;
  }
  table[data-resizable] th .col-grip:hover, table[data-resizable] th .col-grip.dragging {
    background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder));
    background-clip: content-box; padding: 0 2px; box-sizing: border-box;
  }
  table[data-resizable].col-fixed { table-layout: fixed; }
  table[data-resizable].col-fixed td, table[data-resizable].col-fixed th {
    overflow: hidden; text-overflow: ellipsis; max-width: none; box-sizing: border-box;
  }
`;

/**
 * Runs in the webview, embedded as text like the other inline scripts:
 * the root project knows no DOM (`lib` without `dom`), and that should stay so
 * for the extension code. No backticks and no backslashes in here.
 */
export function columnResizeScript(kind: string, saved: Readonly<Record<string, readonly number[]>>): string {
  return `
(function () {
  const MIN = 30;
  const KIND = ${JSON.stringify(kind)};
  // Key -> widths. Carried along while dragging, so that a redrawn
  // table (sorting, new run) gets the dragged widths back
  // without waiting for the host.
  const SAVED = ${JSON.stringify(saved)};
  // The value of the attribute distinguishes several tables in one window.
  const keyOf = (table) => table.dataset.resizable ? KIND + ':' + table.dataset.resizable : KIND;
  // Only the first header row: with table-layout fixed it determines the columns,
  // and a multi-row header (MDX crosstab) carries one cell per column there.
  const headsOf = (table) => {
    const row = table.tHead && table.tHead.rows[0];
    return row ? Array.from(row.cells) : [];
  };
  const api = () => (typeof vscode !== 'undefined' ? vscode : window.tm1VsApi);
  // Width of the table: all columns, the last at least MIN — but never
  // narrower than the container; the last column takes the rest.
  // The last column's floor: its own width before freezing. Without it a
  // table already wider than its container leaves the last column no rest
  // and it shrinks to MIN on the first drag of ANY column.
  const floorOf = (table) => Number(table.dataset.lastFloor || MIN);
  const fit = (table, widths) => {
    const last = widths.length - 1;
    const sum = widths.reduce((a, b, i) => a + (i === last ? Math.max(b, floorOf(table)) : b), 0);
    table.style.width = 'max(' + sum + 'px, 100%)';
  };
  const apply = (table, widths) => {
    // Measured while still in automatic layout (callers release first or have not frozen yet).
    if (!table.classList.contains('col-fixed')) {
      const heads0 = headsOf(table);
      const lastHead = heads0[heads0.length - 1];
      if (lastHead) { table.dataset.lastFloor = String(Math.max(MIN, Math.round(lastHead.getBoundingClientRect().width))); }
    }
    // First the class (box-sizing: border-box), then the widths: it is measured
    // with padding, and set this way it is not added on top a second time.
    table.classList.add('col-fixed');
    const heads = headsOf(table);
    // The last column without a width: with table-layout fixed it gets the rest.
    heads.forEach((h, i) => { h.style.width = i === heads.length - 1 ? '' : widths[i] + 'px'; });
    table.dataset.colWidths = JSON.stringify(widths);
    fit(table, widths);
    // Otherwise min-width:100% distributes the rest to all columns again, and
    // a column dragged narrower lets the others grow.
    table.style.minWidth = '0';
  };
  const release = (table) => {
    headsOf(table).forEach((h) => { h.style.width = ''; });
    table.style.width = '';
    table.style.minWidth = '';
    delete table.dataset.colWidths;
    delete table.dataset.lastFloor;
    table.classList.remove('col-fixed');
  };
  const store = (table, widths) => {
    const key = keyOf(table);
    if (widths) { SAVED[key] = widths; } else { delete SAVED[key]; }
    try { api().postMessage({ columnWidths: key, widths }); } catch (e) { /* no host: just do not remember */ }
  };
  const grip = (table, th) => {
    const g = document.createElement('span');
    g.className = 'col-grip';
    // Reference frame for the handle. A sticky header already is one
    // and must not be switched to relative.
    if (getComputedStyle(th).position === 'static') { th.style.position = 'relative'; }
    th.appendChild(g);
    // No sorting, no ticking of the header cell while dragging.
    g.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
    g.addEventListener('dblclick', (e) => { e.stopPropagation(); e.preventDefault(); release(table); store(table, null); });
    g.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const heads = headsOf(table);
      const idx = heads.indexOf(th);
      const isLast = idx === heads.length - 1;
      if (!table.classList.contains('col-fixed')) {
        // The last column starts as "rest" (0), not with its measured width.
        apply(table, heads.map((h, i) => (i === heads.length - 1 ? 0 : Math.round(h.getBoundingClientRect().width))));
      }
      const widths = JSON.parse(table.dataset.colWidths || '[]');
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      g.classList.add('dragging');
      const move = (ev) => {
        const w = Math.round(Math.max(MIN, startW + ev.clientX - startX));
        widths[idx] = w;
        if (!isLast) { th.style.width = w + 'px'; } else { table.dataset.lastFloor = String(w); }
        fit(table, widths);
      };
      const up = () => {
        g.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        table.dataset.colWidths = JSON.stringify(widths);
        store(table, widths);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  };
  // Binds every table and every header cell exactly once. Runs again on
  // every change in the document: windows that redraw the table or header
  // (innerHTML, textContent on the header cell) get handles again this way.
  const wire = () => {
    for (const table of document.querySelectorAll('table[data-resizable]')) {
      const heads = headsOf(table);
      if (!heads.length) { continue; }
      // New table or different column count (different query): create the remembered widths
      // anew if they fit the column count, otherwise automatic.
      if (table.dataset.colCount !== String(heads.length)) {
        table.dataset.colCount = String(heads.length);
        release(table);
        const s = SAVED[keyOf(table)];
        if (s && s.length === heads.length) { apply(table, s); }
      }
      for (const th of heads) {
        if (!th.querySelector(':scope > .col-grip')) { grip(table, th); }
      }
    }
  };
  wire();
  // Without an observer (test DOM) it stays with a single binding.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(wire).observe(document.body, { childList: true, subtree: true });
  }
})();
`;
}
