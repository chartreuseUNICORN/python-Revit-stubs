import * as assert from 'node:assert';
import {
  planAnalysisUpdates,
  planClearUpdates,
  planPylanceLanguageServerUpdate,
} from '../../core/lsp/settingsMap';

const find = (updates: { key: string; value: unknown }[], key: string) => updates.find((u) => u.key === key);

describe('settingsMap', () => {
  it('always sets stubPath', () => {
    const u = planAnalysisUpdates({ stubPath: 'X' }, {});
    assert.strictEqual(find(u, 'stubPath')?.value, 'X');
  });

  it('leaves typeCheckingMode alone when already set', () => {
    assert.strictEqual(find(planAnalysisUpdates({ stubPath: 'X' }, { typeCheckingMode: 'strict' }), 'typeCheckingMode'), undefined);
  });

  it('emits basic when typeCheckingMode undefined', () => {
    assert.strictEqual(find(planAnalysisUpdates({ stubPath: 'X' }, {}), 'typeCheckingMode')?.value, 'basic');
  });

  it('useLibraryCodeForTypes only when not already true', () => {
    assert.strictEqual(find(planAnalysisUpdates({ stubPath: 'X' }, { useLibraryCodeForTypes: true }), 'useLibraryCodeForTypes'), undefined);
    assert.strictEqual(find(planAnalysisUpdates({ stubPath: 'X' }, {}), 'useLibraryCodeForTypes')?.value, true);
  });

  it('merges overrides preserving existing keys', () => {
    const u = planAnalysisUpdates({ stubPath: 'X' }, { diagnosticSeverityOverrides: { reportFoo: 'error' } });
    assert.deepStrictEqual(find(u, 'diagnosticSeverityOverrides')?.value, { reportFoo: 'error', reportMissingModuleSource: 'none' });
  });

  it('no override update when reportMissingModuleSource already present', () => {
    const u = planAnalysisUpdates({ stubPath: 'X' }, { diagnosticSeverityOverrides: { reportMissingModuleSource: 'none' } });
    assert.strictEqual(find(u, 'diagnosticSeverityOverrides'), undefined);
  });

  it('unions and dedupes extraPaths, skipping no-op', () => {
    const u = planAnalysisUpdates({ stubPath: 'X', extraPaths: ['b', 'c'] }, { extraPaths: ['a', 'b'] });
    assert.deepStrictEqual(find(u, 'extraPaths')?.value, ['a', 'b', 'c']);
    const same = planAnalysisUpdates({ stubPath: 'X', extraPaths: ['a'] }, { extraPaths: ['a', 'b'] });
    assert.strictEqual(find(same, 'extraPaths'), undefined);
  });

  it('planPylanceLanguageServerUpdate', () => {
    assert.strictEqual(planPylanceLanguageServerUpdate('Jedi'), undefined);
    assert.deepStrictEqual(planPylanceLanguageServerUpdate('Default'), { section: 'python', key: 'languageServer', value: 'Pylance', scope: 'window' });
    assert.deepStrictEqual(planPylanceLanguageServerUpdate(undefined), { section: 'python', key: 'languageServer', value: 'Pylance', scope: 'window' });
  });

  it('only the window-scoped python.languageServer update carries scope window', () => {
    assert.strictEqual(planPylanceLanguageServerUpdate(undefined)?.scope, 'window');
    const analysis = planAnalysisUpdates(
      { stubPath: 'X', extraPaths: ['a'] },
      { diagnosticSeverityOverrides: { reportFoo: 'error' } },
    );
    assert.ok(analysis.length >= 4);
    for (const u of analysis) {
      assert.notStrictEqual(u.scope, 'window', u.key);
    }
  });

  it('planClearUpdates removes stubPath and strips the override', () => {
    const u = planClearUpdates({ stubPath: 'X', diagnosticSeverityOverrides: { reportFoo: 'error', reportMissingModuleSource: 'none' } });
    assert.ok(u.some((x) => x.key === 'stubPath' && x.value === undefined));
    assert.deepStrictEqual(find(u, 'diagnosticSeverityOverrides')?.value, { reportFoo: 'error' });
    const only = planClearUpdates({ diagnosticSeverityOverrides: { reportMissingModuleSource: 'none' } });
    assert.ok(only.some((x) => x.key === 'diagnosticSeverityOverrides' && x.value === undefined));
    assert.strictEqual(find(only, 'stubPath'), undefined);
  });
});
