import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultRevitRoot, DEFAULT_REVIT_ROOT_WINDOWS, listInstalls, optionalAssemblies } from '../../core/revitInstalls';

describe('revitInstalls', () => {
  let root: string;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-'));
    fs.mkdirSync(path.join(root, 'Revit 2023'));
    fs.mkdirSync(path.join(root, 'Revit 2025'));
    fs.writeFileSync(path.join(root, 'Revit 2025', 'RevitAPI.dll'), '');
    fs.writeFileSync(path.join(root, 'Revit 2025', 'RevitAPIIFC.dll'), '');
    fs.mkdirSync(path.join(root, 'Revit 2024'));
    fs.writeFileSync(path.join(root, 'Revit 2024', 'RevitAPI.dll'), '');
    fs.mkdirSync(path.join(root, 'Revit Foo'));
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds installs with RevitAPI.dll, sorted, with dotnetCore flag', () => {
    const installs = listInstalls(root);
    assert.deepStrictEqual(installs.map((i) => i.year), [2024, 2025]);
    assert.deepStrictEqual(installs.map((i) => i.dotnetCore), [false, true]);
    assert.strictEqual(installs[0].root, path.join(root, 'Revit 2024'));
  });

  it('returns [] for a missing root', () => {
    assert.deepStrictEqual(listInstalls(path.join(root, 'nope')), []);
  });

  it('honours REVIT_ROOT', () => {
    assert.strictEqual(defaultRevitRoot({ REVIT_ROOT: 'D:\\Revit' }), 'D:\\Revit');
    assert.strictEqual(defaultRevitRoot({}), DEFAULT_REVIT_ROOT_WINDOWS);
  });

  it('lists present optional assemblies', () => {
    const installs = listInstalls(root);
    assert.deepStrictEqual(optionalAssemblies(installs[1]), ['RevitAPIIFC.dll']);
    assert.deepStrictEqual(optionalAssemblies(installs[0]), []);
  });
});
