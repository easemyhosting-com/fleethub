import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";

export const agentKeyPrefix = "fhk_";
export const maxActiveAgentKeys = 25;
const lastUsedGranularityMs = 60 * 60 * 1000;
const keyShape = /^fhk_[A-Za-z0-9_-]{43}$/;

export const createAgentKeyInput = z.strictObject({
  label: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(90).default(30),
});

export type AgentKeyStatus = "active" | "expired" | "revoked";
export type AgentKeySummary = { id: string; label: string; hint: string; createdBy: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; status: AgentKeyStatus };
export type AgentKeyAuthentication = { status: "valid"; id: string } | { status: "invalid" } | { status: "unavailable" };
export class AgentKeyLimitReached extends Error {}

export const isAgentKeyFormat = (token: string) => keyShape.test(token);
export const hashAgentKey = (key: string) => createHash("sha256").update(key).digest("hex");
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();

function summarize(row: Record<string, unknown>): AgentKeySummary {
  const revokedAt = iso(row.revoked_at as Date | null);
  const expiresAt = iso(row.expires_at as Date)!;
  return {
    id: String(row.id), label: String(row.label), hint: String(row.key_hint), createdBy: String(row.created_by),
    createdAt: iso(row.created_at as Date)!, expiresAt, revokedAt, lastUsedAt: iso(row.last_used_at as Date | null),
    status: revokedAt ? "revoked" : Date.parse(expiresAt) <= Date.now() ? "expired" : "active",
  };
}

export async function createAgentKey(input: z.infer<typeof createAgentKeyInput>, createdBy: string): Promise<AgentKeySummary & { key: string }> {
  const key = `${agentKeyPrefix}${randomBytes(32).toString("base64url")}`;
  const id = `agk-${randomUUID()}`;
  const row = await queryClient.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('fleethub-agent-keys'))`;
    const [{ active }] = await transaction`SELECT COUNT(*)::int AS active FROM agent_keys WHERE revoked_at IS NULL AND expires_at > NOW()`;
    if (active >= maxActiveAgentKeys) throw new AgentKeyLimitReached();
    const [created] = await transaction`
      INSERT INTO agent_keys (id, label, key_hash, key_hint, created_by, expires_at)
      VALUES (${id}, ${input.label}, ${hashAgentKey(key)}, ${key.slice(-4)}, ${createdBy}, NOW() + make_interval(days => ${input.expiresInDays}))
      RETURNING *`;
    return created;
  });
  return { ...summarize(row), key };
}

export async function listAgentKeys(): Promise<AgentKeySummary[]> {
  const rows = await queryClient`SELECT * FROM agent_keys ORDER BY created_at DESC LIMIT 200`;
  return rows.map(summarize);
}

export async function revokeAgentKey(id: string): Promise<boolean> {
  const rows = await queryClient`UPDATE agent_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function authenticateAgentKey(token: string): Promise<AgentKeyAuthentication> {
  if (!isAgentKeyFormat(token)) return { status: "invalid" };
  try {
    const [row] = await queryClient`
      SELECT id, last_used_at FROM agent_keys
      WHERE key_hash = ${hashAgentKey(token)} AND revoked_at IS NULL AND expires_at > NOW()`;
    if (!row) return { status: "invalid" };
    const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - lastUsed >= lastUsedGranularityMs) {
      await queryClient`UPDATE agent_keys SET last_used_at = NOW() WHERE id = ${row.id} AND revoked_at IS NULL`;
    }
    return { status: "valid", id: String(row.id) };
  } catch {
    return { status: "unavailable" };
  }
}
