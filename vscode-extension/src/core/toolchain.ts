import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ToolchainPaths {
  venvDir: string;
  venvPython: string;
  markerFile: string;
  bundledDir: string;
}

export type ToolchainExec = (
  file: string,
  args: string[],
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface EnsureOptions {
  interpreter: string;
  paths: ToolchainPaths;
  log: (line: string) => void;
  exec: ToolchainExec;
}

const WHEEL_RE = /^revit_stubgen-.*\.whl$/;

export function toolchainPaths(
  globalStoragePath: string,
  extensionPath: string,
  platform: NodeJS.Platform = process.platform,
): ToolchainPaths {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const venvDir = p.join(globalStoragePath, 'venv');
  return {
    venvDir,
    venvPython: platform === 'win32' ? p.join(venvDir, 'Scripts', 'python.exe') : p.join(venvDir, 'bin', 'python'),
    markerFile: p.join(venvDir, '.revit-stubgen.installed'),
    bundledDir: p.join(extensionPath, 'bundled'),
  };
}

/** File name of the bundled revit_stubgen wheel, or undefined if none is present. */
export function findBundledWheel(bundledDir: string): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(bundledDir);
  } catch {
    return undefined;
  }
  return entries.filter((f) => WHEEL_RE.test(f)).sort().pop();
}

/**
 * Identity of the bundled wheel as recorded in the marker: `<file name>|<size>|<mtimeMs>`, so a wheel
 * rebuilt under the same version (same file name) still triggers a reinstall.
 */
export function wheelMarker(bundledDir: string, wheel: string): string | undefined {
  try {
    const st = fs.statSync(path.join(bundledDir, wheel));
    return `${wheel}|${st.size}|${st.mtimeMs}`;
  } catch {
    return undefined;
  }
}

function readMarker(markerFile: string): string | undefined {
  try {
    return fs.readFileSync(markerFile, 'utf8').trim();
  } catch {
    return undefined;
  }
}

/** True when the venv exists and was last provisioned from the currently bundled wheel. */
export function isToolchainCurrent(paths: ToolchainPaths): boolean {
  const wheel = findBundledWheel(paths.bundledDir);
  const marker = wheel === undefined ? undefined : wheelMarker(paths.bundledDir, wheel);
  return marker !== undefined && fs.existsSync(paths.venvPython) && readMarker(paths.markerFile) === marker;
}

function tail(text: string, lines = 20): string {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

/** Creates/refreshes the private venv with the bundled wheel (offline). Returns the venv's python. */
export async function ensureToolchain(opts: EnsureOptions): Promise<string> {
  const { interpreter, paths, log, exec } = opts;
  if (isToolchainCurrent(paths)) {
    log('toolchain up to date');
    return paths.venvPython;
  }
  const wheel = findBundledWheel(paths.bundledDir);
  if (!wheel) {
    throw new Error(`No revit_stubgen-*.whl found in ${paths.bundledDir}`);
  }
  fs.mkdirSync(path.dirname(paths.venvDir), { recursive: true });
  if (!fs.existsSync(paths.venvPython)) {
    log(`creating venv at ${paths.venvDir} with ${interpreter}`);
    try {
      await exec(interpreter, ['-m', 'venv', paths.venvDir]);
    } catch (e) {
      throw new Error(`Failed to create venv: ${tail(stderrOf(e))}`);
    }
  }
  log(`installing ${wheel} into ${paths.venvDir}`);
  try {
    await exec(paths.venvPython, [
      '-m',
      'pip',
      'install',
      '--no-index',
      '--find-links',
      paths.bundledDir,
      '--upgrade',
      // Without this, pip skips a wheel rebuilt under the same version ("already installed with the same version").
      '--force-reinstall',
      path.join(paths.bundledDir, wheel),
    ]);
  } catch (e) {
    throw new Error(`pip install of ${wheel} failed: ${tail(stderrOf(e))}`);
  }
  fs.writeFileSync(paths.markerFile, wheelMarker(paths.bundledDir, wheel) ?? wheel, 'utf8');
  log('toolchain ready');
  return paths.venvPython;
}

function stderrOf(e: unknown): string {
  const err = e as { stderr?: unknown; message?: string };
  return typeof err.stderr === 'string' && err.stderr.trim() ? err.stderr : (err.message ?? String(e));
}
