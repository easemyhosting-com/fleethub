import { z } from "zod";

export class SetupError extends Error {}
export class SetupInputError extends SetupError {}

const serviceUrl = z.url().max(2048).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, "Use an HTTP(S) URL without credentials, query, or fragment");
const secretPath = z.string().max(512).regex(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/);
export const stepIds = ["tailscale", "infisical", "cliproxy", "builtin"] as const;
/** Either of these verified is enough to store provider credentials; the other steps are independent and optional. */
export const vaultStepIds = ["infisical", "builtin"] as const;
export type StepId = typeof stepIds[number];
export const configSchemas = {
  tailscale: z.strictObject({ tailnet: z.string().trim().min(1).max(254), deviceId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/) }),
  infisical: z.strictObject({ apiUrl: serviceUrl, consoleUrl: serviceUrl, projectId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), environment: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), secretPath, connectorSecretPath: z.union([z.literal(""), secretPath]).optional() }),
  cliproxy: z.strictObject({ apiUrl: serviceUrl, consoleUrl: serviceUrl }),
  builtin: z.strictObject({}),
};
export type VaultConfig = z.infer<typeof configSchemas.infisical>;
/** Where new credentials of each kind are written. A blank connector path keeps connectors beside accounts, as before the setting existed. */
export function writeScope(config: VaultConfig, kind: "account" | "connector"): VaultConfig {
  return kind === "connector" && config.connectorSecretPath ? { ...config, secretPath: config.connectorSecretPath } : config;
}
export const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("save"), step: z.enum(stepIds), config: z.record(z.string(), z.unknown()) }),
  z.strictObject({ action: z.literal("verify"), step: z.enum(stepIds) }),
  z.strictObject({ action: z.literal("skip"), step: z.enum(["tailscale", "cliproxy"]) }),
]);
export const storedStepSchema = z.object({
  id: z.enum(stepIds), config: z.record(z.string(), z.unknown()), revision: z.number().int(),
  status: z.enum(["configured", "verified", "failed"]),
  verifiedAt: z.coerce.date().nullable(), fingerprint: z.string().nullable(),
  skipped: z.boolean().default(false),
});
export type StoredStep = z.infer<typeof storedStepSchema>;
export const freshnessMs = 15 * 60 * 1000;
/** How long a verification counts. FLEETHUB_SETUP_FRESHNESS_MINUTES (1 to 1440) can extend it for a long setup session; the default stays 15 minutes. */
export function setupFreshnessMs(env: Record<string, string | undefined> = process.env): number {
  const minutes = Number(env.FLEETHUB_SETUP_FRESHNESS_MINUTES);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes * 60 * 1000 : freshnessMs;
}
