import { z } from "zod";
import { approvedApiUrl, requestJson, ServiceRequestError } from "@/lib/onboarding/transport";
import type { AiCheckResult, AiConnectionInput, AiProtocol } from "./model";

type Failure = "access_denied" | "unavailable" | "invalid_response";
const prompt = "Reply with OK.";
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(512) })).max(10000) });

/** One request shape per protocol. Each is a minimal call that can incur upstream cost. */
const inference: Record<AiProtocol, { path: string; body: (model: string) => unknown; schema: z.ZodType }> = {
  "openai-chat-completions": {
    path: "/chat/completions",
    body: model => ({ model, messages: [{ role: "user", content: prompt }], max_tokens: 1 }),
    schema: z.object({ choices: z.array(z.unknown()).min(1) }),
  },
  "openai-responses": {
    path: "/responses",
    body: model => ({ model, input: prompt, max_output_tokens: 16 }),
    // A 200 reply can still describe a failed generation. "incomplete" (token cap reached) still proves the model answered.
    schema: z.object({ output: z.array(z.unknown()), status: z.string().optional(), error: z.unknown().optional() })
      .refine(reply => reply.status !== "failed" && (reply.error === undefined || reply.error === null)),
  },
  "anthropic-messages": {
    path: "/messages",
    body: model => ({ model, max_tokens: 1, messages: [{ role: "user", content: prompt }] }),
    schema: z.object({ type: z.literal("message"), content: z.array(z.unknown()) }),
  },
};

function headers(protocol: AiProtocol, key: string | null): Record<string, string> {
  if (protocol === "anthropic-messages") return { "anthropic-version": "2023-06-01", ...(key ? { "x-api-key": key } : {}) };
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Status class only. Upstream bodies, destinations and keys never reach the result. */
function failure(error: unknown): Failure {
  if (error instanceof ServiceRequestError) return [401, 403].includes(error.status) ? "access_denied" : "unavailable";
  return error instanceof SyntaxError || error instanceof z.ZodError ? "invalid_response" : "unavailable";
}

/**
 * Checks only the contracts implemented here. The model list is free on common servers but is not proof of inference.
 * The inference request runs only with explicit consent because it can be billed. Management and quota endpoints are
 * never called: telemetry belongs to separate adapters.
 */
export async function checkAiConnection(
  connection: AiConnectionInput,
  options: { consentToBillableProbe: boolean; readKey: (secretRefId: string) => Promise<string> },
): Promise<AiCheckResult> {
  const base = approvedApiUrl(connection.endpoint);
  const result = (modelList: AiCheckResult["modelList"], inference: AiCheckResult["inference"]): AiCheckResult => ({
    schemaVersion: 1, checkedAt: new Date().toISOString(), protocol: connection.protocol, model: connection.model,
    modelList, inference, telemetry: { state: "unsupported", reason: "inference_connection_has_no_telemetry" },
  });
  const untested = { state: "untested", reason: "billable_probe_not_consented" } as const;
  let key: string | null = null;
  if (connection.secretRefId) {
    try { key = await options.readKey(connection.secretRefId); }
    catch {
      const unavailable = { state: "failed", reason: "credential_unavailable" } as const;
      return result(unavailable, options.consentToBillableProbe ? unavailable : untested);
    }
  }
  const auth = headers(connection.protocol, key);
  let modelList: AiCheckResult["modelList"];
  try {
    const models = modelsSchema.parse(await requestJson(`${base}/models`, { headers: auth }));
    modelList = { state: models.data.some(item => item.id === connection.model) ? "listed" : "not_listed", modelCount: models.data.length };
  } catch (error) { modelList = { state: "failed", reason: failure(error) }; }
  if (!options.consentToBillableProbe) return result(modelList, untested);
  const contract = inference[connection.protocol];
  try {
    contract.schema.parse(await requestJson(`${base}${contract.path}`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(contract.body(connection.model)),
    }));
    return result(modelList, { state: "supported" });
  } catch (error) { return result(modelList, { state: "failed", reason: failure(error) }); }
}
