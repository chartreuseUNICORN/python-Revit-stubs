import * as vscode from 'vscode';
import { applyUpdates, inspectAnalysis, InspectedSettings } from '../config';
import { planAnalysisUpdates, planClearUpdates, SettingUpdate } from '../core/lsp/settingsMap';
import type { LspAdapter, LspTarget } from './adapter';

/** Shared python.analysis.* logic: Pylance and Pyright read the same keys. */
export abstract class AnalysisAdapter implements LspAdapter {
  abstract readonly id: 'pylance' | 'pyright';
  abstract readonly displayName: string;
  abstract readonly extensionId: string;

  isInstalled(): boolean {
    return vscode.extensions.getExtension(this.extensionId) !== undefined;
  }

  /** Adapter-specific updates appended after the shared analysis plan. */
  protected abstract extraUpdates(inspected: InspectedSettings): SettingUpdate[];

  async apply(target: LspTarget): Promise<void> {
    const inspected = inspectAnalysis(target.folder);
    const updates = planAnalysisUpdates({ stubPath: target.stubPath, extraPaths: target.extraPaths }, inspected);
    await applyUpdates([...updates, ...this.extraUpdates(inspected)], target.folder);
  }

  async clear(folder?: vscode.WorkspaceFolder): Promise<void> {
    await applyUpdates(planClearUpdates(inspectAnalysis(folder)), folder);
  }
}
