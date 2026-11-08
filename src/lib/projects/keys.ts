import { createHash, randomBytes, randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";

export const projectKeyPrefix = "fhp_";
export const maxActiveProjectKeys = 100;
const keyShape = /^fhp_[A-Za-z0-9_-]{43}$/;
const lastUsedGranularityMs = 60 * 60 * 1000;
export const isProjectKeyFormat = (token: string) => keyShape.test(token);
export const hashProjectKey = (key: string) => createHash("sha256").update(key).digest("hex");
export class ProjectKeyLimitReached extends Error {}
export class UnknownProject extends Error {}
export type ProjectKeyAuthentication = { status: "valid"; projectId: string; keyId: string } | { status: "invalid" } | { status: "unavailable" };

/** Only the hash is stored; the key is shown once. A key can post needs and usage for its own project and nothing else. */
export async function createProjectKey(projectId: string, expiresInDays: number, createdBy: string) {
  const key = `${projectKeyPrefix}${randomBytes(32).toString("base64url")}`;
  const id = `pkey-${randomUUID()}`;
  const row = await queryClient.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('fleethub-project-keys'))`;
    const [project] = await transaction`SELECT id FROM projects WHERE id = ${projectId} AND archived_at IS NULL`;
    if (!project) throw new UnknownProject();
    const [{ active }] = await transaction`SELECT COUNT(*)::int AS active FROM project_keys WHERE revoked_at IS NULL AND expires_at > NOW()`;
    if (active >= maxActiveProjectKeys) throw new ProjectKeyLimitReached();
    const [created] = await transaction`
      INSERT INTO project_keys (id, project_id, key_hash, key_hint, created_by, expires_at)
      VALUES (${id}, ${projectId}, ${hashProjectKey(key)}, ${key.slice(-4)}, ${createdBy}, NOW() + make_interval(days => ${expiresInDays}))
      RETURNING id, expires_at`;
    return created;
  });
  return { id: String(row.id), key, hint: key.slice(-4), expiresAt: new Date(row.expires_at).toISOString() };
}

export async function revokeProjectKey(id: string): Promise<boolean> {
  const rows = await queryClient`UPDATE project_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function authenticateProjectKey(token: string): Promise<ProjectKeyAuthentication> {
  if (!isProjectKeyFormat(token)) return { status: "invalid" };
  try {
    const [row] = await queryClient`
      SELECT k.id, k.project_id, k.last_used_at FROM project_keys k JOIN projects p ON p.id = k.project_id
      WHERE k.key_hash = ${hashProjectKey(token)} AND k.revoked_at IS NULL AND k.expires_at > NOW() AND p.archived_at IS NULL`;
    if (!row) return { status: "invalid" };
    const last = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - last >= lastUsedGranularityMs) await queryClient`UPDATE project_keys SET last_used_at = NOW() WHERE id = ${row.id} AND revoked_at IS NULL`;
    return { status: "valid", projectId: String(row.project_id), keyId: String(row.id) };
  } catch { return { status: "unavailable" }; }
}
