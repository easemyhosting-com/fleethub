import { queryClient } from "@/lib/db/client";
import { profileInputSchema, type ProfileInput } from "./vocabulary";

export class ProfileError extends Error {
  constructor(readonly code: "not_found" | "protected_auto_stop") {
    super(code === "not_found" ? "Resource not found" : "Protected resources can never be set to approve or auto stop");
  }
}

/** Saves the owner's labels for a resource. Profiles survive rescans because provider resource IDs are stable. */
export async function setProfile(resourceId: string, input: ProfileInput, actor: string): Promise<void> {
  const parsed = profileInputSchema.parse(input);
  const row = (await queryClient`
    SELECT r.is_protected, r.provider, a.is_protected AS account_protected, a.kind AS account_kind
    FROM resources r LEFT JOIN provider_accounts a ON a.id = r.account_id WHERE r.id = ${resourceId}`)[0];
  if (!row) throw new ProfileError("not_found");
  const protectedResource = Boolean(row.is_protected || row.account_protected || row.account_kind === "oracle" || row.provider === "oracle");
  if (protectedResource && (parsed.autoStop === "approve" || parsed.autoStop === "auto")) throw new ProfileError("protected_auto_stop");
  await queryClient`
    INSERT INTO resource_profiles (resource_id, role, lifecycle, backup_class, criticality, auto_stop, labels, notes, updated_by)
    VALUES (${resourceId}, ${parsed.role ?? "general"}, ${parsed.lifecycle ?? "always_on"}, ${parsed.backupClass ?? "none"}, ${parsed.criticality ?? "normal"},
      ${parsed.autoStop ?? "off"}, ${JSON.stringify(parsed.labels ?? {})}::jsonb, ${parsed.notes ?? null}, ${actor})
    ON CONFLICT (resource_id) DO UPDATE SET
      role = COALESCE(${parsed.role ?? null}, resource_profiles.role),
      lifecycle = COALESCE(${parsed.lifecycle ?? null}, resource_profiles.lifecycle),
      backup_class = COALESCE(${parsed.backupClass ?? null}, resource_profiles.backup_class),
      criticality = COALESCE(${parsed.criticality ?? null}, resource_profiles.criticality),
      auto_stop = COALESCE(${parsed.autoStop ?? null}, resource_profiles.auto_stop),
      labels = CASE WHEN ${parsed.labels !== undefined} THEN ${JSON.stringify(parsed.labels ?? {})}::jsonb ELSE resource_profiles.labels END,
      notes = CASE WHEN ${parsed.notes !== undefined} THEN ${parsed.notes ?? null} ELSE resource_profiles.notes END,
      updated_by = ${actor}, updated_at = NOW()`;
  await queryClient`INSERT INTO capacity_events (subject, action, actor, detail) VALUES (${resourceId}, 'profile_set', ${actor}, ${JSON.stringify({ ...parsed, labels: parsed.labels ? Object.keys(parsed.labels) : undefined })}::jsonb)`;
}
