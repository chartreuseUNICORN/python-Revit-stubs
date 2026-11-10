import * as vscode from 'vscode';
import { registerClearConfiguration } from './commands/clearConfiguration';
import { registerGenerate } from './commands/generate';
import { registerOpenSettings } from './commands/openSettings';
import { registerQuickSetup } from './commands/quickSetup';
import { registerSelectVersion } from './commands/selectVersion';
import { createStatusBar } from './statusBar';
import { VersionManager } from './versionManager';

export interface RevitStubsApi {
  manager: VersionManager;
}

export function activate(context: vscode.ExtensionContext): RevitStubsApi {
  const manager = new VersionManager(context);
  createStatusBar(context, manager);
  registerOpenSettings(context);
  registerSelectVersion(context, manager);
  registerClearConfiguration(context, manager);
  registerGenerate(context, manager);
  registerQuickSetup(context, manager);
  void manager.applyCurrentVersion();
  return { manager };
}

export function deactivate(): void {
  // disposables are owned by context.subscriptions
}
