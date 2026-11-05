// src/webviewClient/tiTestDiff/index.ts
// Bundle of the per-test diff view (webviews/renderDiffHtml.ts). Until 2026-10
// an inline script. The "All / Diffs only" toolbar flips body[data-filter];
// the CSS hides equal rows.
export {};

const buttons = document.querySelectorAll<HTMLElement>('.toolbar button[data-filter]');
buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    document.body.dataset.filter = btn.dataset.filter || 'all';
    buttons.forEach((b) => b.classList.toggle('active', b === btn));
  });
});
