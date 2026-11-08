import { queryClient } from "@/lib/db/client";
import { scanConnector } from "./service";
import { createHash, randomBytes } from "node:crypto";
import { nextDue, scanIntervalChoices } from "./schedule-rules";

export const rescanKeyPrefix = "fhr_";
const rescanKeyShape = /^fhr_[A-Za-z0-9_-]{43}$/;
export const isRescanKeyFormat = (token: string) => rescanKeyShape.test(token);
export const hashRescanKey = (key: string) => createHash("sha256").update(key).digest("hex");
export const newRescanKey = () => `${rescanKeyPrefix}${randomBytes(32).toString("base64url")}`;

/**
 * One due connector per call, so the worker loop stays responsive. Prometheus records measured usage; Kubernetes and Docker refresh
 * only projects that are already registered (new ones are listed for review, never registered automatically). Returns true when a scan ran.
 */
export async function runDueConnectorScans(now = new Date()): Promise<boolean> {
  const rows = await queryClient`SELECT id, kind, scan_interval_minutes, last_scan_at, scan_requested_at FROM connectors WHERE scan_lease_until IS NULL OR scan_lease_until < NOW()`;
  const due = nextDue(rows.map(row => ({ id: String(row.id), kind: String(row.kind), scanIntervalMinutes: row.scan_interval_minutes as number | null, lastScanAt: row.last_scan_at ? new Date(row.last_scan_at) : null, scanRequestedAt: row.scan_requested_at ? new Date(row.scan_requested_at) : null })), now);
  if (!due) return false;
  const claimed = await queryClient`UPDATE connectors SET last_scan_at = NOW(), scan_lease_until = NOW() + INTERVAL '10 minutes' WHERE id = ${due.id} AND (scan_lease_until IS NULL OR scan_lease_until < NOW()) AND date_trunc('milliseconds', last_scan_at) IS NOT DISTINCT FROM ${due.lastScanAt?.toISOString() ?? null}::timestamptz RETURNING NOW() AS claimed_at`;
  if (!claimed.length) return true;
  try {
    await scanConnector(due.id, due.kind === "prometheus" ? { apply: true, select: [] } : { apply: false, select: [], refreshRegistered: true });
  } catch (error) {
    // Class and code only: messages can carry target responses. The connector row keeps the status.
    const code = error && typeof error === "object" && "code" in error ? ` ${String((error as { code: unknown }).code)}` : "";
    console.error(`Scheduled connector scan failed (${error instanceof Error ? error.name : typeof error}${code}); its status is recorded on the connector`);
  } finally {
    // A request that arrived while this scan ran stays set, so it gets its own scan.
    await queryClient`UPDATE connectors SET scan_lease_until = NULL, scan_requested_at = CASE WHEN scan_requested_at <= ${new Date(claimed[0].claimed_at).toISOString()}::timestamptz THEN NULL ELSE scan_requested_at END WHERE id = ${due.id}`;
  }
  return true;
}

export class UnknownConnectorId extends Error {}
export async function setScanInterval(id: string, minutes: (typeof scanIntervalChoices)[number] | null): Promise<void> {
  const rows = await queryClient`UPDATE connectors SET scan_interval_minutes = ${minutes} WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new UnknownConnectorId();
}

/** Replaces the connector's rescan key. Only the hash is stored; the key is returned once. */
export async function rotateRescanKey(id: string): Promise<string> {
  const key = newRescanKey();
  const rows = await queryClient`UPDATE connectors SET rescan_key_hash = ${hashRescanKey(key)} WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new UnknownConnectorId();
  return key;
}

export async function revokeRescanKey(id: string): Promise<void> {
  const rows = await queryClient`UPDATE connectors SET rescan_key_hash = NULL WHERE id = ${id} RETURNING id`;
  if (!rows.length) throw new UnknownConnectorId();
}

/** Read-only authentication keeps unknown keys out of per-connector rate-limit buckets. */
export async function lookupRescanKey(key: string): Promise<{ id: string; label: string } | null> {
  if (!isRescanKeyFormat(key)) return null;
  const [row] = await queryClient`SELECT id, label FROM connectors WHERE rescan_key_hash = ${hashRescanKey(key)}`;
  return row ? { id: String(row.id), label: String(row.label) } : null;
}

/** The webhook can only ask for a rescan of its own connector; repeated calls coalesce into one scan. */
export async function requestRescan(key: string): Promise<{ id: string; label: string } | null> {
  if (!isRescanKeyFormat(key)) return null;
  const [row] = await queryClient`UPDATE connectors SET scan_requested_at = NOW() WHERE rescan_key_hash = ${hashRescanKey(key)} RETURNING id, label`;
  return row ? { id: String(row.id), label: String(row.label) } : null;
}
