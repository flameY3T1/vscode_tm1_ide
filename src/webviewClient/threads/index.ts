// src/webviewClient/threads/index.ts
// Bundle of the threads/jobs window. Until 2026-10 this was an inline script in
// the host's template literal, invisible to tsc and eslint.
import type { BlockerGroupView, HostToWebview, ThreadRowView, ThreadsTexts, WaitIdView, WebviewToHost } from './protocol';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const L = (window as unknown as { __l10n?: ThreadsTexts }).__l10n ?? ({} as ThreadsTexts);
const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

let paused = false;
let activeOnly = false;
let lastThreads: ThreadRowView[] = [];
// Last rendered HTML per subtree — skip the innerHTML teardown/rebuild when
// an idle-server poll produces byte-identical output (#13). The string itself
// is the signature — a data or toggle change alters it and re-renders.
let lastGroupsHtml = '';
let lastTbodyHtml = '';

byId('btn-pause').addEventListener('click', () => {
  paused = !paused;
  byId('lbl-pause').textContent = paused ? L.resume : L.pause;
  byId('icon-pause').style.display = paused ? 'none' : '';
  byId('icon-play').style.display = paused ? '' : 'none';
  byId('btn-pause').classList.toggle('toggled', paused);
  vscode.postMessage({ command: 'setPaused', paused });
});
byId('btn-refresh').addEventListener('click', () => {
  vscode.postMessage({ command: 'manualRefresh' });
});

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtSec(s: number): string {
  if (!s) { return ''; }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}

// Render blocker-clustered view: each cluster = one blocker + everyone waiting on it.
function renderGroups(groups: BlockerGroupView[], cycleIds: WaitIdView[]): void {
  let html: string;
  if (groups.length === 0) {
    html = '<span class="chains-empty">' + esc(L.noWaitingThreads) + '</span>';
  } else {
    const cycleSet = new Set(cycleIds);
    html = groups.map((g) => {
      const blkName = g.blocker ? esc(g.blocker.name) : esc(L.unknown);
      const blkFn = g.blocker && g.blocker.function ? ' · ' + esc(g.blocker.function) : '';
      const badge = g.hasCycle ? '<span class="deadlock-badge">&#x21BA; DEADLOCK</span>' : '';
      const rows = g.blocked.map((w) => {
        const cyc = cycleSet.has(w.id) ? 'cr-cycle' : '';
        const waitStr = fmtSec(w.waitTimeSec);
        return `<tr class="${cyc}">
            <td class="cr-id">T${esc(w.id)}</td>
            <td title="${esc(w.name)}">${esc(w.name)}</td>
            <td class="cr-obj" title="${esc(w.objectName ?? '')}">${esc(w.objectName ?? '')}</td>
            <td class="cr-wait">${waitStr ? '&#x25F7; ' + waitStr : ''}</td>
          </tr>`;
      }).join('');
      return `<div class="cluster${g.hasCycle ? ' deadlock' : ''}">
        <div class="cluster-head">
          <span class="blocker-id">T${esc(g.blockerId)}</span>
          <span class="blocker-name" title="${blkName}">${blkName}${blkFn}</span>
          <span class="blocker-verb">${esc(L.blocks)}</span>
          ${badge}
          <span class="blocker-count">${g.blocked.length} ${esc(L.items)}</span>
        </div>
        <table class="cluster-rows"><tbody>${rows}</tbody></table>
      </div>`;
    }).join('');
  }
  // Guard (#13): identical output on an idle-server poll — no chains changed.
  if (html === lastGroupsHtml) { return; }
  lastGroupsHtml = html;
  byId('chains').innerHTML = html;
}

byId('btn-killwait').addEventListener('click', () => {
  vscode.postMessage({ command: 'killAllWaiting' });
});

