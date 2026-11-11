import * as assert from 'node:assert';
import { buildGenerateArgs } from '../../core/generateArgs';

describe('generateArgs', () => {
  const base = { venvPython: '/v/bin/python', years: ['2024', '2025'], outRoot: '/w/revit-stubs' };

  it('builds the minimal argv', () => {
    assert.deepStrictEqual(buildGenerateArgs(base), [
      '-m', 'revitstubs', 'generate', '2024', '2025', '--out', '/w/revit-stubs',
    ]);
  });

  it('adds --revit-root and extra args', () => {
    assert.deepStrictEqual(
      buildGenerateArgs({ ...base, revitRoot: 'D:\\Autodesk', extraArgs: ['--no-clr', '--collections', 'dotnet'] }),
      ['-m', 'revitstubs', 'generate', '2024', '2025', '--out', '/w/revit-stubs',
        '--revit-root', 'D:\\Autodesk', '--no-clr', '--collections', 'dotnet'],
    );
  });

  it('ignores an empty revitRoot', () => {
    assert.ok(!buildGenerateArgs({ ...base, revitRoot: '' }).includes('--revit-root'));
  });
});
