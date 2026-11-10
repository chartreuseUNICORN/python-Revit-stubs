import * as assert from 'node:assert';
import { formatVersion, meetsMinimum, parseVersionProbe } from '../../core/pythonVersion';

describe('pythonVersion', () => {
  it('parses a probe output', () => {
    assert.deepStrictEqual(parseVersionProbe('C:\\Python\\python.exe\r\n3 13\r\n'), {
      executable: 'C:\\Python\\python.exe',
      version: { major: 3, minor: 13 },
    });
  });

  it('returns undefined for malformed output', () => {
    assert.strictEqual(parseVersionProbe(''), undefined);
    assert.strictEqual(parseVersionProbe('only one line'), undefined);
    assert.strictEqual(parseVersionProbe('/usr/bin/python\nnot a version'), undefined);
  });

  it('enforces the minimum', () => {
    assert.strictEqual(meetsMinimum({ major: 3, minor: 8 }), false);
    assert.strictEqual(meetsMinimum({ major: 3, minor: 9 }), true);
    assert.strictEqual(meetsMinimum({ major: 3, minor: 13 }), true);
    assert.strictEqual(meetsMinimum({ major: 2, minor: 99 }), false);
  });

  it('formats', () => {
    assert.strictEqual(formatVersion({ major: 3, minor: 13 }), '3.13');
  });
});
