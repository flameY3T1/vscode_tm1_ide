import * as vscode from 'vscode';

/**
 * Renders the object explorer's SVG icons inside a webview, so a panel listing
 * processes, cubes or subsets uses the SAME glyphs as the tree instead of ad-hoc
 * text bullets.
 *
 * Themes: the icon set ships a light and a dark variant of every file. Both are
 * emitted and CSS hides the wrong one ({@link ICON_THEME_CSS}) — VS Code marks
 * the theme on `body` at runtime, so the choice cannot be made here.
 *
 * The panel must allow the icon URIs: create it with
 * `localResourceRoots: [<extensionUri>/media, …]` and pass `webview.cspSource`
 * to the shell (it feeds `img-src`).
 */
export type IconRenderer = (name: string, cls?: string) => string;

export function makeIconRenderer(webview: vscode.Webview, extensionUri: vscode.Uri): IconRenderer {
  const uri = (theme: 'light' | 'dark', name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'icons', theme, `${name}.svg`)).toString();
  return (name, cls = 'wv-icon') =>
    `<img class="${cls} light-only" src="${uri('light', name)}" alt="" />`
    + `<img class="${cls} dark-only" src="${uri('dark', name)}" alt="" />`;
}

/** Renderer for panels built without a webview handle (e.g. pure unit tests). */
export const NO_ICONS: IconRenderer = () => '';

/** Light/dark switching for `.wv-icon`, mirroring the cube viewer's `.btn-icon`. */
export const ICON_THEME_CSS = `
  .wv-icon { width: 14px; height: 14px; vertical-align: -2px; flex-shrink: 0; }
  .wv-icon.dark-only { display: none; }
  body.vscode-dark .wv-icon.light-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .wv-icon.light-only { display: none; }
  body.vscode-dark .wv-icon.dark-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .wv-icon.dark-only { display: inline-block; }
`;
