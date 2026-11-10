import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { pickFolder } from '../config';
import type { VersionManager } from '../versionManager';
import { prepareToolchain, runGenerateFlow } from './generate';

export function registerQuickSetup(context: vscode.ExtensionContext, manager: VersionManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.quickSetup, () => runQuickSetup(context, manager)),
  );
}

/**
 * Interpreter and toolchain first (so Python problems surface before any picking), then the shared
 * generate flow, which picks years + store, generates, and activates one year. Re-runnable: years
 * that already have stubs are shown as such and start unticked.
 */
async function runQuickSetup(context: vscode.ExtensionContext, manager: VersionManager): Promise<void> {
  const folder = await pickFolder();
  if (!folder) {
    void vscode.window.showInformationMessage('Open a folder first');
    return;
  }
  const venvPython = await prepareToolchain(context, folder);
  if (!venvPython) {
    return;
  }
  const outcome = await runGenerateFlow(context, manager, { folder, venvPython, setVersionAfter: true });
  if (!outcome?.activatedYear) {
    return;
  }
  const state = manager.state;
  if (state.kind !== 'applied') {
    // applyCurrentVersion already reported the error/warning for this state.
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `Revit Stubs is configured for Revit ${state.year}. IntelliSense now targets ${state.entry.absPath}.`,
    'Open Settings',
  );
  if (choice === 'Open Settings') {
    await vscode.commands.executeCommand(COMMANDS.openSettings);
  }
}
