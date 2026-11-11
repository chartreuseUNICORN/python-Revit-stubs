import * as vscode from 'vscode';
import type { LanguageServerChoice } from '../config';
import { PylanceAdapter } from './pylance';
import { PyrightAdapter } from './pyright';

export interface LspTarget {
  stubPath: string;
  extraPaths?: string[];
  folder?: vscode.WorkspaceFolder;
}

export interface LspAdapter {
  readonly id: 'pylance' | 'pyright';
  readonly displayName: string;
  readonly extensionId: string;
  isInstalled(): boolean;
  apply(target: LspTarget): Promise<void>;
  clear(folder?: vscode.WorkspaceFolder): Promise<void>;
}

/** Auto-detection priority order. */
export const ADAPTERS: readonly LspAdapter[] = [new PylanceAdapter(), new PyrightAdapter()];

/**
 * 'auto' picks the first installed adapter. An explicit choice is trusted even when that extension
 * is not installed (the caller warns once); this is also what lets the integration tests run with
 * --disable-extensions.
 */
export function resolveAdapter(choice: LanguageServerChoice): LspAdapter | undefined {
  if (choice === 'auto') {
    return ADAPTERS.find((a) => a.isInstalled());
  }
  return ADAPTERS.find((a) => a.id === choice);
}
