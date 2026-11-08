/** Parses an OCI CLI config (~/.oci/config) and pairs each profile with an uploaded API key. Pure, so the browser previews exactly what the server will accept. */
export interface OciProfile { profile: string; user: string; fingerprint: string; tenancy: string; region: string; keyFile: string | null }
export interface OciKeyFile { name: string; content: string }
export interface OciCandidate extends OciProfile {
  privateKey: string | null;
  /** Why this profile cannot be imported yet; null when it is ready. */
  problem: string | null;
}

const required = ["user", "fingerprint", "tenancy", "region"] as const;

export function parseOciConfig(text: string): OciProfile[] {
  const profiles: OciProfile[] = [];
  let current: { profile: string; values: Record<string, string> } | null = null;
  const flush = () => {
    if (!current) return;
    const v = current.values;
    profiles.push({ profile: current.profile, user: v.user ?? "", fingerprint: v.fingerprint ?? "", tenancy: v.tenancy ?? "", region: v.region ?? "", keyFile: v.key_file ?? null });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[([^\]]{1,64})\]$/.exec(line);
    if (header) { flush(); current = { profile: header[1], values: {} }; continue; }
    const pair = /^([A-Za-z_]+)\s*=\s*(.*)$/.exec(line);
    if (pair && current) current.values[pair[1].toLowerCase()] = pair[2].trim();
  }
  flush();
  return profiles;
}

const base = (path: string) => path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
const isPem = (content: string) => /-----BEGIN (RSA )?PRIVATE KEY-----/.test(content);

/** Matches keys by the file name in key_file; a single uploaded key is used when the names do not match but only one profile needs it. */
export function matchOciKeys(profiles: OciProfile[], keys: OciKeyFile[]): OciCandidate[] {
  const byName = new Map(keys.map(key => [base(key.name), key]));
  const unmatched = keys.filter(key => !profiles.some(p => p.keyFile && base(p.keyFile) === base(key.name)));
  return profiles.map(profile => {
    const missing = required.filter(field => !profile[field]);
    let key = profile.keyFile ? byName.get(base(profile.keyFile)) : undefined;
    if (!key && profiles.length === 1 && unmatched.length === 1) key = unmatched[0];
    let problem: string | null = null;
    if (missing.length) problem = `Missing ${missing.join(", ")} in the config`;
    else if (!key) problem = `Upload the key file${profile.keyFile ? ` ${base(profile.keyFile)}` : ""}`;
    else if (/ENCRYPTED/.test(key.content)) problem = "The key has a passphrase. Remove it first: openssl rsa -in key.pem -out key-plain.pem";
    else if (!isPem(key.content)) problem = "That file is not an RSA private key in PEM format";
    return { ...profile, privateKey: problem === null && key ? key.content.trim() : key?.content.trim() ?? null, problem };
  });
}

/** The provider registration body for one candidate; the server validates it again. */
export function ociRegistration(candidate: OciCandidate, label: string, ownerEmail: string) {
  return {
    providerId: "oracle", label, ownerEmail, role: "general", isProtected: true,
    config: { tenancyId: candidate.tenancy, userId: candidate.user, fingerprint: candidate.fingerprint, region: candidate.region, privateKey: candidate.privateKey ?? "" },
  };
}

/** The account owner is often in the key's file name (alex@example.com_2025-02-02T04_54_45.641Z.pem, the name the OCI console gives downloads). */
export function guessOwnerEmail(...names: Array<string | null | undefined>): string | null {
  for (const name of names) {
    const found = name?.split(/[\\/]/).pop()?.replace(/\.pem$/i, "").match(/^([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})(?=[_.\s]|$)/);
    if (found) return found[1].toLowerCase();
  }
  return null;
}

/** Profiles that point at a tenancy an earlier profile already uses, keyed by profile name. */
export function duplicateTenancies(profiles: ReadonlyArray<{ profile: string; tenancy: string }>): Record<string, string> {
  const first = new Map<string, string>();
  const duplicates: Record<string, string> = {};
  for (const { profile, tenancy } of profiles) {
    const key = tenancy.trim().toLowerCase();
    if (!key) continue;
    const earlier = first.get(key);
    if (earlier) duplicates[profile] = earlier; else first.set(key, profile);
  }
  return duplicates;
}
