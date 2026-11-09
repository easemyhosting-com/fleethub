import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";
import { getSessionFromRequest, isProxyIdentity, type SessionUser } from "./session";

export type SessionScope = "read" | "operator";
export type SessionKind = "browser" | "device";
export const browserSessionDays = 7;
export const deviceSessionDays = 30;
export const maxActiveSessions = 50;
export const maxPendingPairings = 5;
const lastSeenGranularityMs = 60 * 60 * 1000;
const pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const pairingInput = z.strictObject({
  label: z.string().trim().min(1).max(80),
  scope: z.enum(["read", "operator"]).default("read"),
  expiresInMinutes: z.number().int().min(1).max(30).default(10),
});
export const redeemInput = z.strictObject({ code: z.string().min(8).max(32), label: z.string().trim().min(1).max(80).optional() });

export type SessionSummary = { id: string; kind: SessionKind; scope: SessionScope; label: string; userEmail: string; createdAt: string; lastSeenAt: string | null; expiresAt: string; revokedAt: string | null; status: "active" | "expired" | "revoked" };
export type PairingSummary = { id: string; label: string; scope: SessionScope; createdBy: string; createdAt: string; expiresAt: string; status: "pending" | "expired" | "used" | "cancelled" };
export type SessionCheck = { status: "active"; scope: SessionScope } | { status: "inactive" } | { status: "unavailable" };
export class SessionLimitReached extends Error {}
export class PairingLimitReached extends Error {}

const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
export const hashPairingCode = (code: string) => createHash("sha256").update(normalizePairingCode(code)).digest("hex");
export const normalizePairingCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export function generatePairingCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, byte => pairingAlphabet[byte % 32]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

function summarizeSession(row: Record<string, unknown>): SessionSummary {
  const revokedAt = iso(row.revoked_at as Date | null);
  const expiresAt = iso(row.expires_at as Date)!;
  return {
    id: String(row.id), kind: row.kind as SessionKind, scope: row.scope as SessionScope, label: String(row.label), userEmail: String(row.user_email),
    createdAt: iso(row.created_at as Date)!, lastSeenAt: iso(row.last_seen_at as Date | null), expiresAt, revokedAt,
    status: revokedAt ? "revoked" : Date.parse(expiresAt) <= Date.now() ? "expired" : "active",
  };
}
function summarizePairing(row: Record<string, unknown>): PairingSummary {
  const expiresAt = iso(row.expires_at as Date)!;
  return {
    id: String(row.id), label: String(row.label), scope: row.scope as SessionScope, createdBy: String(row.created_by_email),
    createdAt: iso(row.created_at as Date)!, expiresAt,
    status: row.cancelled_at ? "cancelled" : row.consumed_at ? "used" : Date.parse(expiresAt) <= Date.now() ? "expired" : "pending",
  };
}

type Sql = typeof queryClient;
async function insertSession(sql: Sql, user: SessionUser, kind: SessionKind, scope: SessionScope, label: string, days: number): Promise<string> {
  const id = `ses-${randomUUID()}`;
  await sql`SELECT pg_advisory_xact_lock(hashtext('fleethub-sessions'))`;
  await sql`DELETE FROM auth_sessions WHERE expires_at < NOW() - interval '30 days' OR revoked_at < NOW() - interval '30 days'`;
  const [{ active }] = await sql`SELECT COUNT(*)::int AS active FROM auth_sessions WHERE user_id = ${user.id} AND revoked_at IS NULL AND expires_at > NOW()`;
  if (active >= maxActiveSessions) throw new SessionLimitReached();
  await sql`
    INSERT INTO auth_sessions (id, user_id, user_email, user_name, provider, kind, scope, label, expires_at)
    VALUES (${id}, ${user.id}, ${user.email}, ${user.name}, ${user.provider}, ${kind}, ${scope}, ${label}, NOW() + make_interval(days => ${days}))`;
  return id;
}

export async function createServerSession(user: SessionUser, kind: SessionKind, scope: SessionScope, label: string): Promise<string> {
  return queryClient.begin(transaction => insertSession(transaction as unknown as Sql, user, kind, scope, label, kind === "device" ? deviceSessionDays : browserSessionDays));
}

export async function checkSession(sid: string | undefined): Promise<SessionCheck> {
  if (!sid) return { status: "inactive" };
  try {
    const [row] = await queryClient`SELECT scope, last_seen_at FROM auth_sessions WHERE id = ${sid} AND revoked_at IS NULL AND expires_at > NOW()`;
    if (!row) return { status: "inactive" };
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeen >= lastSeenGranularityMs) await queryClient`UPDATE auth_sessions SET last_seen_at = NOW() WHERE id = ${sid} AND revoked_at IS NULL`;
    return { status: "active", scope: row.scope as SessionScope };
  } catch {
    return { status: "unavailable" };
  }
}

export type ResolvedSession = { user: SessionUser; scope: SessionScope } | { user: null; failure: "none" | "inactive" | "unavailable" };
export async function resolveSession(req: Request): Promise<ResolvedSession> {
  const user = getSessionFromRequest(req);
  if (!user) return { user: null, failure: "none" };
  if (isProxyIdentity(user)) return { user, scope: "operator" };
  const check = await checkSession(user.sid);
  if (check.status === "active") return { user, scope: check.scope };
  return { user: null, failure: check.status };
}

