import * as vscode from 'vscode';
import { installBedrock } from '../commands/bedrock/installBedrock';
import { updateBedrock } from '../commands/bedrock/updateBedrock';
import { uninstallBedrock } from '../commands/bedrock/uninstallBedrock';

export function registerBedrockCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.bedrock.install', installBedrock),
    vscode.commands.registerCommand('tm1.bedrock.update', updateBedrock),
    vscode.commands.registerCommand('tm1.bedrock.uninstall', uninstallBedrock),
  );
}
