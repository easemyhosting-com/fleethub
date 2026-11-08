import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OCI_IGNORED_KEY, forgetIgnored, loadIgnored, mergeIgnored, normalizeIgnored, profileFingerprint, saveIgnored, type IgnoredStore } from "../src/lib/providers/oci-ignored";

const profile = { tenancy: "ocid1.tenancy.oc1..aaaatenancy", user: "ocid1.user.oc1..aaaauser", region: "ap-mumbai-1" };
const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const expected = hex(`${profile.tenancy}\n${profile.user}\n${profile.region}`);
const other = "b".repeat(64);

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: IgnoredStore & { data: Map<string, string> } = {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
  return store;
}

describe("OCI ignored-profile fingerprints", () => {
  it("hashes tenancy + user + region as sha256 hex", async () => {
    expect(await profileFingerprint(profile)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across whitespace and independent of the profile name or any key material", async () => {
    const padded = { tenancy: ` ${profile.tenancy} `, user: `${profile.user}\t`, region: ` ${profile.region}` };
    const withSecrets = { ...profile, profile: "another-name", fingerprint: "aa:bb:cc", keyFile: "owner.pem", privateKey: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(64)}\n-----END PRIVATE KEY-----` }; // gitleaks:allow (synthetic fixture)
    expect(await profileFingerprint(padded)).toBe(expected);
    expect(await profileFingerprint(withSecrets)).toBe(expected);
  });

  it("changes when any identified field changes", async () => {
    const values = await Promise.all([
      profileFingerprint({ ...profile, tenancy: "ocid1.tenancy.oc1..different" }),
      profileFingerprint({ ...profile, user: "ocid1.user.oc1..different" }),
      profileFingerprint({ ...profile, region: "eu-frankfurt-1" }),
    ]);
    expect(new Set([expected, ...values]).size).toBe(4);
  });
});

describe("OCI ignored-profile storage", () => {
  it("returns an empty list when storage is missing, empty or unreadable", () => {
    expect(loadIgnored(null)).toEqual([]);
    expect(loadIgnored(memoryStore())).toEqual([]);
    expect(loadIgnored(memoryStore({ [OCI_IGNORED_KEY]: "not json" }))).toEqual([]);
    expect(loadIgnored(memoryStore({ [OCI_IGNORED_KEY]: JSON.stringify({ fingerprint: expected }) }))).toEqual([]);
    expect(loadIgnored({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} })).toEqual([]);
  });

  it("loads only well-formed fingerprints, deduped and lowercased", () => {
    const stored = JSON.stringify([expected.toUpperCase(), expected, "not-a-fingerprint", 42, null, other, " "]);
    expect(loadIgnored(memoryStore({ [OCI_IGNORED_KEY]: stored }))).toEqual([expected, other]);
  });

  it("saves a JSON array under the versioned key and never stores anything but fingerprints", () => {
    const store = memoryStore();
    const secret = `-----BEGIN RSA PRIVATE KEY-----\n${"A".repeat(64)}\n-----END RSA PRIVATE KEY-----`;
    const written = saveIgnored([expected, secret, "aa:bb:cc:dd"], store);
    expect(written).toEqual([expected]);
    expect(store.data.get(OCI_IGNORED_KEY)).toBe(JSON.stringify([expected]));
    expect(store.data.get(OCI_IGNORED_KEY)).not.toContain("BEGIN");
    expect(loadIgnored(store)).toEqual([expected]);
  });

  it("treats a blocked store as a no-op instead of throwing", () => {
    const store: IgnoredStore = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => saveIgnored([expected], store)).not.toThrow();
    expect(saveIgnored([expected], store)).toEqual([expected]);
  });
});

describe("OCI ignored-profile merging", () => {
  it("unions without duplicates and keeps first-seen order", () => {
    expect(mergeIgnored([expected, other], [other, "c".repeat(64)])).toEqual([expected, other, "c".repeat(64)]);
  });

  it("does not mutate its inputs and drops junk", () => {
    const current = [expected];
    const added = [other, "junk"];
    expect(mergeIgnored(current, added)).toEqual([expected, other]);
    expect(current).toEqual([expected]);
    expect(added).toEqual([other, "junk"]);
  });

  it("forgets fingerprints the owner includes again", () => {
    const all = [expected, other];
    expect(forgetIgnored(all, [other])).toEqual([expected]);
    expect(forgetIgnored(all, ["c".repeat(64)])).toEqual(all);
    expect(forgetIgnored(all, [expected, other])).toEqual([]);
  });

  it("normalises any iterable to valid fingerprints", () => {
    expect(normalizeIgnored(new Set([expected, expected, "nope"]))).toEqual([expected]);
  });
});
