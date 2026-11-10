import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { RevitStubsApi } from '../../extension';
import type { LspAdapter } from '../../lsp/adapter';
import { onlyIn } from './testMode';

const EXTENSION_ID = 'revit-stubgen.revit-stubs';

describe('revit-stubs multi-root workspace', () => {
  let api: RevitStubsApi;

  before(async function () {
    onlyIn(this, 'multiroot');
    const ext = vscode.extensions.getExtension<RevitStubsApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    api = await ext.activate();
  });

  it('writes folder-scoped analysis settings and window-scoped python.languageServer to the workspace', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.equal(folders.length, 2, 'expected the two-folder test workspace');
    const a = folders.find((f) => f.name === 'a');
    assert.ok(a, 'folder a not found');

    await vscode.workspace
      .getConfiguration('revitStubs', a.uri)
      .update('currentVersion', '2024', vscode.ConfigurationTarget.WorkspaceFolder);

    const deadline = Date.now() + 10000;
    while (api.manager.state.kind !== 'applied') {
      const state = api.manager.state;
      if (state.kind === 'error') {
        assert.fail(`apply failed: ${state.message}`);
      }
      if (Date.now() > deadline) {
        assert.fail(`timed out waiting for state 'applied', last state '${state.kind}'`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(
      vscode.workspace.getConfiguration('python.analysis', a.uri).inspect('stubPath')!.workspaceFolderValue,
      '${workspaceFolder}/revit-stubs/2024',
    );
    const ls = vscode.workspace.getConfiguration('python').inspect('languageServer')!;
    assert.equal(ls.workspaceValue, 'Pylance');
    assert.equal(ls.workspaceFolderValue, undefined);
  });

  it('editor switches across folders never retry a failed apply, but a watcher refresh does', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const a = folders.find((f) => f.name === 'a');
    const b = folders.find((f) => f.name === 'b');
    assert.ok(a && b, 'expected folders a and b');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const setVersion = (f: vscode.WorkspaceFolder, v: string | undefined) =>
      vscode.workspace
        .getConfiguration('revitStubs', f.uri)
        .update('currentVersion', v, vscode.ConfigurationTarget.WorkspaceFolder);

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
    try {
      await setVersion(a, '2024');
      await setVersion(b, '2024');
      // Let config-change applies and debounced watcher refreshes drain before installing the failing adapter.
      await sleep(1000);
      api.manager._setAdapterOverrideForTests(failing);

      await vscode.window.showTextDocument(vscode.Uri.joinPath(b.uri, 'x.py'));
      assert.equal((await api.manager.applyCurrentVersion(b)).kind, 'error');
      const baseline = applyCalls;
      assert.ok(baseline >= 1, 'the failing adapter must have been called');

      const docs = [vscode.Uri.joinPath(b.uri, 'x.py'), vscode.Uri.joinPath(b.uri, 'y.py'), vscode.Uri.joinPath(a.uri, 'z.py')];
      for (let i = 0; i < 5; i++) {
        for (const uri of docs) {
          await vscode.window.showTextDocument(uri);
          await sleep(150);
        }
      }
      assert.equal(applyCalls, baseline, 'editor switches must not retry the failed apply');
      assert.equal(api.manager.state.kind, 'error');

      await api.manager.refresh(b, 'watcher');
      assert.equal(applyCalls, baseline + 1, 'a watcher refresh retries exactly once');
    } finally {
      api.manager._setAdapterOverrideForTests(undefined);
      await setVersion(a, undefined);
      await setVersion(b, undefined);
    }
  });
});
