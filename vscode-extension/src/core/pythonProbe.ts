import { meetsMinimum, parseVersionProbe, PyVersion, VERSION_PROBE } from './pythonVersion';

/** A command to try, e.g. `['py', ['-3']]`. */
export type ProbeCandidate = readonly [command: string, args: readonly string[]];

/** Runs `file args` and resolves with stdout; rejects on spawn failure (ENOENT), timeout, or non-zero exit. */
export type ProbeExec = (file: string, args: string[]) => Promise<string>;

export interface ProbeResult {
  executable: string;
  version: PyVersion;
}

export const DEFAULT_CANDIDATES: readonly ProbeCandidate[] = [
  ['py', ['-3']],
  ['python3', []],
  ['python', []],
];

/** Returns the first candidate that runs, reports a parseable version, and meets the minimum. */
export async function probeCandidates(
  candidates: readonly ProbeCandidate[],
  exec: ProbeExec,
  log: (line: string) => void = () => undefined,
): Promise<ProbeResult | undefined> {
  for (const [cmd, args] of candidates) {
    const label = [cmd, ...args].join(' ');
    let stdout: string;
    try {
      stdout = await exec(cmd, [...args, '-c', VERSION_PROBE]);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      log(`probe '${label}': ${code === 'ENOENT' ? 'not found' : `failed (${(e as Error).message})`}`);
      continue;
    }
    const parsed = parseVersionProbe(stdout);
    if (!parsed) {
      log(`probe '${label}': unrecognized output`);
      continue;
    }
    if (!meetsMinimum(parsed.version)) {
      log(`probe '${label}': ${parsed.executable} is ${parsed.version.major}.${parsed.version.minor}, too old`);
      continue;
    }
    log(`probe '${label}': using ${parsed.executable} (${parsed.version.major}.${parsed.version.minor})`);
    return parsed;
  }
  return undefined;
}
