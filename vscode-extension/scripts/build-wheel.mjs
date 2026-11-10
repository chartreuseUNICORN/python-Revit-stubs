// Builds the revit-stubgen wheel (plus its pure-Python dependencies) into bundled/
// so the VSIX can install it offline into a private venv.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = resolve(extRoot, '..', 'revit-stubgen');
const bundledDir = join(extRoot, 'bundled');
const PROBE = 'import sys;print(sys.executable);print(sys.version_info[0],sys.version_info[1])';
const MIN = [3, 9];

function fail(message) {
  console.error(`build-wheel: ${message}`);
  process.exit(1);
}

function findPython() {
  const candidates = [
    ['py', ['-3']],
    ['python3', []],
    ['python', []],
  ];
  for (const [cmd, args] of candidates) {
    const r = spawnSync(cmd, [...args, '-c', PROBE], { encoding: 'utf8', timeout: 10000 });
    if (r.error || r.status !== 0) {
      continue;
    }
    const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const m = lines.length === 2 ? /^(\d+)\s+(\d+)$/.exec(lines[1]) : null;
    if (!m) {
      continue;
    }
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major > MIN[0] || (major === MIN[0] && minor >= MIN[1])) {
      console.log(`build-wheel: using ${lines[0]} (${major}.${minor}) via '${[cmd, ...args].join(' ')}'`);
      return lines[0];
    }
    console.log(`build-wheel: skipping ${lines[0]} (${major}.${minor} < ${MIN.join('.')})`);
  }
  return undefined;
}

const python = findPython();
if (!python) {
  fail(`no Python >= ${MIN.join('.')} found (tried 'py -3', 'python3', 'python')`);
}

mkdirSync(bundledDir, { recursive: true });
for (const f of readdirSync(bundledDir)) {
  if (f.endsWith('.whl')) {
    rmSync(join(bundledDir, f));
  }
}

const r = spawnSync(
  python,
  ['-m', 'pip', 'wheel', packageDir, '--wheel-dir', bundledDir, '--no-cache-dir'],
  { stdio: 'inherit' },
);
if (r.error) {
  fail(`failed to run pip: ${r.error.message}`);
}
if (r.status !== 0) {
  fail(`'pip wheel' exited with code ${r.status}`);
}

// pip leaves a setuptools build/ dir in the package; it is gitignored but clutters the tree.
rmSync(join(packageDir, 'build'), { recursive: true, force: true });

const wheels = readdirSync(bundledDir).filter((f) => f.endsWith('.whl'));
if (!wheels.some((f) => /^revit_stubgen-.*\.whl$/.test(f))) {
  fail('pip finished but no revit_stubgen-*.whl was produced');
}
console.log('build-wheel: bundled wheels:');
for (const w of wheels) {
  console.log(`  ${w}`);
}
