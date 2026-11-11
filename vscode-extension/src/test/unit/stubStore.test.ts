import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultGlobalStubsRoot, discoverStubs, findStub, isStubDir, listStubYears } from '../../core/stubStore';

describe('stubStore', () => {
  let tmp: string;
  let folder: string;
  let globalRoot: string;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-'));
    folder = path.join(tmp, 'ws');
    globalRoot = path.join(tmp, 'global');
    fs.mkdirSync(path.join(folder, 'revit-stubs', '2025'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'revit-stubs', '2025', 'clr.pyi'), '');
    fs.mkdirSync(path.join(globalRoot, '2025', 'Autodesk'), { recursive: true });
    fs.mkdirSync(path.join(globalRoot, '2024', 'Autodesk'), { recursive: true });
    fs.mkdirSync(path.join(globalRoot, '2026'), { recursive: true });
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('isStubDir requires clr.pyi or Autodesk', () => {
    assert.strictEqual(isStubDir(path.join(globalRoot, '2026')), false);
    assert.strictEqual(isStubDir(path.join(globalRoot, '2024')), true);
    assert.strictEqual(isStubDir(path.join(tmp, 'missing')), false);
  });

  it('listStubYears ignores non-stub dirs and missing roots', () => {
    assert.deepStrictEqual(listStubYears(globalRoot), ['2024', '2025']);
    assert.deepStrictEqual(listStubYears(path.join(tmp, 'missing')), []);
  });

  it('local beats global, global survives, sorted descending', () => {
    const entries = discoverStubs({ folderPath: folder, workspaceStubsRoot: 'revit-stubs', globalRoot });
    assert.deepStrictEqual(entries.map((e) => `${e.year}:${e.source}`), ['2025:workspace', '2024:global']);
    assert.strictEqual(findStub(entries, '2025')?.settingValue, '${workspaceFolder}/revit-stubs/2025');
    assert.strictEqual(findStub(entries, '2024')?.settingValue, path.join(globalRoot, '2024'));
    assert.strictEqual(findStub(entries, '2026'), undefined);
  });

  it('respects an absolute workspaceStubsRoot', () => {
    const abs = path.join(folder, 'revit-stubs');
    const entries = discoverStubs({ folderPath: tmp, workspaceStubsRoot: abs, globalRoot });
    const e = findStub(entries, '2025');
    assert.strictEqual(e?.source, 'workspace');
    assert.strictEqual(e?.absPath, path.join(abs, '2025'));
    assert.strictEqual(e?.settingValue, '${workspaceFolder}/ws/revit-stubs/2025');
  });

  it('uses absolute settingValue for stubs outside the folder', () => {
    const abs = path.join(folder, 'revit-stubs');
    const entries = discoverStubs({ folderPath: globalRoot, workspaceStubsRoot: abs, globalRoot: path.join(tmp, 'none') });
    assert.strictEqual(entries[0].settingValue, path.join(abs, '2025'));
  });

  it('keeps a workspace root whose name starts with .. inside the folder', () => {
    const dir = path.join(tmp, 'dots');
    fs.mkdirSync(path.join(dir, '..rs', '2026', 'Autodesk'), { recursive: true });
    const entries = discoverStubs({ folderPath: dir, workspaceStubsRoot: '..rs', globalRoot: path.join(tmp, 'none') });
    assert.strictEqual(findStub(entries, '2026')?.settingValue, '${workspaceFolder}/..rs/2026');
  });

  it('defaultGlobalStubsRoot per platform', () => {
    assert.strictEqual(defaultGlobalStubsRoot('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\h'), 'C:\\L\\revit-stubs');
    assert.strictEqual(
      defaultGlobalStubsRoot('linux', {}, '/home/u'),
      path.join('/home/u', '.local', 'share', 'revit-stubs'),
    );
    assert.strictEqual(defaultGlobalStubsRoot('linux', { XDG_DATA_HOME: '/x' }, '/home/u'), path.join('/x', 'revit-stubs'));
  });
});
