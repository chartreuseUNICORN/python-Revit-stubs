import type { VersionState } from './versionManager';

export type StatusSeverity = 'none' | 'warning' | 'error';

export interface StatusView {
  text: string;
  /** Markdown. */
  tooltip: string;
  warning: StatusSeverity;
  visible: boolean;
}

/**
 * Pure view model for the status bar item (no vscode runtime import, so it is unit-testable).
 * `activeLanguageId` is the language of the active editor; it only matters for 'unconfigured'.
 */
export function renderStatus(state: VersionState, activeLanguageId?: string): StatusView {
  switch (state.kind) {
    case 'applied': {
      const { year, entry, adapter } = state;
      return {
        text: `$(symbol-class) Revit ${year}`,
        tooltip: `**Revit ${year}** stubs (${entry.source})\n\n${entry.absPath}\n\nLanguage server: ${adapter.displayName}\n\nClick to switch version`,
        warning: 'none',
        visible: true,
      };
    }
    case 'error':
      return {
        text: `$(error) Revit ${state.year}: settings failed`,
        tooltip: `**Revit ${state.year}**: could not write ${state.adapter.displayName} settings\n\n${state.message}\n\nSee the "Revit Stubs" output channel. Click to switch version`,
        warning: 'error',
        visible: true,
      };
    case 'missing':
      return {
        text: `$(warning) Revit ${state.year}`,
        tooltip: `**Revit ${state.year}** stubs not found in:\n\n${state.searched.map((s) => `- ${s}`).join('\n')}\n\nClick to pick another version or generate them`,
        warning: 'warning',
        visible: true,
      };
    case 'noAdapter':
      return {
        text: `$(warning) Revit ${state.year}: no language server`,
        tooltip: 'No supported Python language server (Pylance or Pyright) found. Click to switch version',
        warning: 'warning',
        visible: true,
      };
    case 'unconfigured':
      // Only nag about an unconfigured folder when stubs exist or a Python file is open.
      return {
        text: '$(symbol-class) Revit: select version',
        tooltip: 'Select the Revit API year for IntelliSense',
        warning: 'none',
        visible: state.entries.length > 0 || activeLanguageId === 'python',
      };
    case 'noFolder':
      return { text: '', tooltip: '', warning: 'none', visible: false };
  }
}
