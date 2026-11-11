import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { PythonExtension } from '@vscode/python-extension';
import { DEFAULT_CANDIDATES, probeCandidates } from '../core/pythonProbe';
import { formatVersion, meetsMinimum, MIN_PYTHON, PyVersion } from '../core/pythonVersion';
import { log } from '../output';

const execFileAsync = promisify(execFile);

export interface PythonInterpreter {
  executable: string;
  version: PyVersion;
  source: 'ms-python' | 'path';
}

async function fromPythonExtension(resource?: vscode.Uri): Promise<PythonInterpreter | undefined> {
  let api: PythonExtension;
  try {
    api = await PythonExtension.api();
  } catch (e) {
    log(`ms-python.python API unavailable: ${(e as Error).message}`);
    return undefined;
  }
  try {
    const envPath = api.environments.getActiveEnvironmentPath(resource);
    const env = await api.environments.resolveEnvironment(envPath);
    const uri = env?.executable.uri;
    const version = env?.version;
    if (!uri || !version) {
      log(`ms-python active environment '${envPath.path}' could not be resolved to an interpreter`);
      return undefined;
    }
    const v: PyVersion = { major: version.major, minor: version.minor };
    if (!meetsMinimum(v)) {
      log(`ms-python active interpreter ${uri.fsPath} is ${formatVersion(v)}; need >= ${formatVersion(MIN_PYTHON)}`);
      return undefined;
    }
    log(`using ms-python active interpreter ${uri.fsPath} (${formatVersion(v)})`);
    return { executable: uri.fsPath, version: v, source: 'ms-python' };
  } catch (e) {
    log(`ms-python environment lookup failed: ${(e as Error).message}`);
    return undefined;
  }
}

/** Finds a Python >= MIN_PYTHON: the ms-python active interpreter first, then `py -3` / `python3` / `python` on PATH. */
export async function findInterpreter(resource?: vscode.Uri): Promise<PythonInterpreter | undefined> {
  const fromExt = await fromPythonExtension(resource);
  if (fromExt) {
    return fromExt;
  }
  const found = await probeCandidates(
    DEFAULT_CANDIDATES,
    async (file, args) => (await execFileAsync(file, args, { timeout: 10_000, windowsHide: true })).stdout,
    log,
  );
  if (!found) {
    log(`no Python >= ${formatVersion(MIN_PYTHON)} found on PATH`);
    return undefined;
  }
  return { ...found, source: 'path' };
}
