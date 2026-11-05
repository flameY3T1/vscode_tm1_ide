import type { ReorderInit } from './reorderDimsInit';
import { escapeHtml as esc } from '../../utils/escapeHtml';


export interface ReorderLabels {
  current: string;
  recommended: string;
  editable: string;
  use: string;
  apply: string;
  up: string;
  down: string;
  lastWarn: string;
}

function readonlyList(names: string[], counts: Record<string, number | null>): string {
  return names
    .map((n) => {
      const c = counts[n];
      const badge = c === null || c === undefined ? '?' : String(c);
      return `<li><span class="dn">${esc(n)}</span><span class="cnt">${esc(badge)}</span></li>`;
    })
    .join('');
}

export function renderReorderDimsBody(init: ReorderInit, labels: ReorderLabels): string {
  // injection-safe JSON embed: close-tag and unicode line separators neutralised
  const json = JSON.stringify(init)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return [
    '<div class="cols">',
    `<section><h3>${esc(labels.current)}</h3><ul class="ro">${readonlyList(init.current, init.counts)}</ul></section>`,
    `<section><h3>${esc(labels.recommended)}</h3><ul class="ro">${readonlyList(init.recommended, init.counts)}</ul>`,
    `<button id="use-recommended">${esc(labels.use)}</button></section>`,
    `<section><h3>${esc(labels.editable)}</h3><ul id="editable"></ul>`,
    `<div id="last-warn" class="warn hidden">${esc(labels.lastWarn)}</div>`,
    `<button id="apply" disabled>${esc(labels.apply)}</button></section>`,
    '</div>',
    `<div id="result" class="result"></div>`,
    `<script type="application/json" id="reorder-data">${json}</script>`,
    `<script type="application/json" id="reorder-labels">${JSON.stringify({ up: labels.up, down: labels.down }).replace(/</g, '\\u003c')}</script>`,
  ].join('\n');
}
