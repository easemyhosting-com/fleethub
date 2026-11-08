import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";
const connectivity = z.enum(["reachable", "unreachable", "unknown"]);
const metrics = z.strictObject({ cpuPercent: z.number().min(0).max(100).optional(), memoryUsedBytes: z.number().int().nonnegative().safe().optional(), diskUsedBytes: z.number().int().nonnegative().safe().optional() }).refine(value => Object.keys(value).length > 0);
const links = z.strictObject({ ssh: connectivity.optional(), tailscale: connectivity.optional(), https: connectivity.optional() }).refine(value => Object.keys(value).length > 0);
export const observationInput = z.strictObject({
  resourceId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/),
  source: z.enum(["ssh_inspection", "provider_api", "manual", "external_agent"]),
  observedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  facts: z.strictObject({
    resourceState: z.enum(["online", "offline", "unknown"]).optional(),
    connectivity: links.optional(), metrics: metrics.optional(),
    services: z.array(z.strictObject({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/), state: z.enum(["healthy", "unhealthy", "unknown"]) })).min(1).max(32).optional(),
  }).refine(value => Object.keys(value).length > 0),
});
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
export type ObservationInput = z.infer<typeof observationInput>;
export class ReportConflict extends Error {}
export class UnknownResource extends Error {}
export function validObservationTime(input: ObservationInput, now = Date.now()): boolean {
  const observed = Date.parse(input.observedAt), expiry = Date.parse(input.expiresAt);
  return observed <= now + 60000 && observed >= now - 86400000 && expiry > now && expiry > observed && expiry <= observed + 86400000;
}
export async function recordObservation(input: ObservationInput, reporterId: string, key: string) {
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const id = `obs-${randomUUID()}`;
  const inserted = await queryClient`
    INSERT INTO external_observations (id, resource_id, reporter_id, idempotency_key, payload_hash, source, observed_at, expires_at, facts)
    SELECT ${id}, id, ${reporterId}, ${key}, ${hash}, ${input.source}, ${input.observedAt}, ${input.expiresAt}, ${JSON.stringify(input.facts)}
    FROM resources WHERE id = ${input.resourceId}
    ON CONFLICT (reporter_id, idempotency_key) DO NOTHING RETURNING id
  `;
  if (inserted.length) return { id, duplicate: false };
  const [existing] = await queryClient`SELECT id, payload_hash AS "payloadHash" FROM external_observations WHERE reporter_id = ${reporterId} AND idempotency_key = ${key}`;
  if (existing) {
    if (existing.payloadHash !== hash) throw new ReportConflict();
    return { id: String(existing.id), duplicate: true };
  }
  throw new UnknownResource();
}
export async function listObservations(resourceId?: string) {
  const rows = resourceId
    ? await queryClient`SELECT id, resource_id AS "resourceId", reporter_id AS "reporterId", source, observed_at AS "observedAt", expires_at AS "expiresAt", received_at AS "receivedAt", facts FROM external_observations WHERE resource_id = ${resourceId} ORDER BY received_at DESC LIMIT 100`
    : await queryClient`SELECT id, resource_id AS "resourceId", reporter_id AS "reporterId", source, observed_at AS "observedAt", expires_at AS "expiresAt", received_at AS "receivedAt", facts FROM external_observations ORDER BY received_at DESC LIMIT 100`;
  return rows.map(row => ({
    id: row.id, resourceId: row.resourceId, reporterId: row.reporterId, source: row.source,
    observedAt: row.observedAt, expiresAt: row.expiresAt, receivedAt: row.receivedAt,
    facts: observationInput.shape.facts.parse(row.facts),
    freshness: new Date(row.expiresAt).getTime() > Date.now() ? "current" : "expired",
    trust: "external_report_unverified", authoritative: false,
  }));
}
