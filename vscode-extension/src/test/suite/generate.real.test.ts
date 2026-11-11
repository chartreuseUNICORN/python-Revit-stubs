import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listStubYears } from '../../core/stubStore';
import { runGenerate } from '../../python/generateRunner';
import { onlyIn } from './testMode';
import { hasBundledWheel, provisionTempToolchain } from './toolchainHelper';

const REVIT_2025_API = 'C:\\Program Files\\Autodesk\\Revit 2025\\RevitAPI.dll';

describe('generate (real Revit 2025 + bundled wheel, slow)', function () {
  this.timeout(300000);
  const tmpDirs: string[] = [];

  before(function () {
    onlyIn(this, 'single');
  });

  after(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('runs revitstubs generate as a task and writes a usable stub tree', async function () {
    if (!hasBundledWheel() || !fs.existsSync(REVIT_2025_API)) {
      this.skip();
    }
    const workspace = process.env.REVIT_STUBS_TEST_WORKSPACE;
    assert.ok(workspace, 'REVIT_STUBS_TEST_WORKSPACE must be set by runTest');

    const venvPython = await provisionTempToolchain(tmpDirs);
    if (!venvPython) {
      this.skip();
    }
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-gen-out-'));
    tmpDirs.push(outRoot);

    await runGenerate({ venvPython, years: ['2025'], outRoot, cwd: workspace });

    const yearDir = path.join(outRoot, '2025');
    assert.ok(fs.existsSync(path.join(yearDir, 'clr.pyi')), 'clr.pyi missing');
    const dbInit = path.join(yearDir, 'Autodesk', 'Revit', 'DB', '__init__.pyi');
    assert.ok(fs.existsSync(dbInit), 'Autodesk/Revit/DB/__init__.pyi missing');
    assert.ok(fs.readFileSync(dbInit, 'utf8').includes('class Wall('), 'class Wall( not found in DB stubs');
    assert.deepEqual(listStubYears(outRoot), ['2025']);
  });
});
