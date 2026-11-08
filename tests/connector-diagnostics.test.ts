import { describe, expect, it } from "vitest";
import { accountDiagnostics, connectorDiagnostics, diagnosticsSchema } from "../src/lib/connectors/diagnostics";
import { collectionErrorCodes, collectionSchema } from "../src/lib/inventory/model";
const at = "2026-01-01T00:00:00.000Z";
const collection = collectionSchema.parse({ state: "ready", lastAttemptAt: at, lastSuccessAt: at, freshUntil: at, nextAttemptAt: null, errorCode: null, message: "Bearer private-token https://private.example.test/", resourceCount: 2 });

describe("bounded diagnostic projection", () => {
  it("provides fixed repair guidance for every collection error without echoing raw messages", () => {
    for (const errorCode of collectionErrorCodes) {
      const result = accountDiagnostics({ ...collection, errorCode });
      expect(diagnosticsSchema.parse(result)).toHaveLength(1);
      expect(result[0].observedAt).toBe(at);
      expect(result[0].repair.length).toBeGreaterThan(30);
      expect(JSON.stringify(result)).not.toMatch(/private-token|private.example.test/);
    }
  });
  it("provides state recovery without confusing missing credentials and stale inventory", () => {
    expect(accountDiagnostics(collection)).toEqual([]);
    for (const state of ["needs_credentials", "unsupported", "stale", "error"] as const) expect(accountDiagnostics({ ...collection, state })).toHaveLength(1);
    expect(accountDiagnostics({ ...collection, state: "stale" })[0].code).toBe("stale");
    expect(accountDiagnostics({ ...collection, state: "needs_credentials" })[0].code).toBe("credentials");
  });
  it("bounds connector output and never reflects unknown error text or invalid timestamps", () => {
    for (const status of ["unauthorized", "forbidden", "invalid_url", "not_found", "unavailable", "too_large", "invalid_response", "Bearer private-token"]) {
      const result = connectorDiagnostics(status, "private timestamp");
      expect(diagnosticsSchema.parse(result)).toHaveLength(1);
      expect(result[0].observedAt).toBeNull();
      expect(JSON.stringify(result)).not.toContain("private");
    }
    expect(connectorDiagnostics(null, at)).toEqual([]);
    expect(connectorDiagnostics("ok", at)).toEqual([]);
    expect(connectorDiagnostics("unavailable", at)[0]).toMatchObject({ observedAt: at, source: "connector_scan" });
  });
});
