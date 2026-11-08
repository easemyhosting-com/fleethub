import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRegistrationProfile, defaultRegistrationProfile, hasProfileChoices } from "../src/lib/providers/client";
import { backupClasses, lifecycles, profileInputSchema, roles } from "../src/lib/fleet/vocabulary";

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe("registration profile", () => {
  it("defaults to general / always_on / none and every default is in the vocabulary", () => {
    expect(defaultRegistrationProfile).toEqual({ role: "general", lifecycle: "always_on", backupClass: "none" });
    expect(roles).toContain(defaultRegistrationProfile.role);
    expect(lifecycles).toContain(defaultRegistrationProfile.lifecycle);
    expect(backupClasses).toContain(defaultRegistrationProfile.backupClass);
    expect(hasProfileChoices(defaultRegistrationProfile)).toBe(false);
    expect(hasProfileChoices({ ...defaultRegistrationProfile, role: "agent_host" })).toBe(true);
    expect(hasProfileChoices({ ...defaultRegistrationProfile, lifecycle: "on_demand" })).toBe(true);
    expect(hasProfileChoices({ ...defaultRegistrationProfile, backupClass: "needs_backup" })).toBe(true);
  });

  it("makes no request when nothing was changed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await applyRegistrationProfile("acc-1", defaultRegistrationProfile)).toEqual({ applied: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels only this account's resources and never sends autoStop", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.startsWith("/api/fleet")
      ? json({ resources: [{ id: "r1", accountId: "acc-1" }, { id: "r2" }, { id: "x", accountId: "other" }, { id: 7, accountId: "acc-1" }] })
      : json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const profile = { role: "database_primary" as const, lifecycle: "always_on" as const, backupClass: "needs_backup" as const };
    expect(await applyRegistrationProfile("acc-1", profile)).toEqual({ applied: 2, failed: 0 });
    const posts = fetchMock.mock.calls.filter(call => call[0] === "/api/resources/profile").map(call => JSON.parse((call[1] as RequestInit).body as string));
    expect(posts.map(post => post.resourceId)).toEqual(["r1", "r2"]);
    for (const post of posts) {
      expect(post.profile).toEqual(profile);
      expect(profileInputSchema.safeParse(post.profile).success).toBe(true);
      expect(post.profile).not.toHaveProperty("autoStop");
    }
  });

  it("counts rejected and failed writes", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/fleet")) return json({ resources: [{ id: "a" }, { id: "b" }, { id: "c" }] });
      call++;
      if (call === 1) return json({}, false);
      if (call === 2) throw new Error("offline");
      return json({});
    }));
    expect(await applyRegistrationProfile("acc-1", { ...defaultRegistrationProfile, role: "ci_runner" })).toEqual({ applied: 1, failed: 2 });
  });

  it("does nothing when the snapshot is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, false)));
    expect(await applyRegistrationProfile("acc-1", { ...defaultRegistrationProfile, role: "unused" })).toEqual({ applied: 0, failed: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await applyRegistrationProfile("acc-1", { ...defaultRegistrationProfile, role: "unused" })).toEqual({ applied: 0, failed: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => json({ resources: undefined })));
    expect(await applyRegistrationProfile("acc-1", { ...defaultRegistrationProfile, role: "unused" })).toEqual({ applied: 0, failed: 0 });
  });
});
