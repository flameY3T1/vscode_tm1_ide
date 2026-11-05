import * as vscode from 'vscode';
import * as gitCommands from '../commands/git';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { wrap } from './wrap';
import { PROCESS_FILE_VIEW_TYPE, ProcessFileEditorProvider } from '../commands/processEditor/fileMode/processFileEditor';

/**
 * Registers Git integration commands:
 *   tm1.git.openProcessAsFile (+ the tm1.processFile custom editor),
 *   tm1.git.pullProcess/pushProcess/pullRules/pushRules/pullAll/diffProcess/diffRules
 * Also registers the read-only TextDocumentContentProvider for diff display.
 */
export function registerGitCommands(context: vscode.ExtensionContext): void {
  const fileEditor = new ProcessFileEditorProvider(context.extensionUri);
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(vscode.commands.registerCommand('tm1.internal.processFileTestProbe', (req: Parameters<ProcessFileEditorProvider['probe']>[0]) => fileEditor.probe(req ?? {})));
  }
  gitCommands.registerServerContentProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.git.openProcessAsFile', wrap('Git Open Process as File', (node?: Tm1TreeNode) => gitCommands.openProcessAsFileCommand(node))),
    vscode.window.registerCustomEditorProvider(PROCESS_FILE_VIEW_TYPE, fileEditor, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('tm1.git.pullProcess', wrap('Git Pull Process', (node?: Tm1TreeNode) => gitCommands.pullProcessCommand(node))),
    vscode.commands.registerCommand('tm1.git.pushProcess', wrap('Git Push Process', (node?: Tm1TreeNode) => gitCommands.pushProcessCommand(node))),
    vscode.commands.registerCommand('tm1.git.pullRules',   wrap('Git Pull Rules',   (node?: Tm1TreeNode) => gitCommands.pullRulesCommand(node))),
    vscode.commands.registerCommand('tm1.git.pushRules',   wrap('Git Push Rules',   (node?: Tm1TreeNode) => gitCommands.pushRulesCommand(node))),
    vscode.commands.registerCommand('tm1.git.pullAll',     wrap('Git Pull All',     (node?: Tm1TreeNode) => gitCommands.pullAllCommand(node))),
    vscode.commands.registerCommand('tm1.git.diffProcess', wrap('Git Diff Process', (node?: Tm1TreeNode) => gitCommands.diffProcessCommand(node))),
    vscode.commands.registerCommand('tm1.git.diffRules',   wrap('Git Diff Rules',   (node?: Tm1TreeNode) => gitCommands.diffRulesCommand(node))),
  );
}
