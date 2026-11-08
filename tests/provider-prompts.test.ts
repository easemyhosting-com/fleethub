import { describe, expect, it } from "vitest";
import { buildFetchPrompt, fetchPromptProviders } from "@/lib/providers/prompts";

const facts = { accountLabel: "Personal account", scopeId: "scope-123", region: "us-east-1", knownKinds: ["project"] };

describe("provider fetch prompts", () => {
  it("builds a prompt for every configured provider", () => {
    for (const provider of fetchPromptProviders) {
      expect(buildFetchPrompt(provider, facts)).toContain(`# Fetch inventory for ${provider}`);
    }
  });

  it("contains no credential-looking values and ends with parseable JSON", () => {
    for (const provider of fetchPromptProviders) {
      const prompt = buildFetchPrompt(provider, facts);
      expect(prompt).not.toMatch(/[A-Za-z0-9+/]{80,}={0,2}/);
      expect(prompt).not.toContain("BEGIN");
      expect(prompt).not.toMatch(/token=\S+/i);
      const json = prompt.slice(prompt.lastIndexOf("\n") + 1);
      expect(JSON.parse(json)).toEqual({
        provider,
        account: facts.accountLabel,
        collectedAt: "2026-01-01T00:00:00.000Z",
        resources: [{ kind: "resource_kind", name: "resource name", state: "state", specs: {}, usage: {} }],
        limits: [{ name: "limit name", limit: 0, unit: "unit", used: 0 }],
        notes: [],
      });
    }
  });

  it("uses a generic prompt for an unknown provider", () => {
    const prompt = buildFetchPrompt("custom-provider", facts);
    expect(prompt).toContain("all resources and services visible to your authenticated account");
    expect(prompt).toContain('"provider":"custom-provider"');
  });
});
