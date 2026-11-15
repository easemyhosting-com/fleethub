import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const protectedFiles = new Set(['security/allowed-identifiers.txt', 'security/known-exceptions.md']);
const owner = 'easemyhosting-com';

export function approved(reviews, head) {
  let latest;
  for (const review of reviews) {
    if (review.user?.login === owner && review.state !== 'COMMENTED') latest = review;
  }
  return latest?.state === 'APPROVED' && latest.commit_id === head;
}

export async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) return 0;
  const base = pr.base.sha, head = pr.head.sha;
  if (![base, head].every(value => /^[a-f0-9]{40}$/.test(value))) return 2;
  const paths = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' }).trim().split('\n');
  if (!paths.some(path => protectedFiles.has(path))) {
    console.log('Protected identifier/exception policy unchanged.');
    return 0;
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(pr.number)) return 2;
  const reviews = [];
  for (let page = 1; ; page++) {
    // The host is fixed, path components are validated, and redirects cannot leak credentials.
    const url = new URL(`/repos/${repository}/pulls/${pr.number}/reviews?per_page=100&page=${page}`, 'https://api.github.com');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) return 2;
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 10 * 1024 * 1024) return 2;
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const batch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(batch)) return 2;
    reviews.push(...batch);
    if (batch.length < 100) break;
  }
  if (!approved(reviews, head)) {
    console.error('Current-head owner approval is required for identifier/exception policy edits.');
    return 1;
  }
  console.log('Current-head owner approval confirmed.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await run(); }
  catch { console.error('Owner-review verification unavailable; failing closed.'); process.exitCode = 2; }
}
