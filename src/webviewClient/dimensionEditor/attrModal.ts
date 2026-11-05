/**
 * Attribute-definition modal renderer.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state } from './state';
import { updateDirty } from './helpers';
import { renderDetail } from './detail';
import { getL10n } from '../_shared/l10n';

export {};

const L = getL10n();

export function renderAttrModal(): void {
  const data = state.data;
  if (!data) { return; }
  const list = document.getElementById('attr-list') as HTMLElement;
  list.innerHTML = '';
  const defs = (data.attrDefs || []).filter((d) => d.marked !== 'deleted');
  if (!defs.length) {
    const li = document.createElement('li');
    li.textContent = L.noAttributesDefined;
    li.style.opacity = '0.6';
    list.appendChild(li);
    return;
  }
  for (const def of defs) {
    const li = document.createElement('li');
    if (def.marked === 'new') li.classList.add('new');
    const label = document.createElement('span');
    label.textContent = def.name + ' (' + def.type + ')';
    const btn = document.createElement('button');
    btn.textContent = '✗';
    btn.title = L.delete;
    btn.onclick = () => {
      if (!state.data) { return; }
      if (def.marked === 'new') {
        state.data.attrDefs = state.data.attrDefs.filter((d) => d !== def);
      } else {
        def.marked = 'deleted';
      }
      state.data.dirty = true;
      renderAttrModal(); renderDetail(); updateDirty();
    };
    li.appendChild(label);
    li.appendChild(btn);
    list.appendChild(li);
  }
}
