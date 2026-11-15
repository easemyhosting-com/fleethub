import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { approved } from './check-owner-review.mjs';
const review = (state = 'APPROVED', commit_id = 'a', login = 'easemyhosting-com') => ({ user: { login }, state, commit_id });
test('only owner approval on the exact head is accepted', () => {
  assert.equal(approved([review()], 'a'), true);
  for (const reviews of [[], [review('APPROVED', 'b')], [review('APPROVED', 'a', 'another-user')]]) assert.equal(approved(reviews, 'a'), false);
});
test('latest substantive owner decision controls approval', () => {
  for (const state of ['CHANGES_REQUESTED', 'DISMISSED']) assert.equal(approved([review(), review(state)], 'a'), false);
  assert.equal(approved([review(), review('COMMENTED')], 'a'), true);
});
