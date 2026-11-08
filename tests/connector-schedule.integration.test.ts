import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { scanConnector } from "../src/lib/connectors/service";
import { runDueConnectorScans } from "../src/lib/connectors/schedule";
import { applyProposal } from "../src/lib/gitops/register";
import { normalizeDocker } from "../src/lib/connectors/docker";

vi.mock("@/lib/connectors/service", () => ({ scanConnector: vi.fn().mockResolvedValue({}) }));
// Uses the real shared client, including Drizzle's timestamp serializers.
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("connector scheduling on PostgreSQL", () => {
  let safe = false;
  const id = "integration-scheduled-connector";
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local fleethub_security database");
    safe = true;
    if (!(await bootstrapDatabase()).success) throw new Error("Bootstrap failed");
    await queryClient`DELETE FROM connectors`;
  });
  afterAll(async () => {
    if (safe) {
      await queryClient`DELETE FROM connectors WHERE id = ${id}`;
      await queryClient`DELETE FROM projects WHERE slug = 'integration-refresh'`;
    }
    await queryClient.end();
  });
  it("claims a previously scanned connector and clears its pending request with real timestamp serialization", async () => {
    await queryClient`INSERT INTO connectors (id, kind, label, host_name, created_by, last_scan_at, scan_interval_minutes, scan_requested_at)
      VALUES (${id}, 'prometheus', 'Test', 'test', 'test', NOW() - INTERVAL '1 hour', 15, NOW())`;
    expect(await runDueConnectorScans()).toBe(true);
    const [row] = await queryClient`SELECT last_scan_at > NOW() - INTERVAL '1 minute' AS claimed, scan_requested_at FROM connectors WHERE id = ${id}`;
    expect(row.claimed).toBe(true);
    expect(row.scan_requested_at).toBeNull();
    expect(await runDueConnectorScans()).toBe(false);
  });
  it("excludes an active claim and preserves a request received during its scan", async () => {
    await queryClient`UPDATE connectors SET scan_requested_at = NOW() WHERE id = ${id}`;
    vi.mocked(scanConnector).mockImplementationOnce(async () => {
      expect(await runDueConnectorScans()).toBe(false);
      await queryClient`UPDATE connectors SET scan_requested_at = NOW() + INTERVAL '1 second' WHERE id = ${id}`;
      return { kind: "prometheus" };
    });
    expect(await runDueConnectorScans()).toBe(true);
    const [row] = await queryClient`SELECT scan_requested_at IS NOT NULL AS pending, scan_lease_until FROM connectors WHERE id = ${id}`;
    expect(row.pending).toBe(true);
    expect(row.scan_lease_until).toBeNull();
  });
  it("refreshes a registered project without staling another host or reviving an archived project", async () => {
    const proposal = normalizeDocker("test-a", { containers: [{ Names: ["/integration-refresh"], State: "running", Image: "fixture:latest" }] });
    await applyProposal(proposal, ["integration-refresh"], "fixture");
    const [project] = await queryClient`SELECT id FROM projects WHERE slug = 'integration-refresh'`;
    await queryClient`INSERT INTO project_placements (id, project_id, host_name, runtime, source, evidence) VALUES ('integration-other-host', ${project.id}, 'test-b', 'docker', 'docker', 'test')`;
    await applyProposal(proposal, ["integration-refresh"], "fixture", undefined, { refreshOnly: true });
    const [other] = await queryClient`SELECT status FROM project_placements WHERE id = 'integration-other-host'`;
    expect(other.status).toBe("placed");
    await queryClient`UPDATE projects SET archived_at = NOW() WHERE id = ${project.id}`;
    const result = await applyProposal(proposal, ["integration-refresh"], "fixture", undefined, { refreshOnly: true });
    expect(result.updated).toBe(0);
    const [archived] = await queryClient`SELECT archived_at IS NOT NULL AS archived FROM projects WHERE id = ${project.id}`;
    expect(archived.archived).toBe(true);
    await queryClient`DELETE FROM projects WHERE id = ${project.id}`;
    expect((await applyProposal(proposal, ["integration-refresh"], "fixture", undefined, { refreshOnly: true })).created).toBe(0);
  });
});
