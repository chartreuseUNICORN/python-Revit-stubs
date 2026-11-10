import * as vscode from 'vscode';
import { COMMANDS } from '../constants';

export function registerOpenSettings(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openSettings, () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'revitStubs'),
    ),
  );
}
