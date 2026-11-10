import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { ensureToolchain, findBundledWheel, toolchainPaths, ToolchainExec } from '../../core/toolchain';
import { findInterpreter } from '../../python/interpreter';

export const execFileAsync = promisify(execFile);
// out/test/suite -> extension root
export const extensionRoot = path.resolve(__dirname, '..', '..', '..');

export function hasBundledWheel(): boolean {
  return findBundledWheel(path.join(extensionRoot, 'bundled')) !== undefined;
}

/**
 * Provisions the bundled wheel into a venv under a fresh temp globalStorage (pushed onto `tmpDirs`
 * for cleanup). Returns the venv python, or undefined when no Python >= 3.9 is available.
 */
export async function provisionTempToolchain(tmpDirs: string[]): Promise<string | undefined> {
  const interp = await findInterpreter();
  if (!interp) {
    return undefined;
  }
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'revit-stubs-it-storage-'));
  tmpDirs.push(storage);
  const exec: ToolchainExec = async (file, args, opts) => {
    const r = await execFileAsync(file, args, { cwd: opts?.cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    return { stdout: r.stdout, stderr: r.stderr };
  };
  return ensureToolchain({
    interpreter: interp.executable,
    paths: toolchainPaths(storage, extensionRoot),
    log: () => undefined,
    exec,
  });
}
