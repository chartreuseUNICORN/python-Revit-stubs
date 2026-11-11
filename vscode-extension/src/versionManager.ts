import * as vscode from 'vscode';
import { COMMANDS, EXT_ID } from './constants';
import { getActiveFolder, inspectAnalysis, pickFolder, readConfig, RevitStubsConfig, writeCurrentVersion } from './config';
import { discoverStubs, findStub, resolveLocalRoot, StubEntry } from './core/stubStore';
import { ADAPTERS, LspAdapter, resolveAdapter } from './lsp/adapter';
import { getOutputChannel, log } from './output';

export type VersionState =
  | { kind: 'noFolder' }
  | { kind: 'unconfigured'; entries: StubEntry[] }
  | { kind: 'missing'; year: string; entries: StubEntry[]; searched: string[] }
  | { kind: 'noAdapter'; year: string; entry: StubEntry }
  | { kind: 'applied'; year: string; entry: StubEntry; adapter: LspAdapter }
  | { kind: 'error'; year: string; entry: StubEntry; adapter: LspAdapter; message: string };

const REFRESH_DEBOUNCE_MS = 300;

/**
 * Why a refresh was requested. Only non-'editor' reasons may retry a failed apply: switching editors
 * must not re-run (and re-report) a settings write that just failed for the same folder and year.
 */
export type RefreshReason = 'editor' | 'watcher' | 'explicit';

interface VersionPickItem extends vscode.QuickPickItem {
  year?: string;
  generate?: boolean;
}

