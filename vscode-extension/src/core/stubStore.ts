import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type StubSource = 'workspace' | 'global';

export interface StubEntry {
  year: string;
  source: StubSource;
  absPath: string;
  settingValue: string;
}

export function defaultGlobalStubsRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    return (env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')) + '\\revit-stubs';
  }
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'revit-stubs');
}

export function resolveLocalRoot(folderPath: string, workspaceStubsRoot: string): string {
  return path.isAbsolute(workspaceStubsRoot)
    ? workspaceStubsRoot
    : path.join(folderPath, workspaceStubsRoot);
}

function isDir(p: string, kind: 'file' | 'dir'): boolean {
  try {
    const st = fs.statSync(p);
    return kind === 'file' ? st.isFile() : st.isDirectory();
  } catch {
    return false;
  }
}

export function isStubDir(dir: string): boolean {
  return isDir(dir, 'dir') && (isDir(path.join(dir, 'clr.pyi'), 'file') || isDir(path.join(dir, 'Autodesk'), 'dir'));
}

export function listStubYears(root: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d{4}$/.test(n) && isStubDir(path.join(root, n)))
    .sort();
}

export function workspaceSettingValue(folderPath: string, absStubDir: string): string {
  const rel = path.relative(folderPath, absStubDir);
  // Only a leading '..' path segment means outside; a folder named e.g. '..rs' is still inside.
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('../');
  if (rel === '' || outside || path.isAbsolute(rel)) {
    return absStubDir;
  }
  return '${workspaceFolder}/' + rel.split(path.sep).join('/');
}

export interface DiscoverOptions {
  folderPath?: string;
  workspaceStubsRoot?: string;
  globalRoot: string;
}

export function discoverStubs(opts: DiscoverOptions): StubEntry[] {
  const entries: StubEntry[] = [];
  const seen = new Set<string>();
  if (opts.folderPath) {
    const localRoot = resolveLocalRoot(opts.folderPath, opts.workspaceStubsRoot ?? 'revit-stubs');
    for (const year of listStubYears(localRoot)) {
      const absPath = path.join(localRoot, year);
      entries.push({
        year,
        source: 'workspace',
        absPath,
        settingValue: workspaceSettingValue(opts.folderPath, absPath),
      });
      seen.add(year);
    }
  }
  for (const year of listStubYears(opts.globalRoot)) {
    if (seen.has(year)) {
      continue;
    }
    const absPath = path.join(opts.globalRoot, year);
    entries.push({ year, source: 'global', absPath, settingValue: absPath });
  }
  return entries.sort((a, b) => b.year.localeCompare(a.year));
}

export function findStub(entries: StubEntry[], year: string): StubEntry | undefined {
  return entries.find((e) => e.year === year);
}
