import * as assert from 'node:assert';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CANDIDATES, probeCandidates } from '../../core/pythonProbe';
import { ensureToolchain, findBundledWheel, toolchainPaths, ToolchainExec } from '../../core/toolchain';

const execFileAsync = promisify(execFile);
// out/test/unit -> extension root
const extensionRoot = path.resolve(__dirname, '..', '..', '..');

describe('toolchain (real venv + pip, slow)', function () {
  this.timeout(180000);
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('installs the bundled wheel into a fresh venv and is idempotent', async function () {
    if (!findBundledWheel(path.join(extensionRoot, 'bundled'))) {
      this.skip();
    }
    const py = await probeCandidates(
      DEFAULT_CANDIDATES,
      async (file, args) => (await execFileAsync(file, args, { timeout: 10000 })).stdout,
    );
    if (!py) {
      this.skip();
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-real-'));
    const paths = toolchainPaths(path.join(tmp, 'storage'), extensionRoot);
    let execCalls = 0;
    const exec: ToolchainExec = async (file, args, opts) => {
      execCalls++;
      const r = await execFileAsync(file, args, { cwd: opts?.cwd, maxBuffer: 64 * 1024 * 1024 });
      return { stdout: r.stdout, stderr: r.stderr };
    };

    const venvPython = await ensureToolchain({ interpreter: py.executable, paths, log: () => undefined, exec });
    assert.strictEqual(execCalls, 2);
    const { stdout } = await execFileAsync(venvPython, ['-m', 'revitstubs', '--version']);
    assert.match(stdout, /0\.1\.0/);

    execCalls = 0;
    assert.strictEqual(
      await ensureToolchain({ interpreter: py.executable, paths, log: () => undefined, exec }),
      venvPython,
    );
    assert.strictEqual(execCalls, 0);
  });

  it('reinstalls a wheel rebuilt under the same version', async function () {
    const wheel = findBundledWheel(path.join(extensionRoot, 'bundled'));
    if (!wheel) {
      this.skip();
    }
    const py = await probeCandidates(
      DEFAULT_CANDIDATES,
      async (file, args) => (await execFileAsync(file, args, { timeout: 10000 })).stdout,
    );
    if (!py) {
      this.skip();
    }

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-real-'));
    const bundledCopy = path.join(tmp, 'bundled');
    fs.cpSync(path.join(extensionRoot, 'bundled'), bundledCopy, { recursive: true });
    const paths = { ...toolchainPaths(path.join(tmp, 'storage'), extensionRoot), bundledDir: bundledCopy };
    let pipCalls = 0;
    const exec: ToolchainExec = async (file, args, opts) => {
      if (args.includes('pip')) {
        pipCalls++;
      }
      const r = await execFileAsync(file, args, { cwd: opts?.cwd, maxBuffer: 64 * 1024 * 1024 });
      return { stdout: r.stdout, stderr: r.stderr };
    };

    const venvPython = await ensureToolchain({ interpreter: py.executable, paths, log: () => undefined, exec });
    assert.strictEqual(pipCalls, 1);
    const firstMarker = fs.readFileSync(paths.markerFile, 'utf8');

    const later = new Date(Date.now() + 60000);
    fs.utimesSync(path.join(bundledCopy, wheel), later, later);
    pipCalls = 0;
    await ensureToolchain({ interpreter: py.executable, paths, log: () => undefined, exec });
    assert.strictEqual(pipCalls, 1, 'a wheel with a new mtime must be reinstalled');
    assert.notStrictEqual(fs.readFileSync(paths.markerFile, 'utf8'), firstMarker);
    const { stdout } = await execFileAsync(venvPython, ['-m', 'revitstubs', '--version']);
    assert.match(stdout, /0\.1\.0/);
  });
});
