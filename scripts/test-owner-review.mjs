import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approved, changedPaths } from './check-owner-review.mjs';
const review = (state = 'APPROVED', commit_id = 'a', login = 'easemyhosting-com') => ({ user: { login }, state, commit_id });
test('only owner approval on the exact head is accepted', () => {
  assert.equal(approved([review()], 'a'), true);
  for (const reviews of [[], [review('APPROVED', 'b')], [review('APPROVED', 'a', 'another-user')]]) assert.equal(approved(reviews, 'a'), false);
});
test('latest substantive owner decision controls approval', () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) assert.equal(approved([review(), review(state)], 'a'), false);
  assert.equal(approved([review(), review('COMMENTED')], 'a'), true);
});
test('protected files changed only on the base branch are not attributed to the PR', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-review-'));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Example', GIT_COMMITTER_NAME: 'Example', GIT_AUTHOR_EMAIL: 'user@example.com', GIT_COMMITTER_EMAIL: 'user@example.com' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet', '-b', 'main');
    writeFileSync(join(dir, 'a.txt'), 'one\n'); git('add', '.'); git('commit', '--quiet', '-m', 'test: root');
    git('checkout', '--quiet', '-b', 'feature');
    writeFileSync(join(dir, 'b.txt'), 'two\n'); git('add', '.'); git('commit', '--quiet', '-m', 'test: feature');
    const head = git('rev-parse', 'HEAD');
    git('checkout', '--quiet', 'main');
    writeFileSync(join(dir, 'protected.txt'), 'base-only\n'); git('add', '.'); git('commit', '--quiet', '-m', 'test: base');
    const base = git('rev-parse', 'HEAD');
    assert.deepEqual(changedPaths(base, head, dir), ['b.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
