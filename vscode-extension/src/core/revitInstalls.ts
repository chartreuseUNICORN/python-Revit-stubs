import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RevitInstall {
  year: number;
  root: string;
  dotnetCore: boolean;
}

export const DEFAULT_REVIT_ROOT_WINDOWS = 'C:\\Program Files\\Autodesk';

const OPTIONAL_ASSEMBLIES = [
  'RevitAPIIFC.dll',
  'RevitAPIMacros.dll',
  'RevitAPIUIMacros.dll',
  'RevitAPISteel.dll',
];

export function defaultRevitRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.REVIT_ROOT || DEFAULT_REVIT_ROOT_WINDOWS;
}

export function listInstalls(root: string): RevitInstall[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const installs: RevitInstall[] = [];
  for (const name of names) {
    const m = /^Revit (\d{4})$/.exec(name);
    if (!m) {
      continue;
    }
    const dir = path.join(root, name);
    if (!fs.existsSync(path.join(dir, 'RevitAPI.dll'))) {
      continue;
    }
    const year = parseInt(m[1], 10);
    installs.push({ year, root: dir, dotnetCore: year >= 2025 });
  }
  return installs.sort((a, b) => a.year - b.year);
}

export function optionalAssemblies(install: RevitInstall): string[] {
  return OPTIONAL_ASSEMBLIES.filter((n) => fs.existsSync(path.join(install.root, n)));
}
