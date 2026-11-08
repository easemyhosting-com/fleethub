import { SetupError, SetupInputError } from "./model";
import { createHmac, randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { configSchemas, setupFreshnessMs, stepIds, vaultStepIds, storedStepSchema, type StepId } from "./model";
import { verifyStep } from "./verify";

/** The database stamps verification time, so a few milliseconds of difference from this process must not make a fresh result look stale. */
const clockSkewMs = 2000;
const sharedKeys = ["FLEETHUB_ONBOARDING_ALLOWED_ORIGINS"] as const;
const runtimeKeysByStep: Record<StepId, readonly string[]> = {
  tailscale: ["TAILSCALE_API_TOKEN", "TAILSCALE_API_AUTH", "TAILSCALE_STATUS_FILE"],
  infisical: ["INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET"],
  cliproxy: ["CLIPROXY_API_KEY", "CLIPROXY_MANAGEMENT_KEY"],
  builtin: ["FLEETHUB_SECRET_STORE_KEY"],
};

/** Covers one step's own credentials (all steps when omitted); later steps go stale through the preceding-step chain, so rotating one service never invalidates earlier ones. */
export function runtimeFingerprint(step?: StepId): string {
  const runtimeKeys = [...(step ? runtimeKeysByStep[step] : Object.values(runtimeKeysByStep).flat()), ...sharedKeys];
  const key = process.env.FLEETHUB_AUTH_SECRET;
  if (!key || Buffer.byteLength(key) < 32) throw new SetupError("Configure the FleetHub session signing secret before setup");
  return createHmac("sha256", key).update(JSON.stringify(["onboarding-v1", ...runtimeKeys.map(name => process.env[name] || "")])).digest("hex");
}

export async function getSetupState(readRows?: () => Promise<readonly unknown[]>) {
  const rows = await (readRows ? readRows() : queryClient`SELECT id, config, revision, status, verified_at AS "verifiedAt", fingerprint, skipped FROM onboarding_steps`);
  const saved = rows.map(row => storedStepSchema.parse(row));
  const steps = stepIds.map(id => {
    const row = saved.find(item => item.id === id);
    const fingerprint = runtimeFingerprint(id);
    const valid = row ? configSchemas[id].safeParse(row.config) : null;
    const fresh = valid?.success && row?.status === "verified" && row.verifiedAt && Date.now() - row.verifiedAt.getTime() >= -clockSkewMs && Date.now() - row.verifiedAt.getTime() < setupFreshnessMs() && row.fingerprint === fingerprint;
    const status = !row || (row.skipped && !Object.keys(row.config).length) ? "unconfigured" : !valid?.success ? "failed" : row.status === "verified" && !fresh ? "stale" : row.status;
    return {
      id, config: valid?.success ? valid.data : {}, revision: row?.revision ?? 0,
      status, verifiedAt: row?.verifiedAt?.toISOString() ?? null,
      skipped: row?.skipped ?? false,
      message: status === "verified" ? "Connection verified" : status === "stale" ? "Verify again; the connection, credentials, or a prerequisite changed" : status === "failed" ? "Verification failed; check configuration and retry" : "Configure and verify this connection",
    };
  });
  return { steps, ready: steps.some(step => (vaultStepIds as readonly string[]).includes(step.id) && step.status === "verified") };
}

export async function saveSetupStep(id: StepId, input: Record<string, unknown>) {
  const parsed = configSchemas[id].safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? "settings")))];
    throw new SetupInputError(`Invalid public connection settings. Check: ${fields.join(", ")}`);
  }
  const config = parsed.data;
  await queryClient.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(76411213)`;
    await transaction`
      INSERT INTO onboarding_steps (id, config, revision, status)
      VALUES (${id}, ${JSON.stringify(config)}, 1, 'configured')
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, revision = onboarding_steps.revision + 1,
      status = 'configured', verified_at = NULL, fingerprint = NULL, skipped = FALSE
    `;
  });
  return getSetupState();
}

export async function skipSetupStep(id: "tailscale" | "cliproxy") {
  await queryClient.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(76411213)`;
    await transaction`
      INSERT INTO onboarding_steps (id, config, revision, status, skipped)
      VALUES (${id}, '{}', 1, 'configured', TRUE)
      ON CONFLICT (id) DO UPDATE SET skipped = TRUE, revision = onboarding_steps.revision + 1
    `;
  });
  return getSetupState();
}

/** A secret-store step that was verified once but has aged out is re-checked on demand, so a routine freshness window never blocks storing a credential. A step that fails the re-check stays unavailable. */
export async function refreshStaleVaultSteps() {
  let state = await getSetupState();
  if (state.ready) return state;
  for (const step of state.steps) {
    if (step.status !== "stale" || !(vaultStepIds as readonly string[]).includes(step.id)) continue;
    try { state = await verifySetupStep(step.id); } catch { /* The step stays stale or failed. */ }
    if (state.ready) break;
  }
  return state;
}

export async function verifySetupStep(id: StepId) {
  const before = await getSetupState();
  const current = before.steps[stepIds.indexOf(id)];
  if (current.status === "unconfigured") throw new SetupError("Save connection settings before verification");
  const fingerprint = runtimeFingerprint(id);
  const attempt = randomUUID();
  const claimed = await queryClient`UPDATE onboarding_steps SET verification_id = ${attempt} WHERE id = ${id} AND revision = ${current.revision} RETURNING id`;
  if (!claimed.length) throw new SetupError("Settings changed during verification; verify again");
  try {
    await verifyStep(id, current.config);
  } catch (error) {
    await queryClient`UPDATE onboarding_steps SET status = 'failed', verified_at = NULL, fingerprint = NULL WHERE id = ${id} AND revision = ${current.revision} AND verification_id = ${attempt}`;
    throw error;
  }
  if (runtimeFingerprint(id) !== fingerprint) throw new SetupError("Runtime credentials changed; verify again");
  const result = await queryClient`UPDATE onboarding_steps SET status = 'verified', verified_at = NOW(), fingerprint = ${fingerprint}, skipped = FALSE WHERE id = ${id} AND revision = ${current.revision} AND verification_id = ${attempt} RETURNING id`;
  if (!result.length) throw new SetupError("Settings changed during verification; verify again");
  return getSetupState();
}
