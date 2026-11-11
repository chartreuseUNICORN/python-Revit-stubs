import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

// out/test/runTest.js → <ext>/src/test/fixtures (fixtures are not compiled by tsc)
const fixtures = path.resolve(__dirname, '../../src/test/fixtures');

/**
 * One test-host launch on a temp copy of `fixture`. `open` is the path (relative to the copy) handed to
 * VS Code: '' for the folder itself, or a .code-workspace file. Suites skip themselves by REVIT_STUBS_TEST_MODE.
 */
async function runPass(mode: 'single' | 'multiroot', fixture: string, open: string): Promise<boolean> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `revit-stubs-it-${mode}-`));
  fs.cpSync(path.join(fixtures, fixture), workspace, { recursive: true });
  console.log(`=== integration tests: ${mode} ===`);
  try {
    await runTests({
      // Second dev extension only contributes the python.* settings schema Pylance would register;
      // without it VS Code rejects writes to unregistered keys such as python.analysis.stubPath.
      extensionDevelopmentPath: [path.resolve(__dirname, '../../'), path.join(fixtures, 'python-settings-schema')],
      extensionTestsPath: path.resolve(__dirname, './suite/index'),
      extensionTestsEnv: { REVIT_STUBS_TEST_WORKSPACE: workspace, REVIT_STUBS_TEST_MODE: mode },
      launchArgs: [path.join(workspace, open), '--disable-extensions', '--disable-gpu'],
    });
    return true;
  } catch (err) {
    console.error(`Integration tests (${mode}) failed:`, err);
    return false;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const single = await runPass('single', 'workspace', '');
  const multi = await runPass('multiroot', 'multiroot', 'multi.code-workspace');
  if (!single || !multi) {
    process.exitCode = 1;
  }
}

void main();
