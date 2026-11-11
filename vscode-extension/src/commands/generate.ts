import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { pickFolder, readConfig, writeCurrentVersion } from '../config';
import { defaultRevitRoot, listInstalls, optionalAssemblies, RevitInstall } from '../core/revitInstalls';
import { listStubYears, resolveLocalRoot, StubSource } from '../core/stubStore';
import { getOutputChannel, log } from '../output';
import { runGenerate } from '../python/generateRunner';
import { findInterpreter } from '../python/interpreter';
import { ensureToolchainForExtension } from '../python/toolchain';
import type { VersionManager } from '../versionManager';

export interface GenerateOutcome {
  years: string[];
  outRoot: string;
  store: StubSource;
  /** Year written to revitStubs.currentVersion by this flow, if any. */
  activatedYear?: string;
}

export interface GenerateFlowOptions {
  preset?: { years?: string[]; store?: StubSource };
  /** Always write currentVersion afterwards (asking which year when several were generated). */
  setVersionAfter?: boolean;
  /** Skip the folder pick (quickSetup already chose one). */
  folder?: vscode.WorkspaceFolder;
  /** Skip interpreter discovery and toolchain provisioning (quickSetup already did both). */
  venvPython?: string;
}

interface YearItem extends vscode.QuickPickItem {
  year: string;
}

interface StoreItem extends vscode.QuickPickItem {
  store: StubSource;
}

export function registerGenerate(context: vscode.ExtensionContext, manager: VersionManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.generate, () => runGenerateFlow(context, manager)),
  );
}