byId('btn-killblocker').addEventListener('click', () => {
  vscode.postMessage({ command: 'killBlockers' });
});

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  const { groups, cycleIds, threads, waitingCount, blockers, error, ts } = e.data;
  const dot = byId('dot');
  const statusEl = byId('status');
  const errorEl = byId('error');
  const killWaitBtn = byId<HTMLButtonElement>('btn-killwait');
  const killBlockerBtn = byId<HTMLButtonElement>('btn-killblocker');

  if (error) {
    dot.className = paused ? 'dot paused' : 'dot err';
    errorEl.textContent = error;
    statusEl.textContent = new Date(ts).toLocaleTimeString() + (paused ? ' (' + L.paused + ')' : '');
    killWaitBtn.disabled = true;
    killBlockerBtn.disabled = true;
    return;
  }

  dot.className = paused ? 'dot paused' : 'dot';
  errorEl.textContent = '';
  const wc = waitingCount ?? 0;
  killWaitBtn.disabled = wc === 0;
  // The count belongs on the button: it is the only place that says how many
  // threads one click would kill BEFORE the confirmation dialog names them.
  const bl = blockers ?? [];
  killBlockerBtn.disabled = bl.length === 0;
  byId('lbl-killblocker').textContent =
    bl.length > 0 ? L.killBlockers + ' (' + bl.length + ')' : L.killBlockers;
  killBlockerBtn.classList.toggle('has-deadlock', bl.some((b) => b.fromCycle));
  const waitHint = wc > 0 ? ' — ' + L.waiting.replace('{0}', String(wc)) : '';
  statusEl.textContent = `${threads.length} ${L.items}${waitHint} — ${new Date(ts).toLocaleTimeString()}${paused ? ' (' + L.paused + ')' : ''}`;

  renderGroups(groups ?? [], cycleIds ?? []);

  lastThreads = threads;
  renderTbody();
});

// Render the thread table from the last received data, honouring the
// "active only" toggle (hides State === 'Idle' rows).
function renderTbody(): void {
  const tbody = document.getElementById('tbody');
  if (!tbody) { return; }
  const rows = activeOnly ? lastThreads.filter((t) => t.State !== 'Idle') : lastThreads;
  const html = rows.map((t) => `<tr>
      <td title="${esc(t.ID ?? t.JobId ?? '')}">${esc(t.ID ?? t.JobId ?? '')}</td>
      <td class="sess">${esc(t.Session ?? '')}</td>
      <td>${esc(t.TypeLabel)}</td>
      <td>${esc(t.Name ?? '')}</td>
      <td title="${esc(t.Context ?? '')}">${esc(t.Context ?? '')}</td>
      <td class="${esc(t.StateClass)}">${esc(t.State ?? '')}</td>
      <td>${esc(t.Function ?? '')}</td>
      <td title="${esc(t.ObjectName ?? '')}">${esc(t.ObjectName ?? '')}</td>
      <td title="${esc(t.Info ?? '')}">${esc(t.Info ?? '')}</td>
      <td class="elapsed">${esc(t.Elapsed)}</td>
      <td>${t.State !== 'Idle' ? `<button class="kill" data-id="${esc(t.ID ?? '')}" data-job="${esc(t.JobId ?? '')}">${esc(L.kill)}</button>` : ''}</td>
    </tr>`).join('');
  // Guard (#13): the string folds in the "active only" toggle (it filters
  // rows), so any real thread change or toggle flip re-renders; an unchanged
  // idle poll skips the teardown and keeps the live kill-button listeners.
  if (html === lastTbodyHtml) { return; }
  lastTbodyHtml = html;
  tbody.innerHTML = html;
  tbody.querySelectorAll<HTMLElement>('button.kill').forEach((btn) => {
    btn.addEventListener('click', () => vscode.postMessage({
      command: 'kill',
      threadId: btn.dataset.id ? Number(btn.dataset.id) : undefined,
      jobId: btn.dataset.job || undefined,
    }));
  });
}

byId('btn-active-only').addEventListener('click', () => {
  activeOnly = !activeOnly;
  byId('btn-active-only').classList.toggle('toggled', activeOnly);
  renderTbody();
});
