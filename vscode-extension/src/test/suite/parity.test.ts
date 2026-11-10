import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listInstalls } from '../../core/revitInstalls';
import { onlyIn } from './testMode';
import { execFileAsync, hasBundledWheel, provisionTempToolchain } from './toolchainHelper';

/** The extension's TypeScript Revit detection must agree with `revitstubs list --json` from the bundled wheel. */
describe('Revit install detection parity (TS vs bundled revitstubs, slow)', function () {
  this.timeout(180000);
  const tmpDirs: string[] = [];

  before(function () {
    onlyIn(this, 'single');
  });

  after(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('listInstalls matches revitstubs list --json on a fixture Revit root', async function () {
    if (!hasBundledWheel()) {
      this.skip();
    }
    const venvPython = await provisionTempToolchain(tmpDirs);
    if (!venvPython) {
      this.skip();
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-parity-'));
    tmpDirs.push(root);
    for (const dir of ['Revit 2024', 'Revit 2025', 'Revit 2023', 'Revit 2025 Preview']) {
      fs.mkdirSync(path.join(root, dir));
    }
    for (const dir of ['Revit 2024', 'Revit 2025', 'Revit 2025 Preview']) {
      fs.writeFileSync(path.join(root, dir, 'RevitAPI.dll'), '');
    }

    const { stdout } = await execFileAsync(venvPython, ['-m', 'revitstubs', 'list', '--json', '--revit-root', root], {
      windowsHide: true,
    });
    const pyYears = (JSON.parse(stdout) as { year: number }[]).map((i) => i.year);
    const tsYears = listInstalls(root).map((i) => i.year);
    assert.deepEqual(tsYears, [2024, 2025]);
    assert.deepEqual(pyYears, tsYears);
  });
});
