import { describe, expect, it } from "vitest";
import { resourceId } from "../src/lib/inventory/service";
import { completeInventorySchema, manualResourceInput } from "../src/lib/inventory/model";

describe("inventory identity and input boundaries", () => {
  it("separates resource keys by account and provider scope", () => {
    const first = resourceId("cloudflare", "account-a", "account-scope", "zone-1");
    expect(first).toBe(resourceId("cloudflare", "account-a", "account-scope", "zone-1"));
    expect(first).not.toBe(resourceId("cloudflare", "account-b", "account-scope", "zone-1"));
    expect(first).not.toBe(resourceId("cloudflare", "account-a", "other-scope", "zone-1"));
    expect(first).not.toContain("zone-1");
  });

  it("rejects incomplete provider listings and manual credential fields", () => {
    expect(completeInventorySchema.safeParse({ scope: "account", resources: [{ nativeId: "a", name: "A" }] }).success).toBe(false);
    expect(manualResourceInput.safeParse({ accountId: "account-a", nativeId: "a", name: "A", category: "compute", apiToken: "secret" }).success).toBe(false);
  });
});
