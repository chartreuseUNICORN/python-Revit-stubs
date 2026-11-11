import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import type { VersionManager } from '../versionManager';

export function registerClearConfiguration(context: vscode.ExtensionContext, manager: VersionManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.clearConfiguration, () => manager.clearConfiguration()),
  );
}