export async function listSessions(userId?: string): Promise<SessionSummary[]> {
  return (await queryClient`SELECT * FROM auth_sessions WHERE user_id = COALESCE(${userId ?? null}, user_id) ORDER BY created_at DESC LIMIT 200`).map(summarizeSession);
}
/** Revoking a session also cancels the pairing codes it created, in the same statement, so a stolen session cannot leave a working code behind. */
export async function revokeSession(id: string, userId?: string): Promise<boolean> {
  return (await withoutPairingLink(
    () => queryClient`
      WITH revoked AS (UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ${id} AND user_id = COALESCE(${userId ?? null}, user_id) RETURNING id),
      cancelled AS (UPDATE device_pairings SET cancelled_at = NOW() WHERE created_by_session IN (SELECT id FROM revoked) AND consumed_at IS NULL AND cancelled_at IS NULL)
      SELECT id FROM revoked`,
    () => queryClient`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ${id} AND user_id = COALESCE(${userId ?? null}, user_id) RETURNING id`)).length > 0;
}
/** Revokes the caller's other active sessions, cancelling their pending pairing codes the same way. */
export async function revokeOtherSessions(keepId: string | undefined): Promise<number> {
  if (!keepId) throw new Error("revokeOtherSessions requires the caller's session id");
  return (await withoutPairingLink(
    () => queryClient`
      WITH revoked AS (UPDATE auth_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL AND expires_at > NOW() AND id <> ${keepId}
        AND user_id = (SELECT user_id FROM auth_sessions WHERE id = ${keepId}) RETURNING id),
      cancelled AS (UPDATE device_pairings SET cancelled_at = NOW() WHERE created_by_session IN (SELECT id FROM revoked) AND consumed_at IS NULL AND cancelled_at IS NULL)
      SELECT id FROM revoked`,
    () => queryClient`UPDATE auth_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL AND expires_at > NOW() AND id <> ${keepId}
        AND user_id = (SELECT user_id FROM auth_sessions WHERE id = ${keepId}) RETURNING id`)).length;
}
/** Logout revokes without running the schema bootstrap. Before the created_by_session column exists no code can be linked to a session, so a plain revoke is complete. */
async function withoutPairingLink<T>(linked: () => Promise<T>, plain: () => Promise<T>): Promise<T> {
  try {
    return await linked();
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "42703") throw error;
    return plain();
  }
}
export async function createPairing(input: z.infer<typeof pairingInput>, creator: SessionUser): Promise<PairingSummary & { code: string }> {
  const code = generatePairingCode();
  const id = `pair-${randomUUID()}`;
  const row = await queryClient.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('fleethub-pairings'))`;
    await transaction`DELETE FROM device_pairings WHERE expires_at < NOW() - interval '1 day'`;
    const [{ pending }] = await transaction`SELECT COUNT(*)::int AS pending FROM device_pairings WHERE consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > NOW()`;
    if (pending >= maxPendingPairings) throw new PairingLimitReached();
    const [created] = await transaction`
      INSERT INTO device_pairings (id, code_hash, label, scope, created_by_id, created_by_email, created_by_name, provider, created_by_session, expires_at)
      VALUES (${id}, ${hashPairingCode(code)}, ${input.label}, ${input.scope}, ${creator.id}, ${creator.email}, ${creator.name}, ${creator.provider}, ${creator.sid ?? null}, NOW() + make_interval(mins => ${input.expiresInMinutes}))
      RETURNING *`;
    return created;
  });
  return { ...summarizePairing(row), code };
}
export async function listPairings(): Promise<PairingSummary[]> {
  return (await queryClient`SELECT * FROM device_pairings ORDER BY created_at DESC LIMIT 50`).map(summarizePairing);
}
export async function cancelPairing(id: string): Promise<boolean> {
  return (await queryClient`UPDATE device_pairings SET cancelled_at = NOW() WHERE id = ${id} AND consumed_at IS NULL AND cancelled_at IS NULL RETURNING id`).length > 0;
}

/** maxScope is the server policy at redemption time, so lowering it also downgrades codes created before the change. */
export async function redeemPairing(code: string, deviceLabel?: string, maxScope: SessionScope = "operator"): Promise<{ user: SessionUser; sid: string; scope: SessionScope; label: string } | null> {
  return queryClient.begin(async transaction => {
    const [pairing] = await transaction`
      UPDATE device_pairings SET consumed_at = NOW()
      WHERE code_hash = ${hashPairingCode(code)} AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > NOW()
        AND (created_by_session IS NULL OR EXISTS (
          SELECT 1 FROM auth_sessions creator WHERE creator.id = device_pairings.created_by_session AND creator.revoked_at IS NULL AND creator.expires_at > NOW()))
      RETURNING *`;
    if (!pairing) return null;
    const user: SessionUser = { id: pairing.created_by_id, email: pairing.created_by_email, name: pairing.created_by_name, provider: pairing.provider, createdAt: Date.now() };
    const label = deviceLabel ?? pairing.label;
    const scope: SessionScope = maxScope === "read" ? "read" : pairing.scope as SessionScope;
    const sid = await insertSession(transaction as unknown as Sql, user, "device", scope, label, deviceSessionDays);
    return { user, sid, scope, label };
  });
}

export function describeClient(req: Request): string {
  const agent = req.headers.get("user-agent") ?? "";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /iPhone|iPad/.test(agent) ? "iOS" : /Android/.test(agent) ? "Android" : /Macintosh/.test(agent) ? "macOS" : /Windows/.test(agent) ? "Windows" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}
export const publicUser = (user: SessionUser) => ({ id: user.id, email: user.email, name: user.name, provider: user.provider, createdAt: user.createdAt });
