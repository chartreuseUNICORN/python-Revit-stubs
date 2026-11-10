import * as vscode from 'vscode';
import { EXT_ID, SETTINGS } from './constants';
import { defaultGlobalStubsRoot } from './core/stubStore';
import { defaultRevitRoot } from './core/revitInstalls';
import { ANALYSIS_SECTION, InspectedAnalysis, SettingUpdate } from './core/lsp/settingsMap';

export type LanguageServerChoice = 'auto' | 'pylance' | 'pyright';

export interface RevitStubsConfig {
  currentVersion: string;
  workspaceStubsRoot: string;
  globalStubsRoot: string;
  languageServer: LanguageServerChoice;
  revitRoot: string;
  generateExtraArgs: string[];
}

export type InspectedSettings = InspectedAnalysis & { stubPath?: string; languageServer?: string };

export function readConfig(folder?: vscode.WorkspaceFolder): RevitStubsConfig {
  const cfg = vscode.workspace.getConfiguration(EXT_ID, folder?.uri);
  const ls = cfg.get<string>(SETTINGS.languageServer, 'auto');
  return {
    currentVersion: (cfg.get<string>(SETTINGS.currentVersion) ?? '').trim(),
    workspaceStubsRoot: cfg.get<string>(SETTINGS.workspaceStubsRoot) || 'revit-stubs',
    globalStubsRoot: cfg.get<string>(SETTINGS.globalStubsRoot) || defaultGlobalStubsRoot(),
    languageServer: ls === 'pylance' || ls === 'pyright' ? ls : 'auto',
    revitRoot: cfg.get<string>(SETTINGS.revitRoot) || defaultRevitRoot(),
    generateExtraArgs: cfg.get<string[]>(SETTINGS.generateExtraArgs) ?? [],
  };
}

export function configTarget(): vscode.ConfigurationTarget {
  return (vscode.workspace.workspaceFolders?.length ?? 0) > 1
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Workspace;
}

export async function writeCurrentVersion(year: string | undefined, folder?: vscode.WorkspaceFolder): Promise<void> {
  await vscode.workspace
    .getConfiguration(EXT_ID, folder?.uri)
    .update(SETTINGS.currentVersion, year, configTarget());
}

export function getActiveFolder(): vscode.WorkspaceFolder | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  const fromDoc = doc ? vscode.workspace.getWorkspaceFolder(doc.uri) : undefined;
  return fromDoc ?? vscode.workspace.workspaceFolders?.[0];
}

export async function pickFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select the workspace folder to configure' });
}

/** Writes through the settings API, which preserves comments and formatting in settings.json. */
export async function applyUpdates(updates: SettingUpdate[], folder?: vscode.WorkspaceFolder): Promise<void> {
  const resourceTarget = configTarget();
  for (const u of updates) {
    // Window-scoped keys are rejected at folder level ("does not support the folder resource scope").
    const target = u.scope === 'window' ? vscode.ConfigurationTarget.Workspace : resourceTarget;
    await vscode.workspace.getConfiguration(u.section, folder?.uri).update(u.key, u.value, target);
  }
}

/** Workspace(-folder) level value only, so set-default semantics match vscode.py's setdefault on the workspace file. */
function scoped<T>(cfg: vscode.WorkspaceConfiguration, key: string): T | undefined {
  const i = cfg.inspect<T>(key);
  return i?.workspaceFolderValue ?? i?.workspaceValue;
}

export function inspectAnalysis(folder?: vscode.WorkspaceFolder): InspectedSettings {
  const analysis = vscode.workspace.getConfiguration(ANALYSIS_SECTION, folder?.uri);
  const python = vscode.workspace.getConfiguration('python', folder?.uri);
  return {
    stubPath: scoped<string>(analysis, 'stubPath'),
    typeCheckingMode: scoped<string>(analysis, 'typeCheckingMode'),
    useLibraryCodeForTypes: scoped<boolean>(analysis, 'useLibraryCodeForTypes'),
    diagnosticSeverityOverrides: scoped<Record<string, string>>(analysis, 'diagnosticSeverityOverrides'),
    extraPaths: scoped<string[]>(analysis, 'extraPaths'),
    // Window-scoped: it can only live in the workspace (or user) settings, never in folder settings.
    languageServer: python.inspect<string>('languageServer')?.workspaceValue,
  };
}
