import { z } from "zod";

/** Fixed vocabulary the owner chooses from, so recommendations and policies can rely on it. Values are stable identifiers; labels are for display. */
export const roles = ["primary_site", "backup_site", "agent_host", "ci_runner", "database_primary", "database_backup", "llm_endpoint", "object_storage", "general", "unused"] as const;
export const lifecycles = ["always_on", "on_demand", "ephemeral", "scheduled"] as const;
export const backupClasses = ["none", "needs_backup", "restorable_on_demand", "ephemeral_no_backup"] as const;
export const criticalities = ["high", "normal", "low"] as const;
/** Auto-stop is only ever a setting here; nothing acts on it until the actuator milestone. */
export const autoStopModes = ["off", "recommend", "approve", "auto"] as const;

export type Role = typeof roles[number];
export type Lifecycle = typeof lifecycles[number];
export type BackupClass = typeof backupClasses[number];
export type Criticality = typeof criticalities[number];
export type AutoStopMode = typeof autoStopModes[number];

export const roleLabels: Record<Role, string> = {
  primary_site: "Primary site", backup_site: "Backup site", agent_host: "Agent host", ci_runner: "CI runner", database_primary: "Database (main)",
  database_backup: "Database (backup)", llm_endpoint: "LLM endpoint", object_storage: "Object storage", general: "General", unused: "Unused",
};
export const lifecycleLabels: Record<Lifecycle, string> = { always_on: "Always on", on_demand: "On demand", ephemeral: "Ephemeral", scheduled: "Scheduled" };

const labelKey = z.string().regex(/^[a-z][a-z0-9_.-]{0,31}$/);
const labelValue = z.string().trim().min(1).max(64);

export const profileInputSchema = z.strictObject({
  role: z.enum(roles).optional(),
  lifecycle: z.enum(lifecycles).optional(),
  backupClass: z.enum(backupClasses).optional(),
  criticality: z.enum(criticalities).optional(),
  autoStop: z.enum(autoStopModes).optional(),
  labels: z.record(labelKey, labelValue).refine(value => Object.keys(value).length <= 20, "At most 20 labels").optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const defaultProfile = { role: "general" as Role, lifecycle: "always_on" as Lifecycle, backupClass: "none" as BackupClass, criticality: "normal" as Criticality, autoStop: "off" as AutoStopMode, labels: {} as Record<string, string>, notes: null as string | null };
export type Profile = typeof defaultProfile & { set: boolean };
