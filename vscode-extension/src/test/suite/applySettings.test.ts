import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RevitStubsApi } from '../../extension';
import type { LspAdapter } from '../../lsp/adapter';
import { renderStatus } from '../../statusRender';
import type { VersionState } from '../../versionManager';
import { onlyIn } from './testMode';

const EXTENSION_ID = 'revit-stubgen.revit-stubs';

async function waitFor(api: RevitStubsApi, kind: VersionState['kind'], timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (api.manager.state.kind !== kind) {
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for state '${kind}', last state '${api.manager.state.kind}'`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function analysisWorkspaceValue<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration('python.analysis').inspect<T>(key)?.workspaceValue;
}

describe('revit-stubs settings integration', () => {
  let api: RevitStubsApi;
  const workspaceDir = process.env.REVIT_STUBS_TEST_WORKSPACE;

  before(async function () {
    onlyIn(this, 'single');
    assert.ok(workspaceDir, 'REVIT_STUBS_TEST_WORKSPACE must be set by runTest');
    const ext = vscode.extensions.getExtension<RevitStubsApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    api = await ext.activate();
  });

  it('registers the commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'revitStubs.selectVersion',
      'revitStubs.clearConfiguration',
      'revitStubs.openSettings',
      'revitStubs.generate',
      'revitStubs.quickSetup',
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  it('applies currentVersion through the settings API and preserves comments', async () => {
    await vscode.workspace
      .getConfiguration('revitStubs')
      .update('currentVersion', '2024', vscode.ConfigurationTarget.Workspace);
    await waitFor(api, 'applied');

    assert.equal(analysisWorkspaceValue('stubPath'), '${workspaceFolder}/revit-stubs/2024');
    assert.equal(analysisWorkspaceValue('typeCheckingMode'), 'strict');
    assert.equal(analysisWorkspaceValue('useLibraryCodeForTypes'), true);
    assert.equal(
      analysisWorkspaceValue<Record<string, string>>('diagnosticSeverityOverrides')?.reportMissingModuleSource,
      'none',
    );
    assert.equal(vscode.workspace.getConfiguration('python').inspect('languageServer')?.workspaceValue, 'Pylance');

    const text = fs.readFileSync(path.join(workspaceDir!, '.vscode', 'settings.json'), 'utf8');
    assert.ok(text.includes('// keep this comment'), `comment lost:\n${text}`);
    assert.ok(text.includes('"editor.tabSize": 2'), `tabSize lost:\n${text}`);
  });

  it('reports a missing version without touching stubPath', async () => {
    await vscode.workspace
      .getConfiguration('revitStubs')
      .update('currentVersion', '2030', vscode.ConfigurationTarget.Workspace);
    await waitFor(api, 'missing');
    assert.equal(analysisWorkspaceValue('stubPath'), '${workspaceFolder}/revit-stubs/2024');
  });

  it('clearConfiguration removes the stub settings but keeps user settings', async () => {
    await vscode.commands.executeCommand('revitStubs.clearConfiguration');

    assert.equal(analysisWorkspaceValue('stubPath'), undefined);
    const overrides = analysisWorkspaceValue<Record<string, string>>('diagnosticSeverityOverrides');
    assert.equal(overrides?.reportMissingModuleSource, undefined);
    assert.equal(vscode.workspace.getConfiguration('revitStubs').inspect('currentVersion')?.workspaceValue, undefined);
    assert.equal(analysisWorkspaceValue('typeCheckingMode'), 'strict');
  });

  it('writes stubPath when stubs appear for the configured year (watcher refresh)', async () => {
    const stubDir = path.join(workspaceDir!, 'revit-stubs', '2026');
    try {
      await vscode.workspace
        .getConfiguration('revitStubs')
        .update('currentVersion', '2026', vscode.ConfigurationTarget.Workspace);
      await waitFor(api, 'missing');

      fs.mkdirSync(path.join(stubDir, 'Autodesk'), { recursive: true });
      fs.writeFileSync(path.join(stubDir, 'clr.pyi'), 'def AddReference(name: str) -> None: ...\n');
      fs.writeFileSync(path.join(stubDir, 'Autodesk', '__init__.pyi'), '');

      await waitFor(api, 'applied', 10000);
      assert.equal(analysisWorkspaceValue('stubPath'), '${workspaceFolder}/revit-stubs/2026');
    } finally {
      await vscode.commands.executeCommand('revitStubs.clearConfiguration');
      fs.rmSync(stubDir, { recursive: true, force: true });
    }
  });

  it('enters the error state when the adapter cannot write its settings', async () => {
    const failing: LspAdapter = {
      id: 'pyright',
      displayName: 'Pyright',
      extensionId: 'ms-pyright.pyright',
      isInstalled: () => false,
      apply: async () => {
        throw new Error('Unable to write to Workspace Settings because python.analysis.stubPath is not a registered configuration.');
      },
      clear: async () => undefined,
    };
    api.manager._setAdapterOverrideForTests(failing);
    try {
      await vscode.workspace
        .getConfiguration('revitStubs')
        .update('currentVersion', '2024', vscode.ConfigurationTarget.Workspace);
      await waitFor(api, 'error');
      const state = api.manager.state;
      assert.equal(state.kind, 'error');
      if (state.kind === 'error') {
        assert.equal(state.year, '2024');
        assert.match(state.message, /not a registered configuration/);
      }
      const view = renderStatus(state);
      assert.ok(view.text.includes('settings failed'), view.text);
      assert.equal(view.warning, 'error');
      assert.equal(analysisWorkspaceValue('stubPath'), undefined);
    } finally {
      api.manager._setAdapterOverrideForTests(undefined);
      await vscode.workspace
        .getConfiguration('revitStubs')
        .update('currentVersion', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('does not retry a failed apply on editor switches, but does on a watcher refresh', async () => {
    let applyCalls = 0;
    const failing: LspAdapter = {
      id: 'pyright',
      displayName: 'Pyright',
      extensionId: 'ms-pyright.pyright',
      isInstalled: () => false,
      apply: async () => {
        applyCalls++;
        throw new Error('Unable to write to Workspace Settings because python.analysis.stubPath is not a registered configuration.');
      },
      clear: async () => undefined,
    };
    api.manager._setAdapterOverrideForTests(failing);
    try {
      await vscode.workspace
        .getConfiguration('revitStubs')
        .update('currentVersion', '2024', vscode.ConfigurationTarget.Workspace);
      await waitFor(api, 'error');
      // Let debounced watcher refreshes from earlier tests (300 ms) drain before taking the baseline.
      await new Promise((r) => setTimeout(r, 1000));
      assert.equal(api.manager.state.kind, 'error');

      // Each apply() call is one error toast before the fix; toasts themselves are not observable here.
      const baseline = applyCalls;
      for (let i = 0; i < 3; i++) {
        await api.manager.refresh(undefined, 'editor');
      }
      assert.equal(applyCalls, baseline, 'editor refreshes must not retry the failed apply');
      assert.equal(api.manager.state.kind, 'error');

      await api.manager.refresh(undefined, 'watcher');
      assert.equal(applyCalls, baseline + 1, 'a watcher refresh retries exactly once');
      assert.equal(api.manager.state.kind, 'error');
    } finally {
      api.manager._setAdapterOverrideForTests(undefined);
      await vscode.workspace
        .getConfiguration('revitStubs')
        .update('currentVersion', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});
