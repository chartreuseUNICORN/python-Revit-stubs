export interface PyVersion {
  major: number;
  minor: number;
}

export const MIN_PYTHON: PyVersion = { major: 3, minor: 9 };

export const VERSION_PROBE = 'import sys;print(sys.executable);print(sys.version_info[0],sys.version_info[1])';

export function parseVersionProbe(stdout: string): { executable: string; version: PyVersion } | undefined {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 2) {
    return undefined;
  }
  const m = /^(\d+)\s+(\d+)$/.exec(lines[1]);
  if (!m) {
    return undefined;
  }
  return { executable: lines[0], version: { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) } };
}

export function meetsMinimum(v: PyVersion, min: PyVersion = MIN_PYTHON): boolean {
  return v.major > min.major || (v.major === min.major && v.minor >= min.minor);
}

export function formatVersion(v: PyVersion): string {
  return `${v.major}.${v.minor}`;
}
