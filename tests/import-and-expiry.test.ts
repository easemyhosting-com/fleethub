import { describe, expect, it } from "vitest";
import { guessOwnerEmail, matchOciKeys, ociRegistration, parseOciConfig } from "../src/lib/providers/oci-config";
import { bulkLineHelp, parseBulkLines } from "../src/lib/providers/bulk-import";
import { choiceEmail, choiceIsValid, nameFromEmail, pickerIdentities, suggestIdentity } from "../src/lib/identity/picker";
import { describeNotice, expiryNotices } from "../src/lib/rotation/expiry";

const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----"; // gitleaks:allow (truncated fixture, not a usable key)
const fp = "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99";
const config = `# comment
[DEFAULT]
user=ocid1.user.oc1..aaa
fingerprint=${fp}
tenancy=ocid1.tenancy.oc1..bbbbbbbb
region = ap-mumbai-1
key_file=~/.oci/keys/default.pem

[ALEX]
user=ocid1.user.oc1..ccc
fingerprint=${fp}
tenancy=ocid1.tenancy.oc1..dddddddd
region=ap-mumbai-1
key_file=C:\\Users\\m\\alex.pem
pass_phrase=secret

[BROKEN]
user=ocid1.user.oc1..eee
`;

describe("OCI config import", () => {
  it("parses every profile, ignoring comments and stray lines", () => {
    const profiles = parseOciConfig(`orphan=1\n${config}`);
    expect(profiles.map(p => p.profile)).toEqual(["DEFAULT", "ALEX", "BROKEN"]);
    expect(profiles[0]).toMatchObject({ region: "ap-mumbai-1", keyFile: "~/.oci/keys/default.pem" });
    expect(parseOciConfig("")).toEqual([]);
  });

  it("matches keys by file name and explains what blocks each profile", () => {
    const result = matchOciKeys(parseOciConfig(config), [{ name: "default.pem", content: pem }, { name: "alex.pem", content: pem.replace("PRIVATE", "ENCRYPTED PRIVATE") }]);
    expect(result[0]).toMatchObject({ problem: null, privateKey: pem });
    expect(result[1].problem).toContain("passphrase");
    expect(result[2].problem).toContain("Missing fingerprint, tenancy, region");
    expect(matchOciKeys(parseOciConfig(config).slice(0, 1), [])[0].problem).toContain("default.pem");
    expect(matchOciKeys(parseOciConfig(config).slice(0, 1), [{ name: "default.pem", content: "hello" }])[0].problem).toContain("PEM");
  });

  it("uses a lone uploaded key when there is a single profile with a differently named key", () => {
    const single = parseOciConfig(config).slice(0, 1);
    expect(matchOciKeys(single, [{ name: "oci_api_key.pem", content: pem }])[0].problem).toBeNull();
    expect(matchOciKeys(parseOciConfig(config).slice(0, 2), [{ name: "oci_api_key.pem", content: pem }])[0].problem).not.toBeNull();
  });

  it("builds a protected oracle registration", () => {
    const [candidate] = matchOciKeys(parseOciConfig(config), [{ name: "default.pem", content: pem }]);
    expect(ociRegistration(candidate, "OCI one", "o@example.test")).toMatchObject({ providerId: "oracle", isProtected: true, config: { tenancyId: "ocid1.tenancy.oc1..bbbbbbbb", privateKey: pem } });
    expect(ociRegistration({ ...candidate, privateKey: null }, "x", "o@example.test").config.privateKey).toBe("");
  });
});

describe("owner email from key file names", () => {
  it("reads the email the OCI console puts in downloaded key names", () => {
    expect(guessOwnerEmail("alex@example.com_2025-02-02T04_54_45.641Z.pem")).toBe("alex@example.com");
    expect(guessOwnerEmail(undefined, "/Users/x/.oci/Sam.Lee@gmail.com_2025-03-03T12_15_47.528Z.pem")).toBe("sam.lee@gmail.com");
    expect(guessOwnerEmail("foo@bar.com.pem")).toBe("foo@bar.com");
    expect(guessOwnerEmail("personal.pem", null)).toBeNull();
  });
});

describe("bulk token import", () => {
  it("parses one account per line and flags problems", () => {
    const rows = parseBulkLines("# header\ncloudflare, Main CF, acct123, tok,with,commas\nupstash\tBox 1\ta@example.test\tkey1\nnope, x, y\n\ncloudflare, , acct, tok\nneon, N, org-1");
    expect(rows.map(r => r.problem)).toEqual([null, null, expect.stringContaining("Unknown provider"), "Missing label", "Missing apiKey"]);
    expect(rows[0].config).toEqual({ accountId: "acct123", apiToken: "tok,with,commas" });
    expect(rows[1]).toMatchObject({ providerId: "upstash", config: { apiEmail: "a@example.test", apiKey: "key1" } });
    expect(bulkLineHelp().join()).toContain("cloudflare, label, accountId, apiToken");
    expect(bulkLineHelp().join()).not.toContain("oracle");
  });
});

