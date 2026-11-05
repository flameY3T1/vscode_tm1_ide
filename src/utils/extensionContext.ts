/**
 * Holder for the `ExtensionContext` so feature modules can reach `globalState`
 * without threading the context through every constructor.
 *
 * Deliberately tiny and feature-neutral: the previous way in was
 * `processEditor/state.ts#getExtensionContext`, which made unrelated features
 * import the process editor's state module just to park a draft.
 */

import type * as vscode from 'vscode';

let _ctx: vscode.ExtensionContext | undefined;

/** Called once from `extension.activate()`. */
export function setExtensionContext(ctx: vscode.ExtensionContext): void {
  _ctx = ctx;
}

/** The activated context, or undefined before activation (and in unit tests). */
export function getExtensionContext(): vscode.ExtensionContext | undefined {
  return _ctx;
}
