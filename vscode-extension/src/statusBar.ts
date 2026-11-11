import * as vscode from 'vscode';
import { COMMANDS, STATUS_BAR_ID } from './constants';
import { renderStatus } from './statusRender';
import type { VersionManager, VersionState } from './versionManager';

export { renderStatus };
export type { StatusSeverity, StatusView } from './statusRender';

const BACKGROUNDS = {
  none: undefined,
  warning: 'statusBarItem.warningBackground',
  error: 'statusBarItem.errorBackground',
} as const;

export function createStatusBar(context: vscode.ExtensionContext, manager: VersionManager): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(STATUS_BAR_ID, vscode.StatusBarAlignment.Right, 90);
  item.name = 'Revit Stubs';
  item.command = COMMANDS.selectVersion;

  const render = (state: VersionState): void => {
    const view = renderStatus(state, vscode.window.activeTextEditor?.document.languageId);
    if (view.text) {
      item.text = view.text;
      item.tooltip = new vscode.MarkdownString(view.tooltip);
      const bg = BACKGROUNDS[view.warning];
      item.backgroundColor = bg ? new vscode.ThemeColor(bg) : undefined;
    }
    if (view.visible) {
      item.show();
    } else {
      item.hide();
    }
  };

  context.subscriptions.push(
    item,
    manager.onDidChangeState(render),
    vscode.window.onDidChangeActiveTextEditor(() => render(manager.state)),
  );
  render(manager.state);
  return item;
}
