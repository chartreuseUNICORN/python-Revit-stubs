import * as assert from 'node:assert';
import type { StubEntry } from '../../core/stubStore';
import type { LspAdapter } from '../../lsp/adapter';
import { renderStatus } from '../../statusRender';
import type { VersionState } from '../../versionManager';

const entry: StubEntry = {
  year: '2025',
  source: 'workspace',
  absPath: 'C:\\ws\\revit-stubs\\2025',
  settingValue: '${workspaceFolder}/revit-stubs/2025',
};

const adapter: LspAdapter = {
  id: 'pylance',
  displayName: 'Pylance',
  extensionId: 'ms-python.vscode-pylance',
  isInstalled: () => true,
  apply: async () => undefined,
  clear: async () => undefined,
};

describe('renderStatus', () => {
  it('applied: class icon, no warning, visible, tooltip names path and server', () => {
    const v = renderStatus({ kind: 'applied', year: '2025', entry, adapter });
    assert.strictEqual(v.text, '$(symbol-class) Revit 2025');
    assert.strictEqual(v.warning, 'none');
    assert.strictEqual(v.visible, true);
    assert.ok(v.tooltip.includes(entry.absPath));
    assert.ok(v.tooltip.includes('Pylance'));
  });

  it('error: error icon, "settings failed", error flag, tooltip carries the message', () => {
    const v = renderStatus({ kind: 'error', year: '2025', entry, adapter, message: 'Unable to write python.analysis.stubPath' });
    assert.strictEqual(v.text, '$(error) Revit 2025: settings failed');
    assert.strictEqual(v.warning, 'error');
    assert.strictEqual(v.visible, true);
    assert.ok(v.tooltip.includes('Unable to write python.analysis.stubPath'));
  });

  it('missing: warning icon and flag, tooltip lists searched roots', () => {
    const v = renderStatus({ kind: 'missing', year: '2030', entries: [], searched: ['C:\\a', 'C:\\b'] });
    assert.strictEqual(v.text, '$(warning) Revit 2030');
    assert.strictEqual(v.warning, 'warning');
    assert.strictEqual(v.visible, true);
    assert.ok(v.tooltip.includes('- C:\\a') && v.tooltip.includes('- C:\\b'));
  });

  it('noAdapter: warning icon and flag', () => {
    const v = renderStatus({ kind: 'noAdapter', year: '2025', entry });
    assert.strictEqual(v.text, '$(warning) Revit 2025: no language server');
    assert.strictEqual(v.warning, 'warning');
    assert.strictEqual(v.visible, true);
  });

  it('unconfigured: visible only with stubs present or a Python editor active', () => {
    const empty: VersionState = { kind: 'unconfigured', entries: [] };
    const v = renderStatus(empty);
    assert.strictEqual(v.text, '$(symbol-class) Revit: select version');
    assert.strictEqual(v.warning, 'none');
    assert.strictEqual(v.visible, false);
    assert.strictEqual(renderStatus(empty, 'plaintext').visible, false);
    assert.strictEqual(renderStatus(empty, 'python').visible, true);
    assert.strictEqual(renderStatus({ kind: 'unconfigured', entries: [entry] }).visible, true);
  });

  it('noFolder: hidden', () => {
    const v = renderStatus({ kind: 'noFolder' });
    assert.strictEqual(v.visible, false);
    assert.strictEqual(v.warning, 'none');
  });
});
