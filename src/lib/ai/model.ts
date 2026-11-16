import { z } from "zod";

/** Separate capabilities. Supporting one wire protocol says nothing about the others. */
export const aiProtocols = ["openai-chat-completions", "openai-responses", "anthropic-messages"] as const;
export type AiProtocol = typeof aiProtocols[number];

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/);
/** The API base including its version prefix, for example https://api.example.com/v1. */
const endpoint = z.string().trim().max(2048).pipe(z.url({ protocol: /^https?$/ }));

export const aiConnectionInput = z.strictObject({
  endpoint,
  protocol: z.enum(aiProtocols),
  model: z.string().trim().regex(/^[A-Za-z0-9_.:/@+-]{1,200}$/),
  // Local model servers often need no key. When set, it names an existing encrypted-store reference.
  secretRefId: id.nullable(),
});
export type AiConnectionInput = z.infer<typeof aiConnectionInput>;

export const aiCheckRequest = z.strictObject({ consentToBillableProbe: z.boolean() });

export const aiConnectionSnapshot = z.object({
  connection: aiConnectionInput.extend({ updatedAt: z.string() }).nullable(),
  secretRefs: z.array(z.object({ id: z.string(), label: z.string() })),
  limited: z.boolean(),
});
export type AiConnectionSnapshot = z.infer<typeof aiConnectionSnapshot>;

type Failure = "access_denied" | "unavailable" | "invalid_response" | "credential_unavailable";
export type AiCheckResult = {
  schemaVersion: 1;
  checkedAt: string;
  protocol: AiProtocol;
  model: string;
  /** A model list is not proof of inference, quota or tool support. */
  modelList:
    | { state: "listed" | "not_listed"; modelCount: number }
    | { state: "failed"; reason: Failure };
  inference:
    | { state: "untested"; reason: "billable_probe_not_consented" }
    | { state: "supported" }
    | { state: "failed"; reason: Failure };
  /** Usage and quota come from separate management adapters, never from the inference connection. */
  telemetry: { state: "unsupported"; reason: "inference_connection_has_no_telemetry" };
};