export function showErrorWithOutput(message: string): void {
  void vscode.window.showErrorMessage(message, 'Show Output').then((choice) => {
    if (choice === 'Show Output') {
      getOutputChannel().show();
    }
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Interpreter discovery + private venv provisioning; reports problems itself and returns undefined on failure. */
export async function prepareToolchain(
  context: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
): Promise<string | undefined> {
  const interp = await findInterpreter(folder.uri);
  if (!interp) {
    void vscode.window.showErrorMessage(
      'No Python 3.9+ interpreter found. Install Python or select one with the Python extension.',
    );
    return undefined;
  }
  try {
    return await ensureToolchainForExtension(context, interp);
  } catch (err) {
    log(`toolchain setup failed: ${errorMessage(err)}`);
    showErrorWithOutput(`Revit Stubs: could not prepare the Python toolchain: ${errorMessage(err)}`);
    return undefined;
  }
}

function describeInstall(install: RevitInstall): string {
  const runtime = install.dotnetCore ? '.NET 8' : '.NET Framework';
  const optional = optionalAssemblies(install).length;
  return optional > 0 ? `${runtime} · ${optional} optional assembl${optional === 1 ? 'y' : 'ies'}` : runtime;
}

async function pickYears(
  installs: RevitInstall[],
  local: Set<string>,
  global: Set<string>,
): Promise<string[] | undefined> {
  const items: YearItem[] = installs.map((install) => {
    const year = String(install.year);
    const where = [local.has(year) ? 'workspace' : '', global.has(year) ? 'global' : ''].filter(Boolean);
    return {
      label: `Revit ${year}`,
      description: describeInstall(install),
      detail: where.length ? `already generated (${where.join(', ')})` : undefined,
      picked: where.length === 0,
      year,
    };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Revit Stubs: generate stubs',
    placeHolder: 'Select the Revit year(s) to generate stubs for',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  return picked?.length ? picked.map((p) => p.year) : undefined;
}

async function pickStore(localRoot: string, globalRoot: string): Promise<StubSource | undefined> {
  const items: StoreItem[] = [
    { label: `Workspace — ${localRoot}`, detail: 'Stubs live next to this project', store: 'workspace' },
    { label: `Global — ${globalRoot}`, detail: 'Stubs are shared by every workspace on this machine', store: 'global' },
  ];
  const choice = await vscode.window.showQuickPick(items, {
    title: 'Revit Stubs: where should the stubs go?',
    ignoreFocusOut: true,
  });
  return choice?.store;
}

async function pickActiveYear(years: string[]): Promise<string | undefined> {
  if (years.length === 1) {
    return years[0];
  }
  const choice = await vscode.window.showQuickPick(
    [...years]
      .sort()
      .reverse()
      .map((y) => ({ label: `Revit ${y}`, year: y })),
    { title: 'Revit Stubs: which Revit version should IntelliSense use now?', ignoreFocusOut: true },
  );
  return choice?.year;
}

/**
 * Pick years + store, provision the toolchain, run the generator, then refresh/apply.
 * Returns undefined when the user cancels or something fails (already reported to the user).
 */
export async function runGenerateFlow(
  context: vscode.ExtensionContext,
  manager: VersionManager,
  opts: GenerateFlowOptions = {},
): Promise<GenerateOutcome | undefined> {
  const folder = opts.folder ?? (await pickFolder());
  if (!folder) {
    void vscode.window.showInformationMessage('Open a folder first');
    return undefined;
  }
  const cfg = readConfig(folder);
  const installs = listInstalls(cfg.revitRoot);
  if (installs.length === 0) {
    const choice = await vscode.window.showErrorMessage(
      `No Revit installs found under ${cfg.revitRoot}. Set revitStubs.revitRoot.`,
      'Open Settings',
    );
    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand(COMMANDS.openSettings);
    }
    return undefined;
  }

  const localRoot = resolveLocalRoot(folder.uri.fsPath, cfg.workspaceStubsRoot);
  const globalRoot = cfg.globalStubsRoot;
  const years = opts.preset?.years?.length
    ? opts.preset.years
    : await pickYears(installs, new Set(listStubYears(localRoot)), new Set(listStubYears(globalRoot)));
  if (!years) {
    return undefined;
  }
  const store = opts.preset?.store ?? (await pickStore(localRoot, globalRoot));
  if (!store) {
    return undefined;
  }
  const outRoot = store === 'workspace' ? localRoot : globalRoot;

  const venvPython = opts.venvPython ?? (await prepareToolchain(context, folder));
  if (!venvPython) {
    return undefined;
  }

  const yearList = years.join(', ');
  log(`generating Revit ${yearList} stubs into ${outRoot}`);
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Revit Stubs: generating stubs for Revit ${yearList}…`,
        cancellable: true,
      },
      (_progress, token) =>
        runGenerate(
          {
            venvPython,
            years,
            outRoot,
            // Only forward an explicit setting; the generator applies the same default itself.
            revitRoot: cfg.revitRoot !== defaultRevitRoot() ? cfg.revitRoot : undefined,
            extraArgs: cfg.generateExtraArgs,
            cwd: folder.uri.fsPath,
          },
          token,
        ),
    );
  } catch (err) {
    if (err instanceof vscode.CancellationError) {
      log('generation cancelled');
      void vscode.window.showInformationMessage('Generation cancelled');
    } else {
      log(`generation failed: ${errorMessage(err)}`);
      showErrorWithOutput(`Revit Stubs: generation failed: ${errorMessage(err)}`);
    }
    return undefined;
  }
  log(`generated Revit ${yearList} stubs in ${outRoot}`);

  // The root watcher can fire before clr.pyi exists, so re-resolve now that the generator has exited.
  await manager.refresh(folder);
  const outcome: GenerateOutcome = { years, outRoot, store };
  const current = cfg.currentVersion;
  if (opts.setVersionAfter || (!current && years.length === 1)) {
    const year = await pickActiveYear(years);
    if (year) {
      await writeCurrentVersion(year, folder);
      await manager.applyCurrentVersion(folder);
      outcome.activatedYear = year;
    }
    return outcome;
  }
  if (current && years.includes(current)) {
    // refresh() only re-resolves; the active year's stubs were (re)generated, so write its settings now.
    await manager.applyCurrentVersion(folder);
  }
  void vscode.window
    .showInformationMessage(`Generated Revit ${yearList} stubs in ${outRoot}`, 'Select Version')
    .then((choice) => {
      if (choice === 'Select Version') {
        void vscode.commands.executeCommand(COMMANDS.selectVersion);
      }
    });
  return outcome;
}
