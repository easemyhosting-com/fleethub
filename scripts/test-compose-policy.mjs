import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { checkCompose } from './check-compose-policy.mjs';

const service = body => `services:\n  app:\n    image: example.invalid/application:1\n${body.split('\n').map(l => `    ${l}`).join('\n')}\n`;
const cases = [
  ['privileged', 'privileged: true', 'privileged: false'],
  ['host network', 'network_mode: host', 'network_mode: bridge'],
  ['host pid', 'pid: host', 'pid: private'],
  ['host ipc', 'ipc: host', 'ipc: private'],
  ['short socket', 'volumes: ["/var/run/docker.sock:/socket"]', 'volumes: ["data:/data"]'],
  ['long socket', 'volumes: [{type: volume, source: docker.sock, target: /socket}]', 'volumes: [{type: volume, source: data, target: /data}]'],
  ['short port', 'ports: ["8080:80"]', 'ports: ["127.0.0.1:8080:80"]'],
  ['all interfaces', 'ports: ["0.0.0.0:8080:80"]', 'ports: ["[::1]:8080:80"]'],
  ['long port', 'ports: [{target: 80, published: 8080, host_ip: "0.0.0.0"}]', 'ports: [{target: 80, published: 8080, host_ip: "127.0.0.1"}]'],
  ['SYS_ADMIN', 'cap_add: [SYS_ADMIN]', 'cap_add: [CHOWN]'],
  ['NET_ADMIN', 'cap_add: [NET_ADMIN]', 'cap_add: []'],
  ['ALL capabilities', 'cap_add: [ALL]', 'cap_drop: [ALL]'],
  ['seccomp', 'security_opt: ["seccomp:unconfined"]', 'security_opt: ["no-new-privileges:true"]'],
  ['apparmor', 'security_opt: ["apparmor:unconfined"]', 'security_opt: ["no-new-privileges:true"]'],
  ['devices', 'devices: ["/dev/example:/dev/example"]', 'devices: []'],
  ['root bind', 'volumes: ["/:/host"]', 'volumes: ["./data:/data"]'],
  ['etc bind', 'volumes: [{type: bind, source: /etc, target: /host}]', 'volumes: [{type: bind, source: ./data, target: /data}]'],
  ['run bind', 'volumes: ["/var/run:/host"]', 'volumes: ["data:/data"]'],
  ['proc bind', 'volumes: ["/proc:/host"]', 'volumes: ["data:/data"]'],
  ['sys bind', 'volumes: ["/sys:/host"]', 'volumes: ["data:/data"]'],
  ['HOME bind', 'volumes: ["$HOME:/host"]', 'volumes: ["./data:/data"]'],
  ['escaping relative bind', 'volumes: ["../../etc:/host"]', 'volumes: ["./data:/data"]'],
  ['normalized bind', 'volumes: ["/safe/../etc:/host"]', 'volumes: ["./safe:/data"]'],
  ['unresolvable', 'ports: ["${PORT}:80"]', 'ports: ["127.0.0.1:${PORT:-8080}:80"]'],
  ['extends', 'extends: {file: other.yml, service: app}', 'read_only: true'],
];
for (const [label, bad, good] of cases) {
  test(`${label}: failing and passing fixtures, with failing CLI exit`, () => {
    assert.ok(checkCompose(service(bad)).failures.length > 0);
    assert.equal(checkCompose(service(good)).failures.length, 0);
    const child = spawnSync(process.execPath, ['scripts/check-compose-policy.mjs', '--stdin', 'compose.yml'], { input: service(bad), encoding: 'utf8' });
    assert.notEqual(child.status, null);
    assert.notEqual(child.status, 0);
  });
}
test('anchors and merge keys do not hide privilege', () => {
  const input = 'x-base: &base\n  image: example.invalid/application:1\n  privileged: true\nservices:\n  app:\n    <<: *base\n';
  assert.ok(checkCompose(input).failures.some(f => f.rule === 'COMPOSE-PRIVILEGED'));
  assert.equal(checkCompose(input.replace('true', 'false')).failures.length, 0);
});
test('include is an explicit unresolved failure', () => {
  const input = 'include: other.yml\n' + service('read_only: true');
  assert.ok(checkCompose(input).failures.some(f => f.location === 'include'));
  assert.notEqual(spawnSync(process.execPath, ['scripts/check-compose-policy.mjs', '--stdin'], { input }).status, 0);
});
test('empty, invalid, duplicate, absent and empty service files fail', () => {
  for (const input of ['', 'services: [', 'services: {}', 'services: null', 'hello: world', 'services:\n  app: {}', 'services: {}\nservices: {}']) {
    assert.ok(checkCompose(input).failures.length > 0);
    assert.notEqual(spawnSync(process.execPath, ['scripts/check-compose-policy.mjs', '--stdin'], { input }).status, 0);
  }
});
test('warnings are visible but do not fail a safe fixture', () => {
  const result = checkCompose(service('user: "0:0"'));
  assert.equal(result.failures.length, 0);
  assert.equal(result.warnings.length, 4);
});
test('no process environment interpolation is used', () => {
  process.env.SYNTHETIC_PORT = '8080';
  assert.ok(checkCompose(service('ports: ["127.0.0.1:${SYNTHETIC_PORT}:80"]')).failures.length > 0);
  delete process.env.SYNTHETIC_PORT;
});
test('named-volume driver options cannot hide a socket', () => {
  const input = service('volumes: ["data:/data"]') + 'volumes:\n  data:\n    driver_opts:\n      device: /var/run/docker.sock\n';
  assert.ok(checkCompose(input).failures.some(f => f.rule === 'COMPOSE-DOCKER-SOCKET'));
});
test('service exception is exact by field and date', () => {
  const policy = { exceptions: [{ id: 'EX-TEST', finding: 'COMPOSE-UNRESOLVABLE', path: 'compose.yml', service: 'app', location: 'services.app.user', severity: 'HIGH', owner: '@easemyhosting-com', review_by: '2026-12-15', reason: 'Synthetic fixture', risk: 'Synthetic fixture' }] };
  const policyText = '```json\n' + JSON.stringify(policy) + '\n```';
  const input = service('user: "${SYNTHETIC_VALUE}"');
  const result = checkCompose(input, { policyText, today: '2026-11-15' });
  assert.equal(result.failures.length, 0); assert.equal(result.accepted.length, 1);
  assert.ok(checkCompose(input, { policyText, today: '2026-12-16' }).failures.length > 0);
  assert.ok(checkCompose(service('ports: ["${PORT}:80"]'), { policyText, today: '2026-11-15' }).failures.length > 0);
});

