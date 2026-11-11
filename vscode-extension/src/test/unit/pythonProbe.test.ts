import * as assert from 'node:assert';
import { ProbeExec, probeCandidates } from '../../core/pythonProbe';

function enoent(): Error {
  return Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
}

const candidates = [
  ['py', ['-3']],
  ['python3', []],
  ['python', []],
] as const;

describe('pythonProbe', () => {
  it('skips missing and malformed candidates and picks the first valid one', async () => {
    const calls: string[][] = [];
    const exec: ProbeExec = async (file, args) => {
      calls.push([file, ...args]);
      if (file === 'py') {
        throw enoent();
      }
      if (file === 'python3') {
        return 'garbage';
      }
      return 'C:\\Python313\\python.exe\r\n3 13\r\n';
    };
    const r = await probeCandidates(candidates, exec);
    assert.deepStrictEqual(r, { executable: 'C:\\Python313\\python.exe', version: { major: 3, minor: 13 } });
    assert.deepStrictEqual(
      calls.map((c) => c.slice(0, -2)),
      [['py', '-3'], ['python3'], ['python']],
    );
    assert.ok(calls.every((c) => c[c.length - 2] === '-c'));
  });

  it('rejects an interpreter older than 3.9', async () => {
    const exec: ProbeExec = async (file) => (file === 'py' ? '/usr/bin/python3.8\n3 8\n' : Promise.reject(enoent()));
    assert.strictEqual(await probeCandidates(candidates, exec), undefined);
  });

  it('prefers the first candidate that meets the minimum', async () => {
    const exec: ProbeExec = async (file) =>
      file === 'py' ? 'old\n3 8\n' : file === 'python3' ? '/usr/bin/python3\n3 11\n' : 'never\n3 13\n';
    const r = await probeCandidates(candidates, exec);
    assert.strictEqual(r?.executable, '/usr/bin/python3');
  });

  it('returns undefined when every candidate fails', async () => {
    const exec: ProbeExec = async () => {
      throw enoent();
    };
    assert.strictEqual(await probeCandidates(candidates, exec), undefined);
  });
});
