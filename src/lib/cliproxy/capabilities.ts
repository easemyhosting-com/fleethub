import { createHmac } from "node:crypto";
import { z } from "zod";
import { configSchemas } from "@/lib/onboarding/model";
import { approvedApiUrl, requestJson, ServiceRequestError } from "@/lib/onboarding/transport";

const timestamp = z.iso.datetime();
export const quotaObservationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("not_loaded") }),
  z.strictObject({ state: z.literal("loading"), attemptedAt: timestamp }),
  z.strictObject({ state: z.literal("observed"), observedAt: timestamp, used: z.number().nonnegative(), limit: z.number().positive(), unit: z.string().min(1).max(32) }),
  z.strictObject({ state: z.literal("stale"), observedAt: timestamp, used: z.number().nonnegative(), limit: z.number().positive(), unit: z.string().min(1).max(32) }),
  z.strictObject({ state: z.literal("unsupported"), reason: z.literal("adapter_has_no_quota_reader") }),
  z.strictObject({ state: z.literal("failed"), attemptedAt: timestamp, reason: z.enum(["access_denied", "unavailable", "invalid_response"]) }),
]);
export type QuotaObservation = z.infer<typeof quotaObservationSchema>;

/** An expired measurement retains its value and source time. Unknown never becomes zero. */
export function ageQuota(observation: QuotaObservation, now: number, maxAgeMs: number): QuotaObservation {
  if (observation.state !== "observed") return observation;
  const age = now - Date.parse(observation.observedAt);
  return age < 0 || age >= maxAgeMs ? { ...observation, state: "stale" } : observation;
}

const credentialSchema = z.object({
  auth_index: z.string().min(1).max(512).optional(),
  id: z.string().min(1).max(512).optional(),
  provider: z.string().max(64).optional(),
  disabled: z.boolean().optional(),
  unavailable: z.boolean().optional(),
});
const credentialsSchema = z.object({ files: z.array(credentialSchema).max(5000) });
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(512) })).max(10000) });
const providers = new Set(["claude", "codex", "antigravity", "kimi", "kimi-ai", "xai", "devin", "meta", "gemini", "vertex"]);

type Authentication = "authenticated" | "rejected" | "not_configured" | "unknown";
type CapabilityCheck =
  | { state: "supported"; authentication: "authenticated" }
  | { state: "not_configured"; authentication: "not_configured" }
  | { state: "failed"; authentication: Authentication; reason: "access_denied" | "unavailable" | "invalid_response" };

type Probe<T> = { check: CapabilityCheck; data: T | null };
async function probe<T>(url: string, key: string | undefined, schema: z.ZodType<T>): Promise<Probe<T>> {
  if (!key) return { check: { state: "not_configured", authentication: "not_configured" }, data: null };
  try {
    const result = schema.safeParse(await requestJson(url, { headers: { Authorization: `Bearer ${key}` } }));
    return result.success
      ? { check: { state: "supported", authentication: "authenticated" }, data: result.data }
      : { check: { state: "failed", authentication: "authenticated", reason: "invalid_response" }, data: null };
  } catch (error) {
    const denied = error instanceof ServiceRequestError && [401, 403].includes(error.status);
    const rejected = error instanceof ServiceRequestError && error.status === 401;
    const malformed = error instanceof SyntaxError;
    return { check: { state: "failed", authentication: rejected ? "rejected" : malformed ? "authenticated" : "unknown", reason: denied ? "access_denied" : malformed ? "invalid_response" : "unavailable" }, data: null };
  }
}

/** Read-only v8 adapter. Never reads auth-file contents, logs, configuration or provider tokens. */
export async function inspectCliProxy(input: unknown) {
  const config = configSchemas.cliproxy.parse(input);
  const base = approvedApiUrl(config.apiUrl);
  const idKey = process.env.FLEETHUB_AUTH_SECRET;
  if (!idKey || Buffer.byteLength(idKey) < 32) throw new Error("Session signing key is required");
  const [inference, management] = await Promise.all([
    probe(`${base}/v1/models`, process.env.CLIPROXY_API_KEY, modelsSchema),
    probe(`${base}/v8/management/credentials`, process.env.CLIPROXY_MANAGEMENT_KEY, credentialsSchema),
  ]);
  const quota = { state: "unsupported", reason: "adapter_has_no_quota_reader" } satisfies QuotaObservation;
  return {
    schemaVersion: 1,
    adapter: "cliproxy-v8",
    // The API path identifies the contract. It does not prove an installed server version.
    serverVersion: null,
    checkedAt: new Date().toISOString(),
    inference: { ...inference.check, modelCount: inference.data?.data.length ?? null, upstreamAvailability: "unknown" },
    management: management.check,
    quota,
    credentials: (management.data?.files ?? []).map((credential, index) => ({
      // Stable opaque identifiers avoid exporting email addresses or credential filenames.
      id: createHmac("sha256", idKey).update(JSON.stringify([base, credential.auth_index ?? credential.id ?? `position:${index}`])).digest("hex"),
      provider: credential.provider && providers.has(credential.provider) ? credential.provider : "unknown",
      enablement: credential.disabled === undefined ? "unknown" : credential.disabled ? "disabled" : "enabled",
      authentication: "unknown",
      upstreamAvailability: credential.unavailable === undefined ? "unknown" : credential.unavailable ? "reported_unavailable" : "reported_available",
      quota,
    })),
  };
}
