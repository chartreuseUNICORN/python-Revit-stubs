import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { ensureToolchain, toolchainPaths, ToolchainExec } from '../core/toolchain';
import { log } from '../output';
import { PythonInterpreter } from './interpreter';

const execFileAsync = promisify(execFile);

const exec: ToolchainExec = async (file, args, opts) => {
  log(`> ${file} ${args.join(' ')}`);
  try {
    const r = await execFileAsync(file, args, { cwd: opts?.cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    logOutput(r.stdout, r.stderr);
    return r;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    logOutput(err.stdout ?? '', err.stderr ?? '');
    throw e;
  }
};

function logOutput(stdout: string, stderr: string): void {
  for (const text of [stdout, stderr]) {
    const trimmed = text.trimEnd();
    if (trimmed) {
      log(trimmed);
    }
  }
}

/** Ensures the private venv (under globalStorage) has the bundled revit-stubgen wheel; returns its python. */
export async function ensureToolchainForExtension(
  context: vscode.ExtensionContext,
  interpreter: PythonInterpreter,
): Promise<string> {
  const paths = toolchainPaths(context.globalStorageUri.fsPath, context.extensionUri.fsPath);
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Revit Stubs: preparing Python toolchain…' },
    () => ensureToolchain({ interpreter: interpreter.executable, paths, log, exec }),
  );
}