test('unresolved policy fields fail, including host binding, network, socket, capability and user', () => {
  for (const body of [
    'ports: ["${HOST_BIND}:8080"]',
    'ports: [{target: 80, published: 8080, host_ip: "${HOST_BIND}"}]',
    'network_mode: "${NET_MODE}"',
    'volumes: ["${SOCK}:/var/run/docker.sock"]',
    'cap_add: ["${CAP}"]',
    'user: "${USER_ID}"',
  ]) {
    assert.ok(checkCompose(service(body)).failures.some(f => f.rule === 'COMPOSE-UNRESOLVABLE'));
    assert.notEqual(spawnSync(process.execPath, ['scripts/check-compose-policy.mjs', '--stdin'], { input: service(body) }).status, 0);
  }
});
test('runtime environment, env_file, labels and commands are not evaluated or opened', () => {
  const input = service('environment: {VALUE: "${REQUIRED:?not configured}"}\nenv_file: ["${CONFIG_FILE}"]\nlabels: {example: "${LABEL}"}\ncommand: "${COMMAND}"');
  assert.equal(checkCompose(input).failures.length, 0);
  const child = spawnSync(process.execPath, ['scripts/check-compose-policy.mjs', '--stdin'], { input });
  assert.equal(child.status, 0);
});

test('pre-commit checks staged Compose content rather than the working copy', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, copyFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'compose-hook-test-'));
  const env = { PATH: process.env.PATH, HOME: join(directory, 'empty-home'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = args => { const result = spawnSync('git', args, { cwd: directory, env, encoding: 'utf8' }); assert.equal(result.status, 0); };
  try {
    git(['init', '--quiet']); mkdirSync(join(directory, 'scripts'));
    copyFileSync(resolve('scripts/check-compose-policy.mjs'), join(directory, 'scripts/check-compose-policy.mjs'));
    symlinkSync(resolve('node_modules'), join(directory, 'node_modules'));
    mkdirSync(join(directory, 'security'));
    copyFileSync(resolve('security/known-exceptions.md'), join(directory, 'security/known-exceptions.md'));
    for (const name of ['check-forbidden.sh', 'check-repository-policy.py', 'check-private-identifiers.py']) copyFileSync(resolve('scripts', name), join(directory, 'scripts', name));
    for (const name of ['forbidden-patterns.txt', 'suppression-patterns.txt', 'allowed-identifiers.txt', 'allowed-email-domains.txt']) copyFileSync(resolve('security', name), join(directory, 'security', name));
    copyFileSync(resolve('.gitleaks.toml'), join(directory, '.gitleaks.toml'));
    writeFileSync(join(directory, 'compose.yml'), service('privileged: true')); git(['add', 'compose.yml']);
    writeFileSync(join(directory, 'compose.yml'), service('privileged: false'));
    const command = ['bash', resolve('.githooks/pre-commit')];
    assert.notEqual(spawnSync(command[0], command.slice(1), { cwd: directory, env, encoding: 'utf8' }).status, 0);
    git(['add', 'compose.yml']);
    assert.equal(spawnSync(command[0], command.slice(1), { cwd: directory, env, encoding: 'utf8' }).status, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
