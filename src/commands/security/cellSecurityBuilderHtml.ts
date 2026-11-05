import { escapeHtml as esc } from '../../utils/escapeHtml';

export interface CellSecurityBuilderLabels {
  heading: string;
  hint: string;
  groupsRow: string;
  create: string;
}

export function renderCellSecurityBuilderBody(
  cubeName: string,
  sourceDims: string[],
  labels: CellSecurityBuilderLabels,
): string {
  const json = JSON.stringify(sourceDims).replace(/</g, '\\u003c');
  const rows = sourceDims
    .map(
      (d) =>
        `<li><label><input type="checkbox" class="dim" value="${esc(d)}" checked/> <span class="dn">${esc(d)}</span></label></li>`,
    )
    .join('');
  return [
    `<h2>${esc(labels.heading)}</h2>`,
    `<p class="hint">${esc(labels.hint)}</p>`,
    `<ul id="dims">${rows}</ul>`,
    `<ul class="fixed"><li><label><input type="checkbox" checked disabled/> <span class="dn">}Groups</span> <span class="note">${esc(labels.groupsRow)}</span></label></li></ul>`,
    `<button id="create" disabled>${esc(labels.create)}</button>`,
    `<div id="result" class="result"></div>`,
    `<script type="application/json" id="csb-data">${json}</script>`,
  ].join('\n');
}
