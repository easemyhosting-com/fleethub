import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginRegistry } from "../src/lib/plugins/registry";
import "../src/lib/plugins/defaults";

const syntheticProviderIds = [
  "cloudflare", "upstash", "github", "turso", "neon", "gdrive", "modal",
  "freellmapi", "infisical", "cliproxyapi", "tailscale",
];

describe("telemetry provenance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns unavailable rather than fabricated live telemetry outside explicit mock mode", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    for (const id of syntheticProviderIds) {
      const plugin = pluginRegistry.get(id);
      expect(plugin, id).toBeDefined();
      if (!plugin) throw new Error(`Missing test plugin ${id}`);
      const result = await plugin.collect({
        providerId: id,
        accountId: `acc-${id}`,
        accountEmail: "operator@example.com",
        credentials: { apiToken: "sentinel-secret", endpointUrl: "https://example.com/?token=sentinel-secret" },
      });
      expect(result.resources, id).toEqual([]);
      expect(result.samples, id).toEqual([]);
      expect(result.health.ok, id).toBe(false);
      expect(result.health.error, id).toContain("not implemented");
      expect(JSON.stringify(result), id).not.toContain("sentinel-secret");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("only emits deterministic fixture telemetry when isMock is explicitly true", async () => {
    const cloudflare = pluginRegistry.get("cloudflare");
    const result = await cloudflare?.collect({
      accountId: "fixture", accountEmail: "operator@example.com", credentials: {}, isMock: true,
    });
    expect(result?.resources.length).toBeGreaterThan(0);
    expect(result?.samples.length).toBeGreaterThan(0);
  });

  it("derives the CLI management page from the endpoint URL in mock fixtures", async () => {
    const cliproxy = pluginRegistry.get("cliproxyapi");
    const result = await cliproxy?.collect({
      accountId: "fixture", accountEmail: "operator@example.com", isMock: true,
      credentials: { endpointUrl: "https://user:secret@gateway.example:8317/v1?token=secret" },
    });
    expect(result?.resources[0].attributes.managementUrl).toBe("https://gateway.example:8317/management.html");
  });
});