describe("credential expiry notices", () => {
  const now = new Date("2026-10-28T00:00:00Z");
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  it("warns inside two weeks, escalates inside three days, and reports expired, most urgent first", () => {
    const archivedNotices = expiryNotices([{ id: "x", label: "x", kind: "cloudflare", credentialExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), archived: true }], new Date());
    expect(archivedNotices).toEqual([]);
    const notices = expiryNotices([
      { id: "a", label: "Far", kind: "cloudflare", credentialExpiresAt: at(40) },
      { id: "b", label: "Soon", kind: "cloudflare", credentialExpiresAt: at(10.5) },
      { id: "c", label: "Critical", kind: "cloudflare", credentialExpiresAt: at(1.5) },
      { id: "d", label: "Gone", kind: "cloudflare", credentialExpiresAt: at(-2) },
      { id: "e", label: "None", kind: "neon", credentialExpiresAt: null },
      { id: "f", label: "Bad", kind: "neon", credentialExpiresAt: "garbage" },
      { id: "g", label: "Unset", kind: "neon" },
    ], now);
    expect(notices.map(n => [n.label, n.level])).toEqual([["Gone", "expired"], ["Critical", "critical"], ["Soon", "warning"]]);
    expect(describeNotice(notices[0])).toContain("expired");
    expect(describeNotice(notices[1])).toContain("1 day left");
    expect(describeNotice(notices[2])).toContain("10 days left");
    expect(describeNotice({ ...notices[1], daysLeft: 0 })).toContain("less than a day");
  });
});

describe("identity picker model", () => {
  const people = pickerIdentities([
    { id: "i-1", displayName: "Alex", contacts: [{ kind: "phone", value: "123", isPrimary: true }, { kind: "email", value: "Alex@example.com", isPrimary: false }] },
    { id: "i-2", displayName: "Sam", contacts: [{ kind: "email", value: "k@a.co", isPrimary: false }, { kind: "email", value: "sam@example.com", isPrimary: true }] },
    { id: "i-3", displayName: "No email" },
  ]);
  it("uses the primary email, falling back to the first", () => {
    expect(people.map(p => p.email)).toEqual(["Alex@example.com", "sam@example.com", null]);
  });
  it("preselects the matching person or proposes a new one named after the email", () => {
    expect(suggestIdentity(people, "alex@example.com")).toEqual({ mode: "existing", identityId: "i-1", email: "Alex@example.com" });
    expect(suggestIdentity(people, "k@a.co")).toEqual({ mode: "existing", identityId: "i-2", email: "k@a.co" });
    expect(suggestIdentity(people, "jamie.lee@gmail.com")).toEqual({ mode: "new", name: "Jamie Lee", email: "jamie.lee@gmail.com" });
    expect(suggestIdentity(people, null)).toBeNull();
    expect(nameFromEmail("a@b.co")).toBe("A");
    expect(nameFromEmail("@b.co")).toBe("");
  });
  it("resolves the email a choice will use", () => {
    expect(choiceEmail(people, null)).toBeNull();
    expect(choiceEmail(people, { mode: "new", name: "X", email: " x@a.co " })).toBe("x@a.co");
    expect(choiceEmail(people, { mode: "new", name: "X", email: " " })).toBeNull();
    expect(choiceEmail(people, { mode: "existing", identityId: "i-2" })).toBe("sam@example.com");
    expect(choiceEmail(people, { mode: "existing", identityId: "i-2", email: "k@a.co" })).toBe("k@a.co");
    expect(choiceEmail(people, { mode: "existing", identityId: "i-2", email: "other@a.co" })).toBe("sam@example.com");
    expect(choiceEmail(people, { mode: "existing", identityId: "gone" })).toBeNull();
  });
  it("validates a choice", () => {
    expect(choiceIsValid(null)).toBe(false);
    expect(choiceIsValid({ mode: "existing", identityId: "i-1" })).toBe(true);
    expect(choiceIsValid({ mode: "existing", identityId: "" })).toBe(false);
    expect(choiceIsValid({ mode: "new", name: "Ma", email: "m@a.co" })).toBe(true);
    expect(choiceIsValid({ mode: "new", name: "M", email: "m@a.co" })).toBe(false);
    expect(choiceIsValid({ mode: "new", name: "Alex", email: "nope" })).toBe(false);
  });
});

import { duplicateTenancies } from "../src/lib/providers/oci-config";
import { accountScope } from "../src/lib/fleet/accounts";
describe("duplicate accounts", () => {
  it("flags later profiles that share a tenancy", () => {
    expect(duplicateTenancies([{ profile: "default", tenancy: "ocid1.tenancy.A" }, { profile: "personal", tenancy: "OCID1.tenancy.a" }, { profile: "other", tenancy: "ocid1.tenancy.B" }, { profile: "blank", tenancy: "" }])).toEqual({ personal: "default" });
  });
  it("finds the non-secret scope per provider", () => {
    expect(accountScope("oracle", { tenancyId: " OCID1.A " })).toBe("ocid1.a");
    expect(accountScope("cloudflare", { accountId: "abc" })).toBe("abc");
    expect(accountScope("oracle", {})).toBeNull();
    expect(accountScope("github", { x: "y" })).toBeNull();
  });
});
