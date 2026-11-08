import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';

if (process.versions.node.split('.')[0] !== '24') throw new Error('Run this verification with Node.js 24.');
for (const command of ['initdb', 'pg_ctl', 'createdb']) {
  if (spawnSync(command, ['--version'], { stdio: 'ignore' }).status !== 0) throw new Error(`Install PostgreSQL development tools (${command} is required).`);
}
const directory = await mkdtemp(join(tmpdir(), 'fleethub-verify-'));
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const address = listener.address();
if (!address || typeof address === 'string') throw new Error('Could not allocate a local test port');
const port = address.port;
await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const database = join(directory, 'data');
let started = false;
function run(command, args, env = process.env, quiet = false) {
  const result = spawnSync(command, args, { env, stdio: quiet ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`Verification command failed: ${command} (exit ${result.status ?? 'unavailable'}).`);
}
try {
  run('initdb', ['-D', database, '-U', 'review', '-A', 'trust', '--no-locale'], process.env, true);
  run('pg_ctl', ['-D', database, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start'], process.env, true);
  started = true;
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'review', 'fleethub_security'], process.env, true);
  const env = { ...process.env, DATABASE_URL: `postgres://review@127.0.0.1:${port}/fleethub_security`, AUTH_DATABASE_INTEGRATION: 'true', DATABASE_INTEGRATION: 'true', FLEETHUB_SEED_DEMO_DATA: 'false', FLEETHUB_DEMO_MODE: 'false' };
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], env);
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--coverage', '--reporter=dot', '--fileParallelism=false'], env);
  run(process.execPath, ['node_modules/next/dist/bin/next', 'build'], env);
  run(process.execPath, ['scripts/build-worker.mjs'], env);
  run(process.execPath, ['scripts/build-mcp.mjs'], env);
  run(process.execPath, ['scripts/check-hygiene.mjs'], env);
  run('git', ['diff', '--check'], env);
  console.log('Disposable PostgreSQL integration, tests, coverage, typecheck, build and hygiene passed.');
} finally {
  let stopped = !started;
  if (started) stopped = spawnSync('pg_ctl', ['-D', database, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' }).status === 0;
  if (stopped) await rm(directory, { recursive: true, force: true });
  else console.error(`Could not stop the disposable PostgreSQL instance. Its files remain at ${directory}.`);
}