export class VersionManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<VersionState>();
  readonly onDidChangeState: vscode.Event<VersionState> = this.emitter.event;

  private current: VersionState = { kind: 'noFolder' };
  private readonly disposables: vscode.Disposable[] = [this.emitter];
  private watchers: vscode.Disposable[] = [];
  private watchedRootsKey = '';
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly shownWarnings = new Set<string>();
  private readonly shownErrors = new Set<string>();
  private adapterOverride: LspAdapter | undefined;

  // In-flight guard: at most one apply runs; overlapping requests coalesce into one follow-up run.
  private inFlight: Promise<VersionState> | undefined;
  private queued: Promise<VersionState> | undefined;
  private queuedFolder: vscode.WorkspaceFolder | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.disposables.push(
      // Applying writes python.analysis.* / python.languageServer, which never affect the
      // 'revitStubs' section, so this listener cannot feed back into itself.
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(EXT_ID)) {
          void this.applyCurrentVersion();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.applyCurrentVersion()),
      // Editor switches may change the active folder; re-resolve only, never rewrite settings.
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // VS Code fires this with undefined before every real switch; resolving then falls back to folder[0].
        if (editor) {
          void this.refresh(undefined, 'editor');
        }
      }),
    );
    context.subscriptions.push(this);
  }

  get state(): VersionState {
    return this.current;
  }

  discover(folder: vscode.WorkspaceFolder): StubEntry[] {
    return this.discoverWith(folder, readConfig(folder));
  }

  async refresh(folder?: vscode.WorkspaceFolder, reason: RefreshReason = 'explicit'): Promise<VersionState> {
    // An editor switch is never a reason to retry a failed write, whatever folder or year it resolves to.
    if (reason === 'editor' && this.current.kind === 'error') {
      return this.current;
    }
    const target = folder ?? getActiveFolder();
    const { state } = this.resolve(target);
    // A watcher-driven refresh must not report 'applied' while python.analysis.stubPath was never written.
    if (state.kind === 'applied' && inspectAnalysis(target).stubPath !== state.entry.settingValue) {
      return this.applyCurrentVersion(target);
    }
    return this.setState(state);
  }

  applyCurrentVersion(folder?: vscode.WorkspaceFolder): Promise<VersionState> {
    if (!this.inFlight) {
      this.inFlight = this.doApply(folder ?? getActiveFolder()).finally(() => {
        this.inFlight = undefined;
      });
      return this.inFlight;
    }
    this.queuedFolder = folder;
    if (!this.queued) {
      const rerun = () => {
        this.queued = undefined;
        return this.applyCurrentVersion(this.queuedFolder);
      };
      this.queued = this.inFlight.then(rerun, rerun);
    }
    return this.queued;
  }

  async selectVersion(): Promise<void> {
    const folder = getActiveFolder();
    if (!folder) {
      void vscode.window.showInformationMessage('Open a workspace folder to select a Revit version.');
      return;
    }
    const current = readConfig(folder).currentVersion;
    const items: VersionPickItem[] = this.discover(folder).map((e) => ({
      label: `${e.year === current ? '$(check) ' : ''}Revit ${e.year}`,
      description: e.source,
      detail: e.absPath,
      picked: e.year === current,
      year: e.year,
    }));
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(add) Generate new stubs…', generate: true },
    );
    const choice = await vscode.window.showQuickPick(items, {
      title: 'Select Revit version',
      placeHolder: 'Which Revit API year should IntelliSense use in this folder?',
    });
    if (!choice) {
      return;
    }
    if (choice.generate) {
      await vscode.commands.executeCommand(COMMANDS.generate);
      return;
    }
    if (choice.year) {
      await writeCurrentVersion(choice.year, folder);
      await this.applyCurrentVersion(folder);
    }
  }

  async clearConfiguration(): Promise<void> {
    const folder = await pickFolder();
    if (!folder) {
      return;
    }
    const adapter = resolveAdapter(readConfig(folder).languageServer) ?? ADAPTERS[0];
    await adapter.clear(folder);
    await writeCurrentVersion(undefined, folder);
    await this.refresh(folder);
  }

  /**
   * Test-only: forces every resolve to use `adapter` instead of the configured/detected one
   * (pass undefined to restore normal resolution). Not part of the supported API.
   */
  _setAdapterOverrideForTests(adapter: LspAdapter | undefined): void {
    this.adapterOverride = adapter;
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.disposeWatchers();
    for (const d of this.disposables.splice(0)) {
      d.dispose();
    }
  }

  private async doApply(folder: vscode.WorkspaceFolder | undefined): Promise<VersionState> {
    const { state, cfg } = this.resolve(folder);
    if (state.kind === 'applied') {
      try {
        await state.adapter.apply({ stubPath: state.entry.settingValue, folder });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`could not write ${state.adapter.displayName} settings for Revit ${state.year}: ${message}`);
        this.errorOnce(`Revit Stubs: could not write ${state.adapter.displayName} settings: ${message}`);
        return this.setState({ ...state, kind: 'error', message });
      }
      // A later failure with the same text is news again once a write has succeeded.
      this.shownErrors.clear();
      if (cfg?.languageServer !== 'auto' && !state.adapter.isInstalled()) {
        this.warnOnce(
          `revitStubs.languageServer is '${state.adapter.id}' but ${state.adapter.extensionId} is not installed; settings were written anyway.`,
        );
      }
    } else if (state.kind === 'missing') {
      this.warnOnce(
        `Revit ${state.year} stubs not found in ${state.searched.join(', ')}. Pick another version or generate them.`,
        'Select Version',
        'Open Settings',
      );
    } else if (state.kind === 'noAdapter') {
      this.warnOnce(
        'No supported Python language server found (Pylance or Pyright). Install one or set revitStubs.languageServer.',
        'Open Settings',
      );
    }
    return this.setState(state);
  }

  private resolve(folder: vscode.WorkspaceFolder | undefined): { state: VersionState; cfg?: RevitStubsConfig } {
    if (!folder) {
      return { state: { kind: 'noFolder' } };
    }
    const cfg = readConfig(folder);
    const localRoot = resolveLocalRoot(folder.uri.fsPath, cfg.workspaceStubsRoot);
    this.watchRoots([localRoot, cfg.globalStubsRoot]);
    const entries = this.discoverWith(folder, cfg);
    const year = cfg.currentVersion;
    if (!year) {
      return { state: { kind: 'unconfigured', entries }, cfg };
    }
    const entry = findStub(entries, year);
    if (!entry) {
      return { state: { kind: 'missing', year, entries, searched: [localRoot, cfg.globalStubsRoot] }, cfg };
    }
    const adapter = this.adapterOverride ?? resolveAdapter(cfg.languageServer);
    if (!adapter) {
      return { state: { kind: 'noAdapter', year, entry }, cfg };
    }
    return { state: { kind: 'applied', year, entry, adapter }, cfg };
  }

  private discoverWith(folder: vscode.WorkspaceFolder, cfg: RevitStubsConfig): StubEntry[] {
    return discoverStubs({
      folderPath: folder.uri.fsPath,
      workspaceStubsRoot: cfg.workspaceStubsRoot,
      globalRoot: cfg.globalStubsRoot,
    });
  }

  private setState(state: VersionState): VersionState {
    this.current = state;
    this.emitter.fire(state);
    return state;
  }

  private watchRoots(roots: string[]): void {
    const distinct = [...new Set(roots)];
    const key = distinct.join('|');
    if (key === this.watchedRootsKey) {
      return;
    }
    this.disposeWatchers();
    this.watchedRootsKey = key;
    for (const root of distinct) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '*'));
      watcher.onDidCreate(() => this.scheduleRefresh());
      watcher.onDidDelete(() => this.scheduleRefresh());
      this.watchers.push(watcher);
    }
  }

  private disposeWatchers(): void {
    for (const w of this.watchers.splice(0)) {
      w.dispose();
    }
    this.watchedRootsKey = '';
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(undefined, 'watcher'), REFRESH_DEBOUNCE_MS);
  }

  private errorOnce(message: string): void {
    if (this.shownErrors.has(message)) {
      return;
    }
    this.shownErrors.add(message);
    void vscode.window.showErrorMessage(message, 'Show Output').then((choice) => {
      if (choice === 'Show Output') {
        getOutputChannel().show();
      }
    });
  }

  private warnOnce(message: string, ...buttons: string[]): void {
    if (this.shownWarnings.has(message)) {
      return;
    }
    this.shownWarnings.add(message);
    void vscode.window.showWarningMessage(message, ...buttons).then((choice) => {
      if (choice === 'Select Version') {
        void vscode.commands.executeCommand(COMMANDS.selectVersion);
      } else if (choice === 'Open Settings') {
        void vscode.commands.executeCommand(COMMANDS.openSettings);
      }
    });
  }
}
