import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
test('renaming, deleting or editing a protected file lists its original path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-review-'));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Example', GIT_COMMITTER_NAME: 'Example', GIT_AUTHOR_EMAIL: 'user@example.com', GIT_COMMITTER_EMAIL: 'user@example.com' };
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet', '-b', 'main');
    writeFileSync(join(dir, '.gitleaks.toml'), '[extend]\nuseDefault = true\n'.repeat(20)); git('add', '.'); git('commit', '--quiet', '-m', 'test: root');
    const base = git('rev-parse', 'HEAD');
    const branch = (name, change) => {
      git('checkout', '--quiet', '-b', name, base);
      change(); git('add', '-A'); git('commit', '--quiet', '-m', `test: ${name}`);
      return git('rev-parse', 'HEAD');
    };
    const renamed = branch('rename', () => renameSync(join(dir, '.gitleaks.toml'), join(dir, 'moved.toml')));
    assert.ok(git('diff', '--name-status', `${base}...${renamed}`).startsWith('R'), 'fixture must be detected as a rename');
    assert.deepEqual(changedPaths(base, renamed, dir).sort(), ['.gitleaks.toml', 'moved.toml']);
    const deleted = branch('delete', () => rmSync(join(dir, '.gitleaks.toml')));
    assert.deepEqual(changedPaths(base, deleted, dir), ['.gitleaks.toml']);
    const edited = branch('edit', () => writeFileSync(join(dir, '.gitleaks.toml'), '[extend]\nuseDefault = false\n'));
    assert.deepEqual(changedPaths(base, edited, dir), ['.gitleaks.toml']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
