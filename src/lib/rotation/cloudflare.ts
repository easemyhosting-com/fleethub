import { z } from "zod";
import { RotationError, type CredentialRotator, type RotateInput } from "./types";

const base = "https://api.cloudflare.com/client/v4";
const verifyResult = z.object({ success: z.literal(true), result: z.object({ id: z.string().min(1), status: z.string().optional(), expires_on: z.string().nullish() }) });
const rollResult = z.object({ success: z.literal(true), result: z.string().min(40).max(200) });

async function call(path: string, token: string, signal: AbortSignal, method = "GET"): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) throw new RotationError("provider_rejected");
  return response.json();
}

/** Finds the token's own id: user tokens verify at /user, account-owned tokens at /accounts/{id}. */
async function ownerPath(token: string, accountId: string, signal: AbortSignal): Promise<{ prefix: string; id: string; status?: string; expiresOn?: string | null }> {
  for (const prefix of ["/user", `/accounts/${encodeURIComponent(accountId)}`]) {
    try {
      const parsed = verifyResult.safeParse(await call(`${prefix}/tokens/verify`, token, signal));
      if (parsed.success) return { prefix, id: parsed.data.result.id, status: parsed.data.result.status, expiresOn: parsed.data.result.expires_on };
    } catch (error) { if (signal.aborted) throw error; }
  }
  throw new RotationError("provider_rejected");
}

/** The token's own expiry date as reported by Cloudflare, or null when it never expires. */
export async function cloudflareTokenExpiry(token: string, accountId: string, signal: AbortSignal): Promise<Date | null> {
  const { expiresOn } = await ownerPath(token, accountId, signal);
  const at = expiresOn ? new Date(expiresOn) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}

export const cloudflareRotator: CredentialRotator = {
  providerId: "cloudflare",
  label: "Cloudflare API token",
  rotatorHint: "A separate Cloudflare token with permission API Tokens: Edit (user) or Account API Tokens: Edit. It rolls the read-only scan token's secret.",
  async checkRotatorSecret(secret, signal, scope) {
    const accountId = typeof scope.accountId === "string" ? scope.accountId : "";
    if ((await ownerPath(secret, accountId, signal)).status !== "active") throw new RotationError("provider_rejected");
  },
  async rotate({ current, rotatorSecret, signal }: RotateInput) {
    const apiToken = typeof current.apiToken === "string" ? current.apiToken : "";
    const accountId = typeof current.accountId === "string" ? current.accountId : "";
    if (!apiToken || !accountId) throw new RotationError("invalid_config");
    const { prefix, id } = await ownerPath(apiToken, accountId, signal);
    const rolled = rollResult.safeParse(await call(`${prefix}/tokens/${encodeURIComponent(id)}/value`, rotatorSecret, signal, "PUT"));
    if (!rolled.success) throw new RotationError("provider_rejected");
    return { ...current, apiToken: rolled.data.result };
  },
};
