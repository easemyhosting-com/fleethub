import { createElement } from "react";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { FleetOverviewHub } from "../src/components/FleetOverviewHub";
import type { FleetSnapshot } from "../src/lib/inventory/model";

const snapshot: FleetSnapshot = {
  status: "online", timestamp: "2026-10-26T00:00:00.000Z", gateways: [], worker: { status: "offline", lastSeenAt: null },
  accounts: [{ id: "pending-account", kind: "oci", label: "OCI manual", ownerEmail: "owner@example.com", loginEmail: null, health: "unknown", enabled: false, credentialExpiresAt: null, isProtected: true, collection: { state: "unsupported", lastAttemptAt: null, lastSuccessAt: null, freshUntil: null, nextAttemptAt: null, errorCode: null, message: "Use manual inventory.", resourceCount: 0 } }],
  resources: [],
};

it("shows an unsupported account without claiming active resources", () => {
  const renderer: unknown = createRequire(import.meta.url)("react-dom/server");
  if (typeof renderer !== "object" || renderer === null || !("renderToStaticMarkup" in renderer) || typeof renderer.renderToStaticMarkup !== "function") throw new Error("React server renderer unavailable");
  const html: unknown = renderer.renderToStaticMarkup(createElement(FleetOverviewHub, { snapshot, onRefresh: async () => {}, isRefreshing: false, onOpenOnboarding: () => {}, onOpenAuth: () => {}, onSelectResource: () => {} }));
  if (typeof html !== "string") throw new Error("Expected rendered HTML");
  expect(html).toContain("OCI manual");
  expect(html).toContain("unsupported");
  expect(html).toContain("Worker offline");
  expect(html).toContain("Registered accounts do not imply active resources");
  expect(html).not.toContain("Collect inventory");
  expect(html).not.toContain("Infisical Synced");
});

it("offers collection retry for a supported account after a failed first scan", () => {
  const renderer: unknown = createRequire(import.meta.url)("react-dom/server");
  if (typeof renderer !== "object" || renderer === null || !("renderToStaticMarkup" in renderer) || typeof renderer.renderToStaticMarkup !== "function") throw new Error("React server renderer unavailable");
  const retrySnapshot: FleetSnapshot = {
    ...snapshot,
    accounts: [{ ...snapshot.accounts[0], kind: "cloudflare", enabled: false, collection: { ...snapshot.accounts[0].collection, state: "error", errorCode: "unauthorized", message: "Credentials rejected." } }],
  };
  const html: unknown = renderer.renderToStaticMarkup(createElement(FleetOverviewHub, { snapshot: retrySnapshot, onRefresh: async () => {}, isRefreshing: false, onOpenOnboarding: () => {}, onOpenAuth: () => {}, onSelectResource: () => {} }));
  if (typeof html !== "string") throw new Error("Expected rendered HTML");
  expect(html).toContain("Collect inventory");
  expect(html).toContain("Credentials rejected.");
});

it("retains prior data after a failed read without keeping freshness or worker claims", async () => {
  const { retainSnapshotAfterReadFailure } = await import("../src/lib/inventory/model");
  const current: FleetSnapshot = { ...snapshot, worker: { status: "online", lastSeenAt: snapshot.timestamp },
    accounts: [{ ...snapshot.accounts[0], collection: { ...snapshot.accounts[0].collection, state: "ready" } }],
    resources: [{ id:"r1", accountId:"pending-account", accountEmail:"owner@example.com", provider:"cloudflare", name:"Domain", category:"network", state:"online", isProtected:true, tags:[], attributes:{}, specs:{}, profile:{ set:false, role:"general", lifecycle:"always_on", backupClass:"none", criticality:"normal", autoStop:"off", labels:{}, notes:null }, lastSeenAt:snapshot.timestamp, nativeId:"native", region:null, sourceUrl:null, inventorySource:"provider", presence:"present", freshness:"current" }],
  };
  const retained = retainSnapshotAfterReadFailure(current);
  expect(retained.resources[0]).toMatchObject({ id:"r1", freshness:"stale" });
  expect(retained.accounts[0].collection.state).toBe("stale");
  expect(retained.worker.status).toBe("unknown");
  expect(retained.timestamp).toBe(current.timestamp);
  expect(current.resources[0].freshness).toBe("current");
});
