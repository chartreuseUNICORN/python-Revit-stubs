import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha from 'mocha';

function findTests(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      return findTests(p);
    }
    return e.name.endsWith('.test.js') ? [p] : [];
  });
}

/** Entry point called by the VS Code test host (extensionTestsPath). */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 20000 });
  for (const file of findTests(__dirname)) {
    mocha.addFile(file);
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} test(s) failed.`)) : resolve()));
  });
}
