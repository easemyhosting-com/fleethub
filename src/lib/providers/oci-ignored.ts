/** Remembers OCI profiles the owner unticked so a later upload of the same config leaves them unticked. Pure: storage is injected, so the logic runs in tests without a browser. */
import type { OciProfile } from "./oci-config";

/** Only the non-secret fields identify a profile; the PEM key and its fingerprint are never read here. */
export type FingerprintSource = Pick<OciProfile, "tenancy" | "user" | "region">;

/** The slice of Storage this module needs; window.localStorage satisfies it. */
export interface IgnoredStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const OCI_IGNORED_KEY = "fleethub.oci.ignored.v1";
const FINGERPRINT = /^[0-9a-f]{64}$/;

function defaultStore(): IgnoredStore | null {
  // Access can throw when storage is blocked (Safari private mode, third-party iframes).
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** sha256 hex of tenancy OCID + user OCID + region. Stable across uploads and reveals nothing about the key. */
export async function profileFingerprint(profile: FingerprintSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot fingerprint OCI profiles (Web Crypto is unavailable)");
  const canonical = [profile.tenancy, profile.user, profile.region].map(part => part.trim()).join("\n");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Keeps only well-formed fingerprints, lowercased, in first-seen order. */
export function normalizeIgnored(values: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const fingerprint = value.trim().toLowerCase();
    if (FINGERPRINT.test(fingerprint)) seen.add(fingerprint);
  }
  return [...seen];
}

/** The remembered fingerprints; a missing, unreadable or malformed entry yields an empty list. */
export function loadIgnored(store: IgnoredStore | null = defaultStore()): string[] {
  try {
    if (!store) return [];
    const raw = store.getItem(OCI_IGNORED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeIgnored(parsed) : [];
  } catch { return []; }
}

/** Writes the list and returns what was written; a blocked or throwing store is not an error for the caller. */
export function saveIgnored(values: Iterable<unknown>, store: IgnoredStore | null = defaultStore()): string[] {
  const fingerprints = normalizeIgnored(values);
  try { store?.setItem(OCI_IGNORED_KEY, JSON.stringify(fingerprints)); } catch { /* storage unavailable; ignore for this session */ }
  return fingerprints;
}

/** Union of what is remembered and what is being ignored now, keeping first-seen order. */
export function mergeIgnored(current: Iterable<unknown>, added: Iterable<unknown>): string[] {
  return normalizeIgnored([...normalizeIgnored(current), ...normalizeIgnored(added)]);
}

/** Drops fingerprints the owner chose to include again. */
export function forgetIgnored(current: Iterable<unknown>, removed: Iterable<unknown>): string[] {
  const drop = new Set(normalizeIgnored(removed));
  return normalizeIgnored(current).filter(fingerprint => !drop.has(fingerprint));
}
