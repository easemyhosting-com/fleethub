import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Settings that may change while FleetHub runs. Security-critical toggles (auth secret, database URL, auth-required, proxy trust) deliberately need a restart. */
export const reloadableKeys: ReadonlySet<string> = new Set([
  "FLEETHUB_APP_URL", "FLEETHUB_ALLOWED_ORIGINS", "FLEETHUB_API_KEY", "FLEETHUB_READONLY_KEY", "FLEETHUB_OBSERVATION_KEY", "FLEETHUB_BOOTSTRAP_TOKEN",
  "FLEETHUB_DEVICE_PAIRING", "FLEETHUB_PAIRING_QR", "FLEETHUB_PAIRING_MAX_SCOPE", "FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "FLEETHUB_SETUP_FRESHNESS_MINUTES",
  "INFISICAL_URL", "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET",
  "TAILSCALE_API_TOKEN", "TAILSCALE_API_AUTH", "TAILSCALE_DEVICE_ID", "CLIPROXY_API_KEY", "CLIPROXY_MANAGEMENT_KEY",
]);

const maxFileBytes = 64 * 1024;
const maxValueLength = 4096;
const linePattern = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;

export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = linePattern.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    if (value.length <= maxValueLength) values[match[1]] = value;
  }
  return values;
}

/** Reads metadata and content from one descriptor so a file swapped between the size check and the read cannot bypass the limit. */
function readBounded(path: string): { signature: string; text?: string } {
  const fd = openSync(path, "r");
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new Error("not a regular file");
    const signature = `${stats.ino}:${stats.mtimeMs}:${stats.size}`;
    if (stats.size > maxFileBytes) return { signature };
    const buffer = Buffer.alloc(maxFileBytes + 1);
    let length = 0;
    for (let read; length < buffer.length && (read = readSync(fd, buffer, length, buffer.length - length, length)) > 0;) length += read;
    if (length > maxFileBytes) return { signature };
    return { signature, text: buffer.toString("utf8", 0, length) };
  } finally {
    closeSync(fd);
  }
}

type Options = { env?: Record<string, string | undefined>; now?: () => number; intervalMs?: number; log?: (message: string) => void };

type State = { originals: Map<string, string | undefined>; signature: string; checkedAt: number };
const sharedState = Symbol.for("fleethub.runtime-env");

export function createRuntimeEnv(options: Options = {}, shared = false) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 1000;
  const log = options.log ?? ((message: string) => console.info(message));
  // Next.js bundles each route separately, so the shared instance keeps its state on globalThis to avoid duplicate reloads and lost originals.
  const holder = globalThis as unknown as Record<symbol, State | undefined>;
  const state: State = shared ? (holder[sharedState] ??= { originals: new Map(), signature: "", checkedAt: Number.NEGATIVE_INFINITY }) : { originals: new Map(), signature: "", checkedAt: Number.NEGATIVE_INFINITY };
  const { originals } = state;

  /** Applies the allowlisted settings from FLEETHUB_RUNTIME_ENV_FILE. Cheap: at most one open and stat per interval. Returns the names (never values) of settings that changed. */
  return function refresh(): string[] {
    const path = env.FLEETHUB_RUNTIME_ENV_FILE;
    if (!path) return [];
    const current = now();
    if (current - state.checkedAt < intervalMs) return [];
    state.checkedAt = current;
    let next: string;
    let parsed: Record<string, string> = {};
    try {
      const file = readBounded(path);
      next = file.signature;
      if (next === state.signature) return [];
      if (file.text === undefined) { log("Runtime configuration file is larger than 64 KB and was ignored"); state.signature = next; return []; }
      parsed = parseEnvFile(file.text);
    } catch {
      next = "missing";
      if (state.signature === next) return [];
    }
    state.signature = next;
    const changed: string[] = [];
    for (const key of reloadableKeys) {
      const wanted = Object.hasOwn(parsed, key) ? parsed[key] : undefined;
      if (wanted === undefined) {
        if (originals.has(key)) {
          const original = originals.get(key);
          originals.delete(key);
          if (original === undefined) delete env[key]; else env[key] = original;
          changed.push(key);
        }
        continue;
      }
      if (!originals.has(key)) originals.set(key, env[key]);
      if (env[key] !== wanted) { env[key] = wanted; changed.push(key); }
    }
    if (changed.length > 0) log(`Runtime configuration reloaded: ${changed.sort().join(", ")}`);
    return changed;
  };
}

export const refreshRuntimeEnv = createRuntimeEnv({}, true);
