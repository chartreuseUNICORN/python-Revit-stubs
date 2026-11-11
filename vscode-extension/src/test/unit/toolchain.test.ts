import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ensureToolchain,
  findBundledWheel,
  isToolchainCurrent,
  toolchainPaths,
  wheelMarker,
  ToolchainExec,
  ToolchainPaths,
} from '../../core/toolchain';

const WHEEL = 'revit_stubgen-0.1.0-py3-none-any.whl';

describe('toolchain', () => {
  let tmp: string;
  let paths: ToolchainPaths;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-tc-'));
    const ext = path.join(tmp, 'ext');
    fs.mkdirSync(path.join(ext, 'bundled'), { recursive: true });
    for (const f of [WHEEL, 'dnfile-0.18.0-py3-none-any.whl', 'pefile-2024.8.26-py3-none-any.whl', '.gitkeep']) {
      fs.writeFileSync(path.join(ext, 'bundled', f), '');
    }
    paths = toolchainPaths(path.join(tmp, 'storage'), ext);
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const currentMarker = (): string => wheelMarker(paths.bundledDir, WHEEL)!;

  function fakeVenvPython(): void {
    fs.mkdirSync(path.dirname(paths.venvPython), { recursive: true });
    fs.writeFileSync(paths.venvPython, '');
  }

  function recorder(onCall?: (file: string, args: string[]) => void): { exec: ToolchainExec; calls: string[][] } {
    const calls: string[][] = [];
    const exec: ToolchainExec = async (file, args) => {
      calls.push([file, ...args]);
      onCall?.(file, args);
      return { stdout: '', stderr: '' };
    };
    return { exec, calls };
  }

  it('computes win32 paths', () => {
    assert.deepStrictEqual(toolchainPaths('C:\\gs', 'C:\\ext', 'win32'), {
      venvDir: 'C:\\gs\\venv',
      venvPython: 'C:\\gs\\venv\\Scripts\\python.exe',
      markerFile: 'C:\\gs\\venv\\.revit-stubgen.installed',
      bundledDir: 'C:\\ext\\bundled',
    });
  });

  it('computes linux paths', () => {
    assert.deepStrictEqual(toolchainPaths('/gs', '/ext', 'linux'), {
      venvDir: '/gs/venv',
      venvPython: '/gs/venv/bin/python',
      markerFile: '/gs/venv/.revit-stubgen.installed',
      bundledDir: '/ext/bundled',
    });
  });

  it('finds the bundled wheel among others', () => {
    assert.strictEqual(findBundledWheel(paths.bundledDir), WHEEL);
  });

  it('returns undefined when no wheel is bundled', () => {
    fs.rmSync(path.join(paths.bundledDir, WHEEL));
    assert.strictEqual(findBundledWheel(paths.bundledDir), undefined);
    assert.strictEqual(findBundledWheel(path.join(tmp, 'missing')), undefined);
  });

  it('isToolchainCurrent requires the venv python and a matching marker', () => {
    assert.strictEqual(isToolchainCurrent(paths), false);
    fakeVenvPython();
    assert.strictEqual(isToolchainCurrent(paths), false);
    fs.writeFileSync(paths.markerFile, 'revit_stubgen-0.0.9-py3-none-any.whl');
    assert.strictEqual(isToolchainCurrent(paths), false);
    fs.writeFileSync(paths.markerFile, WHEEL); // pre-fix marker format (file name only) is stale
    assert.strictEqual(isToolchainCurrent(paths), false);
    fs.writeFileSync(paths.markerFile, currentMarker());
    assert.strictEqual(isToolchainCurrent(paths), true);
  });

  it('marker records file name, size and mtime', () => {
    const st = fs.statSync(path.join(paths.bundledDir, WHEEL));
    assert.strictEqual(currentMarker(), `${WHEEL}|${st.size}|${st.mtimeMs}`);
    assert.strictEqual(wheelMarker(paths.bundledDir, 'missing.whl'), undefined);
  });

  it('a rebuilt wheel with the same file name makes the toolchain stale', () => {
    fakeVenvPython();
    fs.writeFileSync(paths.markerFile, currentMarker());
    assert.strictEqual(isToolchainCurrent(paths), true);
    fs.writeFileSync(path.join(paths.bundledDir, WHEEL), 'rebuilt');
    assert.strictEqual(isToolchainCurrent(paths), false);
  });

  it('does nothing when the toolchain is current', async () => {
    fakeVenvPython();
    fs.writeFileSync(paths.markerFile, currentMarker());
    const { exec, calls } = recorder();
    const lines: string[] = [];
    assert.strictEqual(await ensureToolchain({ interpreter: 'py', paths, log: (l) => lines.push(l), exec }), paths.venvPython);
    assert.deepStrictEqual(calls, []);
    assert.ok(lines.includes('toolchain up to date'));
  });

  it('creates the venv then installs the wheel offline', async () => {
    const { exec, calls } = recorder((_file, args) => {
      if (args[1] === 'venv') {
        fakeVenvPython();
      }
    });
    const r = await ensureToolchain({ interpreter: '/usr/bin/python3', paths, log: () => undefined, exec });
    assert.strictEqual(r, paths.venvPython);
    assert.deepStrictEqual(calls, [
      ['/usr/bin/python3', '-m', 'venv', paths.venvDir],
      [paths.venvPython, '-m', 'pip', 'install', '--no-index', '--find-links', paths.bundledDir, '--upgrade',
        '--force-reinstall', path.join(paths.bundledDir, WHEEL)],
    ]);
    assert.strictEqual(fs.readFileSync(paths.markerFile, 'utf8'), currentMarker());
    assert.strictEqual(isToolchainCurrent(paths), true);
  });

  it('only reinstalls when the venv exists but the marker is stale', async () => {
    fakeVenvPython();
    fs.writeFileSync(paths.markerFile, 'revit_stubgen-0.0.9-py3-none-any.whl');
    const { exec, calls } = recorder();
    await ensureToolchain({ interpreter: 'py', paths, log: () => undefined, exec });
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].slice(0, 4), [paths.venvPython, '-m', 'pip', 'install']);
    assert.strictEqual(fs.readFileSync(paths.markerFile, 'utf8'), currentMarker());
  });

  it('throws with the pip stderr tail and leaves no marker when install fails', async () => {
    fakeVenvPython();
    const exec: ToolchainExec = async () => {
      throw Object.assign(new Error('Command failed'), { stderr: 'ERROR: No matching distribution found for dnfile' });
    };
    await assert.rejects(
      ensureToolchain({ interpreter: 'py', paths, log: () => undefined, exec }),
      /No matching distribution found for dnfile/,
    );
    assert.strictEqual(fs.existsSync(paths.markerFile), false);
  });
});
