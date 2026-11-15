import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, posix } from 'node:path';
import { parseDocument } from 'yaml';

const owner = '@easemyhosting-com';
const deadline = '2026-12-15';
const rules = new Set(['COMPOSE-UNRESOLVABLE', 'COMPOSE-PRIVILEGED', 'COMPOSE-HOST-NAMESPACE', 'COMPOSE-DOCKER-SOCKET', 'COMPOSE-PUBLISHED-PORT', 'COMPOSE-DANGEROUS-CAPABILITY', 'COMPOSE-UNCONFINED', 'COMPOSE-DEVICES', 'COMPOSE-SENSITIVE-BIND']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function readExceptions(text, today = new Date().toISOString().slice(0, 10)) {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) throw new Error('Invalid exception policy');
  const document = JSON.parse(blocks[0][1]);
  if (!record(document) || Object.keys(document).join() !== 'exceptions' || !Array.isArray(document.exceptions)) throw new Error('Invalid exception policy');
  const seen = new Set();
  for (const e of document.exceptions) {
    const fields = ['id', 'finding', 'path', 'severity', 'owner', 'review_by', 'reason', 'risk', ...(e.service === undefined ? [] : ['service']), ...(e.compose_path === undefined ? [] : ['compose_path']), ...(e.location === undefined ? [] : ['location'])];
    if (!record(e) || Object.keys(e).length !== fields.length || !fields.every(k => typeof e[k] === 'string' && e[k].trim())) throw new Error('Incomplete exception');
    if (seen.has(e.id)) throw new Error('Duplicate exception');
    seen.add(e.id);
    if (e.owner !== owner || !safeDate(e.review_by) || e.review_by > deadline || e.review_by < today) throw new Error('Exception expired or requires owner review');
    const image = e.id === 'EX-001' && e.finding === 'AVD-DS-0002' && e.path === 'cliproxy/Dockerfile' && e.severity === 'HIGH' && e.service === 'cli-proxy-api' && e.compose_path === 'compose.yml';
    const compose = e.path === 'compose.yml' && rules.has(e.finding) && /^[a-zA-Z0-9_.-]+$/.test(e.service ?? '') && e.severity === 'HIGH' && typeof e.location === 'string' && e.location.startsWith(`services.${e.service}.`);
    if (!image && !compose) throw new Error('Exception scope is not approved');
  }
  return document.exceptions;
}

function defaults(value) {
  // Interpolation is evaluated after YAML parsing, never by a shell or process.env.
  let output = '', i = 0;
  while (i < value.length) {
    if (value[i] !== '$') { output += value[i++]; continue; }
    if (value[i + 1] === '$') { output += '$'; i += 2; continue; }
    if (value[i + 1] !== '{') throw new Error('unresolvable');
    const end = value.indexOf('}', i + 2);
    if (end < 0) throw new Error('unresolvable');
    const expression = value.slice(i + 2, end);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?::?-)([^{}]*)$/.exec(expression);
    if (!match) throw new Error('unresolvable');
    const replacement = match[2];
    if (replacement.includes('$')) throw new Error('unresolvable');
    output += replacement;
    i = end + 1;
  }
  return output;
}

function interpolate(value, location, failures, service, depth = 0) {
  if (depth > 40) { failures.push({ rule: 'COMPOSE-UNRESOLVABLE', service, location }); return null; }
  if (typeof value === 'string') {
    try { return defaults(value); }
    catch { failures.push({ rule: 'COMPOSE-UNRESOLVABLE', service, location }); return null; }
  }
  if (Array.isArray(value)) return value.map((v, n) => interpolate(v, `${location}.${n}`, failures, service, depth + 1));
  if (record(value)) {
    const result = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      if (key.includes('$')) failures.push({ rule: 'COMPOSE-UNRESOLVABLE', service, location: `${location}.key` });
      result[key] = interpolate(child, `${location}.${key}`, failures, service, depth + 1);
    }
    return result;
  }
  return value;
}

function array(value, location, failures, service) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { failures.push({ rule: 'COMPOSE-UNRESOLVABLE', service, location }); return []; }
  return value;
}
const loopback = host => host === '::1' || host === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host) && host.split('.').every(n => Number(n) <= 255);
const pathParts = source => typeof source === 'string' ? source.replaceAll('\\', '/').replace(/\/+$/, '') : '';
const socket = value => typeof value === 'string' && pathParts(value).endsWith('docker.sock');
const sensitive = source => {
  const path = pathParts(source) === '' ? '/' : posix.normalize(pathParts(source));
  return path === '' || path === '/' || path === '..' || path.startsWith('../') || ['/etc', '/var/run', '/proc', '/sys'].some(p => path === p || path.startsWith(`${p}/`)) || path === '~' || path.startsWith('~/') || path === '$HOME' || path.startsWith('$HOME/') || path.includes('${HOME');
};

