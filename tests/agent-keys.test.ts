import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
 queryClient: Object.assign((...args: unknown[]) => db.query(...args), { begin: async (work: (tx: unknown) => unknown) => work((...args: unknown[]) => db.tx(...args)) }),
}));
import { AgentKeyLimitReached, authenticateAgentKey, createAgentKey, createAgentKeyInput, hashAgentKey, isAgentKeyFormat, listAgentKeys, maxActiveAgentKeys, revokeAgentKey } from "../src/lib/auth/agent-keys";
const sql = (call: unknown[]) => (call[0] as string[]).join("?");
const row = (extra = {}) => ({ id: "agk-1", label: "Claude", key_hint: "abcd", created_by: "op@example.test", created_at: new Date("2026-01-01"), expires_at: new Date(Date.now() + 86_400_000), revoked_at: null, last_used_at: null, ...extra });
beforeEach(() => { db.query.mockReset(); db.tx.mockReset(); });
describe("agent key service", () => {
 it("creates a prefixed random key, stores only its hash, and returns the secret once", async () => {
  db.tx.mockImplementation(async (...call: unknown[]) => sql(call).includes("COUNT") ? [{ active: 0 }] : sql(call).includes("INSERT") ? [row()] : []);
  const created = await createAgentKey(createAgentKeyInput.parse({ label: "Claude" }), "op@example.test");
  expect(isAgentKeyFormat(created.key)).toBe(true);
  const insert = db.tx.mock.calls.find(call => sql(call as unknown[]).includes("INSERT")) as unknown[];
  expect(insert.slice(1)).toContain(hashAgentKey(created.key)); expect(insert.slice(1)).not.toContain(created.key);
  expect(insert.slice(1)).toContain(created.key.slice(-4));
  expect(created).toMatchObject({ id: "agk-1", status: "active" });
  const { key: _secret, ...listed } = created; expect(JSON.stringify(listed)).not.toContain(created.key);
  const second = await createAgentKey(createAgentKeyInput.parse({ label: "Codex" }), "op");
  expect(second.key).not.toBe(created.key);
 });
 it("refuses to exceed the active key cap", async () => {
  db.tx.mockImplementation(async () => [{ active: maxActiveAgentKeys }]);
  await expect(createAgentKey(createAgentKeyInput.parse({ label: "x" }), "op")).rejects.toBeInstanceOf(AgentKeyLimitReached);
 });
 it("validates input bounds and defaults to 30 days", () => {
  expect(createAgentKeyInput.parse({ label: "  A  " })).toEqual({ label: "A", expiresInDays: 30 });
  for (const bad of [{}, { label: "" }, { label: "x".repeat(81) }, { label: "a", expiresInDays: 0 }, { label: "a", expiresInDays: 91 }, { label: "a", expiresInDays: 1.5 }, { label: "a", extra: 1 }]) expect(createAgentKeyInput.safeParse(bad).success).toBe(false);
 });
 it("lists metadata with derived status and never a secret or hash", async () => {
  db.query.mockResolvedValue([row(), row({ id: "agk-2", revoked_at: new Date() }), row({ id: "agk-3", expires_at: new Date(Date.now() - 1000), last_used_at: new Date() })]);
  const keys = await listAgentKeys();
  expect(keys.map(key => key.status)).toEqual(["active", "revoked", "expired"]);
  expect(keys[2].lastUsedAt).not.toBeNull(); expect(JSON.stringify(keys)).not.toMatch(/key_hash|fhk_/);
 });
 it("revokes idempotently and reports unknown ids", async () => {
  db.query.mockResolvedValueOnce([{ id: "agk-1" }]).mockResolvedValueOnce([]);
  expect(await revokeAgentKey("agk-1")).toBe(true); expect(await revokeAgentKey("agk-none")).toBe(false);
 });
 it("authenticates by hash, rejects malformed tokens without querying, and fails closed on storage errors", async () => {
  const token = `fhk_${"A".repeat(43)}`;
  expect(await authenticateAgentKey("static-key")).toEqual({ status: "invalid" }); expect(await authenticateAgentKey(`fhk_${"A".repeat(42)}`)).toEqual({ status: "invalid" });
  expect(db.query).not.toHaveBeenCalled();
  db.query.mockResolvedValueOnce([]); expect(await authenticateAgentKey(token)).toEqual({ status: "invalid" });
  expect(db.query.mock.calls[0].slice(1)).toEqual([hashAgentKey(token)]);
  db.query.mockReset(); db.query.mockRejectedValue(new Error("private-diagnostic")); expect(await authenticateAgentKey(token)).toEqual({ status: "unavailable" });
 });
 it("touches last use at most hourly", async () => {
  const token = `fhk_${"B".repeat(43)}`;
  db.query.mockResolvedValueOnce([{ id: "agk-1", last_used_at: new Date() }]);
  expect(await authenticateAgentKey(token)).toEqual({ status: "valid", id: "agk-1" }); expect(db.query).toHaveBeenCalledTimes(1);
  db.query.mockReset().mockResolvedValueOnce([{ id: "agk-1", last_used_at: new Date(Date.now() - 2 * 3600_000) }]).mockResolvedValueOnce([]);
  await authenticateAgentKey(token); expect(db.query).toHaveBeenCalledTimes(2); expect(sql(db.query.mock.calls[1])).toContain("UPDATE");
  db.query.mockReset().mockResolvedValueOnce([{ id: "agk-1", last_used_at: null }]).mockResolvedValueOnce([]);
  await authenticateAgentKey(token); expect(db.query).toHaveBeenCalledTimes(2);
 });
});
