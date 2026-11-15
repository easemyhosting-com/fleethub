import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('no SARIF fails and findings never print diagnostic content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codeql-summary-test-'));
  try {
    const run = () => spawnSync(process.execPath, [resolve('scripts/codeql-summary.mjs'), directory], { encoding: 'utf8' });
    assert.notEqual(run().status, 0);
    const diagnostic = 'synthetic-private-diagnostic';
    writeFileSync(join(directory, 'result.sarif'), JSON.stringify({ runs: [{ results: [{ ruleId: 'synthetic/rule', message: { text: diagnostic } }] }] }));
    const result = run();
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('synthetic/rule'));
    assert.equal(result.stdout.includes(diagnostic), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
