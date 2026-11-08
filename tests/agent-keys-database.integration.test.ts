import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { AgentKeyLimitReached, authenticateAgentKey, createAgentKey, createAgentKeyInput, hashAgentKey, listAgentKeys, maxActiveAgentKeys, revokeAgentKey } from "../src/lib/auth/agent-keys";
describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("agent key PostgreSQL storage", () => {
 beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
  expect((await bootstrapDatabase()).success).toBe(true);
  await queryClient`DELETE FROM agent_keys`;
 });
 afterAll(async () => { await queryClient`DELETE FROM agent_keys`; await queryClient.end(); });
 it("stores only a hash, authenticates, expires and revokes", async () => {
  const created = await createAgentKey(createAgentKeyInput.parse({ label: "Fixture", expiresInDays: 7 }), "fixture@example.test");
  const [stored] = await queryClient`SELECT * FROM agent_keys WHERE id = ${created.id}`;
  expect(stored.key_hash).toBe(hashAgentKey(created.key)); expect(JSON.stringify(stored)).not.toContain(created.key);
  expect(stored.key_hint).toBe(created.key.slice(-4)); expect(stored.last_used_at).toBeNull();
  expect(await authenticateAgentKey(created.key)).toEqual({ status: "valid", id: created.id });
  const [used] = await queryClient`SELECT last_used_at FROM agent_keys WHERE id = ${created.id}`; expect(used.last_used_at).not.toBeNull();
  await authenticateAgentKey(created.key);
  const [again] = await queryClient`SELECT last_used_at FROM agent_keys WHERE id = ${created.id}`; expect(again.last_used_at).toEqual(used.last_used_at);
  expect((await authenticateAgentKey(`fhk_${"Z".repeat(43)}`)).status).toBe("invalid");
  expect((await listAgentKeys()).find(key => key.id === created.id)).toMatchObject({ status: "active", label: "Fixture", createdBy: "fixture@example.test" });
  await queryClient`UPDATE agent_keys SET expires_at = NOW() - interval '1 second' WHERE id = ${created.id}`;
  expect(await authenticateAgentKey(created.key)).toEqual({ status: "invalid" });
  expect((await listAgentKeys()).find(key => key.id === created.id)?.status).toBe("expired");
  const second = await createAgentKey(createAgentKeyInput.parse({ label: "Second" }), "fixture");
  expect(await revokeAgentKey(second.id)).toBe(true); expect(await revokeAgentKey(second.id)).toBe(true); expect(await revokeAgentKey("agk-missing")).toBe(false);
  expect(await authenticateAgentKey(second.key)).toEqual({ status: "invalid" });
  expect((await listAgentKeys()).find(key => key.id === second.id)?.status).toBe("revoked");
 });
 it("enforces the active key cap under concurrent creation", async () => {
  await queryClient`DELETE FROM agent_keys`;
  const results = await Promise.allSettled(Array.from({ length: maxActiveAgentKeys + 5 }, (_, index) => createAgentKey(createAgentKeyInput.parse({ label: `k${index}` }), "fixture")));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(maxActiveAgentKeys);
  for (const result of results.filter(result => result.status === "rejected")) expect((result as PromiseRejectedResult).reason).toBeInstanceOf(AgentKeyLimitReached);
  expect((await listAgentKeys()).filter(key => key.status === "active")).toHaveLength(maxActiveAgentKeys);
 });
});
