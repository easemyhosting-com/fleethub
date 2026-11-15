#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const allowLocalServiceHttp = process.argv.slice(2).includes("--allow-local-service-http");
const args = process.argv.slice(2).filter(value => value !== "--allow-local-service-http");
let directory = '.local-setup';
if (args.length === 2 && args[0] === '--directory' && args[1] && !args[1].startsWith('-')) {
  directory = args[1];
} else if (args.length !== 0) {
  console.error('Usage: node scripts/prepare-local-setup.mjs [--directory NEW_DIRECTORY] [--allow-local-service-http]');
  process.exit(2);
}

const target = resolve(directory);
const secret = (bytes = 32) => randomBytes(bytes).toString('hex');
const values = {
  FLEETHUB_DB_PASSWORD: secret(),
  FLEETHUB_AUTH_SECRET: secret(),
  FLEETHUB_SECRET_STORE_KEY: secret(),
  FLEETHUB_BOOTSTRAP_TOKEN: secret(),
  FLEETHUB_API_KEY: secret(),
  FLEETHUB_READONLY_KEY: secret(),
  FLEETHUB_OBSERVATION_KEY: secret(),
  INFISICAL_DB_PASSWORD: secret(),
  INFISICAL_ENCRYPTION_KEY: secret(16),
  INFISICAL_AUTH_SECRET: secret(),
  CLIPROXY_API_KEY: secret(),
  CLIPROXY_MANAGEMENT_KEY: secret(),
};
const env = [
  '# Private local setup. Generated once; preserve this file and back it up securely.',
  ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  'FLEETHUB_APP_URL=http://localhost:3060',
  'INFISICAL_SITE_URL=http://localhost:8088',
  'INFISICAL_URL=http://infisical:8080',
  '# These origins authorize API requests, not container startup. Replace them when reusing services.',
  '# Enable only for bundled services on a trusted container network; keep false for remote services.',
  `FLEETHUB_ALLOW_INSECURE_SERVICE_HTTP=${allowLocalServiceHttp}`,
  'FLEETHUB_ONBOARDING_ALLOWED_ORIGINS=http://infisical:8080,http://cli-proxy-api:8317',
  'CLIPROXY_IMAGE=eceasy/cli-proxy-api:latest@sha256:3f74ca56cba8bea2a2a096a215bb774482d87d257da04c5047e6046493bfd644',
  'INFISICAL_IMAGE=infisical/infisical:latest@sha256:cb971a75043b6fafdc738e9ca6d4f8a09b4f979a60b2b9ade39af5e095bcc5fb',
  `CLIPROXY_CONFIG_PATH=${join(target, 'cliproxy-config.yaml')}`,
  `TAILSCALE_STATUS_PATH=${join(target, 'tailscale-status.json')}`,
  `FLEETHUB_RUNTIME_DIR=${join(target, 'runtime')}`,
  '# Add these after creating an Infisical machine identity in its UI:',
  'INFISICAL_UNIVERSAL_AUTH_CLIENT_ID=',
  'INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET=',
  '# Add this only when using Tailscale integration:',
  'TAILSCALE_API_TOKEN=',
  'TAILSCALE_DEVICE_ID=',
  '',
].join('\n');
const proxyConfig = [
  'config-version: 8',
  'server:',
  '  host: ""',
  '  port: 8317',
  'management:',
  '  allow-remote: true',
  `  secret-key: "${values.CLIPROXY_MANAGEMENT_KEY}"`,
  'access:',
  '  api-keys:',
  `    - "${values.CLIPROXY_API_KEY}"`,
  'oauth:',
  '  auth-dir: /root/.cli-proxy-api',
  'observability:',
  '  logs:',
  '    logging-to-file: false',
  '',
].join('\n');

async function writePrivate(path, content, mode = 0o600) {
  const file = await open(path, 'wx', mode);
  try {
    await file.writeFile(content, 'utf8');
  } finally {
    await file.close();
  }
}

try {
  await mkdir(target, { mode: 0o755 });
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('Setup directory already exists. Choose a new --directory; existing secrets were not changed.');
    process.exit(1);
  }
  throw error;
}
try {
  await writePrivate(join(target, '.env'), env);
  await writePrivate(join(target, 'cliproxy-config.yaml'), proxyConfig);
  await writePrivate(join(target, 'tailscale-status.json'), '{}\n', 0o644);
  await mkdir(join(target, 'runtime'), { mode: 0o755 });
  await writePrivate(join(target, 'runtime', 'runtime.env'), '# Hot-reloaded settings (no restart needed). See docs/38-hot-reload-config.md.\n', 0o644);
} catch (error) {
  await rm(target, { recursive: true, force: true });
  throw error;
}
console.log(`Private setup files created in ${target}`);
console.log('No containers were started. Connect existing services first; local services are optional.');
console.log('After reviewing your configuration, use --profile infisical or --profile cliproxy only for services you want to run locally.');
console.log('Read docs/23-self-onboarding.md before starting services. Keep the files secure and do not share their contents.');