export function checkCompose(text, { policyText, today = new Date().toISOString().slice(0, 10), path = 'compose.yml' } = {}) {
  const failures = [], warnings = [], accepted = [];
  let exceptions = [];
  if (policyText !== undefined) {
    try { exceptions = readExceptions(policyText, today); }
    catch { return { failures: [{ rule: 'COMPOSE-EXCEPTION-POLICY', location: 'security/known-exceptions.md' }], warnings, accepted }; }
  }
  let raw;
  try {
    if (!text.trim() || Buffer.byteLength(text) > 1024 * 1024) throw new Error('Invalid input');
    const doc = parseDocument(text, { merge: true, uniqueKeys: true, strict: true });
    if (doc.errors.length || doc.warnings.length) throw new Error('Invalid YAML');
    raw = doc.toJS({ maxAliasCount: 100 });
    if (!record(raw) || !record(raw.services) || !Object.keys(raw.services).length) throw new Error('No services');
  } catch { return { failures: [{ rule: 'COMPOSE-INVALID', location: path }], warnings, accepted }; }
  if (Object.hasOwn(raw, 'include')) failures.push({ rule: 'COMPOSE-UNRESOLVABLE', location: 'include' });
  for (const [name, original] of Object.entries(raw.services)) {
    const add = (rule, field) => failures.push({ rule, service: name, location: `services.${name}.${field}` });
    if (!record(original)) { add('COMPOSE-UNRESOLVABLE', 'definition'); continue; }
    if (Object.hasOwn(original, 'extends')) add('COMPOSE-UNRESOLVABLE', 'extends');
    // Inspect security-sensitive fields only. Runtime environment, env_file,
    // labels and commands are neither interpolated nor read by this checker.
    const service = { ...original };
    for (const field of ['ports', 'volumes', 'mounts', 'network_mode', 'pid', 'ipc', 'privileged', 'cap_add', 'security_opt', 'devices', 'user']) {
      if (Object.hasOwn(original, field)) service[field] = interpolate(original[field], `services.${name}.${field}`, failures, name);
    }
    if (!(typeof service.image === 'string' && service.image.trim() || typeof service.build === 'string' && service.build.trim() || record(service.build))) add('COMPOSE-INVALID', 'image-or-build');
    if (Object.hasOwn(service, 'privileged') && service.privileged !== false) add('COMPOSE-PRIVILEGED', 'privileged');
    for (const field of ['network_mode', 'pid', 'ipc']) {
      if (service[field] === 'host') add('COMPOSE-HOST-NAMESPACE', field);
      else if (service[field] !== undefined && typeof service[field] !== 'string') add('COMPOSE-UNRESOLVABLE', field);
    }
    for (const cap of array(service.cap_add, 'cap_add', failures, name)) {
      if (typeof cap !== 'string') add('COMPOSE-UNRESOLVABLE', 'cap_add');
      else if (['SYS_ADMIN', 'NET_ADMIN', 'ALL'].includes(cap.toUpperCase().replace(/^CAP_/, ''))) add('COMPOSE-DANGEROUS-CAPABILITY', 'cap_add');
    }
    const opts = array(service.security_opt, 'security_opt', failures, name);
    for (const option of opts) {
      if (typeof option !== 'string') add('COMPOSE-UNRESOLVABLE', 'security_opt');
      else if (/^(seccomp|apparmor)[:=]unconfined$/i.test(option.trim())) add('COMPOSE-UNCONFINED', 'security_opt');
    }
    if (service.devices !== undefined && (!Array.isArray(service.devices) || service.devices.length)) add('COMPOSE-DEVICES', 'devices');
    for (const port of array(service.ports, 'ports', failures, name)) {
      if (record(port)) {
        if (typeof port.host_ip !== 'string' || !loopback(port.host_ip) || port.published === undefined || port.target === undefined) add('COMPOSE-PUBLISHED-PORT', 'ports');
      } else if (typeof port === 'string') {
        const match = /^(\[[^\]]+\]|[^:]+):([0-9]+(?:-[0-9]+)?):([0-9]+(?:-[0-9]+)?)(?:\/(?:tcp|udp|sctp))?$/.exec(port);
        if (!match || !loopback(match[1])) add('COMPOSE-PUBLISHED-PORT', 'ports');
      } else add('COMPOSE-PUBLISHED-PORT', 'ports');
    }
    for (const mount of [...array(service.volumes, 'volumes', failures, name), ...array(service.mounts, 'mounts', failures, name)]) {
      let source, target, bind = false;
      if (typeof mount === 'string') {
        const parts = mount.split(':');
        if (parts.length > 3 || !parts.length) { add('COMPOSE-UNRESOLVABLE', 'volumes'); continue; }
        source = parts.length > 1 ? parts[0] : '';
        target = parts.length > 1 ? parts[1] : parts[0];
        bind = source.startsWith('/') || source.startsWith('.') || source.startsWith('~') || source.includes('$');
        if (parts.length > 1 && !source) add('COMPOSE-UNRESOLVABLE', 'volumes');
      } else if (record(mount)) {
        source = mount.source; target = mount.target; bind = mount.type === 'bind';
        if (!['bind', 'volume', 'tmpfs', 'image', 'cluster'].includes(mount.type)) add('COMPOSE-UNRESOLVABLE', 'volumes');
        if (bind && typeof source !== 'string') add('COMPOSE-UNRESOLVABLE', 'volumes');
      } else { add('COMPOSE-UNRESOLVABLE', 'volumes'); continue; }
      const definition = record(raw.volumes) && typeof source === 'string' ? raw.volumes[source] : undefined;
      if (record(definition) && record(definition.driver_opts)) {
        const opts = interpolate(definition.driver_opts, `services.${name}.volume-options`, failures, name);
        if (socket(opts.device)) add('COMPOSE-DOCKER-SOCKET', 'volumes');
        if (typeof opts.device === 'string' && sensitive(opts.device)) add('COMPOSE-SENSITIVE-BIND', 'volumes');
      }
      if (socket(source) || socket(target)) add('COMPOSE-DOCKER-SOCKET', 'volumes');
      if (bind && sensitive(source)) add('COMPOSE-SENSITIVE-BIND', 'volumes');
      if (typeof target !== 'string' || !target.startsWith('/')) add('COMPOSE-UNRESOLVABLE', 'volumes');
    }
    if (!opts.some(v => typeof v === 'string' && /^no-new-privileges(?::true|=true)?$/.test(v))) warnings.push({ rule: 'COMPOSE-WARN-NO-NEW-PRIVILEGES', service: name });
    if (!Array.isArray(service.cap_drop) || !service.cap_drop.some(v => typeof v === 'string' && v.toUpperCase() === 'ALL')) warnings.push({ rule: 'COMPOSE-WARN-CAP-DROP', service: name });
    if (service.user === undefined || service.user === 0 || /^(root|0)(:|$)/.test(String(service.user))) warnings.push({ rule: 'COMPOSE-WARN-ROOT-OR-UNKNOWN-USER', service: name });
    if (service.read_only !== true) warnings.push({ rule: 'COMPOSE-WARN-READ-ONLY', service: name });
  }
  // No inline bypasses. An exception is exact by file, service and finding only.
  const remaining = failures.filter(f => {
    const entry = exceptions.find(e => e.path === path && e.service === f.service && e.finding === f.rule && e.location === f.location);
    if (!entry) return true;
    accepted.push({ ...f, exception: entry.id });
    return false;
  });
  return { failures: remaining, warnings, accepted };
}

export function run(argv = process.argv.slice(2)) {
  const stdin = argv.includes('--stdin');
  const args = argv.filter(a => a !== '--stdin');
  const file = args[0] ?? 'compose.yml';
  if (args.length > 1 || /(^|[\\/])\.env/.test(file)) { console.error('Invalid Compose scan path'); return 2; }
  try {
    const text = readFileSync(stdin ? 0 : file, 'utf8');
    const policyText = readFileSync(new URL('../security/known-exceptions.md', import.meta.url), 'utf8');
    const result = checkCompose(text, { policyText, path: file });
    for (const entry of result.failures) console.error(`FAIL ${entry.rule}: ${entry.location}`);
    for (const entry of result.warnings) console.log(`WARN ${entry.rule}: service ${entry.service}`);
    for (const entry of result.accepted) console.log(`EXCEPTION ${entry.exception}: ${entry.rule} service ${entry.service}`);
    console.log(`Compose policy: ${result.failures.length} failure(s), ${result.warnings.length} warning(s)`);
    return result.failures.length ? 1 : 0;
  } catch { console.error('Compose policy unavailable: invalid YAML, policy or unreadable input'); return 2; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run();
