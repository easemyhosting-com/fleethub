import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAiConnection } from "../src/lib/ai/probe";
import { aiConnectionInput, type AiConnectionInput } from "../src/lib/ai/model";

const key = "synthetic-ai-key-fixture";
const base: AiConnectionInput = { endpoint: "https://ai.example.com/v1", protocol: "openai-chat-completions", model: "fixture-model", secretRefId: "ref-ai" };
const readKey = vi.fn(async () => key);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const models = { data: [{ id: "fixture-model" }, { id: "other" }] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS", "https://ai.example.com,http://127.0.0.1:11434,http://192.0.2.10:8080");
  readKey.mockClear();
  fetchMock = vi.fn(async (url: string) => json(String(url).endsWith("/models") ? models : {}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));

describe("optional AI connection check", () => {
  it("never sends a billable request without consent and never calls telemetry endpoints", async () => {
    const result = await checkAiConnection(base, { consentToBillableProbe: false, readKey });
    expect(calls().map(call => call.url)).toEqual(["https://ai.example.com/v1/models"]);
    expect(result.modelList).toEqual({ state: "listed", modelCount: 2 });
    expect(result.inference).toEqual({ state: "untested", reason: "billable_probe_not_consented" });
    expect(result.telemetry).toEqual({ state: "unsupported", reason: "inference_connection_has_no_telemetry" });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("uses a separate request contract per protocol", async () => {
    const replies = {
      "openai-chat-completions": ["/chat/completions", { choices: [{}] }],
      "openai-responses": ["/responses", { output: [] }],
      "anthropic-messages": ["/messages", { type: "message", content: [] }],
    } as const;
    for (const [protocol, [path, reply]] of Object.entries(replies)) {
      fetchMock.mockImplementation(async (url: string) => json(String(url).endsWith("/models") ? models : reply));
      fetchMock.mockClear();
      const result = await checkAiConnection({ ...base, protocol: protocol as AiConnectionInput["protocol"] }, { consentToBillableProbe: true, readKey });
      expect(result.inference).toEqual({ state: "supported" });
      const [list, infer] = calls();
      expect(infer.url).toBe(`https://ai.example.com/v1${path}`);
      expect(infer.init.method).toBe("POST");
      expect(infer.init.redirect).toBe("error");
      const sent = new Headers(infer.init.headers);
      if (protocol === "anthropic-messages") {
        expect(sent.get("x-api-key")).toBe(key); expect(sent.get("authorization")).toBeNull();
        expect(sent.get("anthropic-version")).toBeTruthy();
      } else {
        expect(sent.get("authorization")).toBe(`Bearer ${key}`); expect(sent.get("x-api-key")).toBeNull();
      }
      expect(new Headers(list.init.headers).get(protocol === "anthropic-messages" ? "x-api-key" : "authorization")).toBeTruthy();
    }
  });

  it("bounds reasoning-model probes with the compatible parameter and never retries", async () => {
    fetchMock.mockImplementation(async (url: string) => json(String(url).endsWith("/models") ? models : { choices: [{}] }));
    await checkAiConnection({ ...base, model: "o3-mini" }, { consentToBillableProbe: true, readKey });
    expect(calls()).toHaveLength(2);
    const body = JSON.parse(String(calls()[1].init.body));
    expect(body.max_completion_tokens).toBe(1);
    expect(body.max_tokens).toBeUndefined();
  });

  it("does not accept another protocol's reply as proof of inference", async () => {
    fetchMock.mockImplementation(async (url: string) => json(String(url).endsWith("/models") ? models : { choices: [{}] }));
    const result = await checkAiConnection({ ...base, protocol: "anthropic-messages" }, { consentToBillableProbe: true, readKey });
    expect(result.inference).toEqual({ state: "failed", reason: "invalid_response" });
  });

  it("treats a failed Responses generation as a failure but accepts a capped one", async () => {
    const responses = { ...base, protocol: "openai-responses" as const };
    for (const [reply, state] of [
      [{ output: [], status: "failed", error: { code: "server_error" } }, "failed"],
      [{ output: [], error: { code: "server_error" } }, "failed"],
      [{ output: [{}], status: "incomplete", error: null }, "supported"],
    ] as const) {
      fetchMock.mockImplementation(async (url: string) => json(String(url).endsWith("/models") ? models : reply));
      expect((await checkAiConnection(responses, { consentToBillableProbe: true, readKey })).inference.state).toBe(state);
    }
  });

  it("reports an unlisted model without claiming inference works", async () => {
    const result = await checkAiConnection({ ...base, model: "absent" }, { consentToBillableProbe: false, readKey });
    expect(result.modelList).toEqual({ state: "not_listed", modelCount: 2 });
    expect(result.inference.state).toBe("untested");
  });

  it("maps upstream failures to a status class without echoing the body", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).endsWith("/models")
      ? json({ error: "upstream detail with the key " + key }, 401)
      : json({ error: "private upstream detail" }, 500));
    const result = await checkAiConnection(base, { consentToBillableProbe: true, readKey });
    expect(result.modelList).toEqual({ state: "failed", reason: "access_denied" });
    expect(result.inference).toEqual({ state: "failed", reason: "unavailable" });
    expect(JSON.stringify(result)).not.toMatch(/upstream detail|private/);
  });

  it("sends no request when the stored key cannot be read", async () => {
    readKey.mockRejectedValueOnce(new Error("vault detail"));
    const result = await checkAiConnection(base, { consentToBillableProbe: true, readKey });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.modelList).toEqual({ state: "failed", reason: "credential_unavailable" });
    expect(result.inference).toEqual({ state: "failed", reason: "credential_unavailable" });
  });

  it("supports a keyless local model server on loopback HTTP", async () => {
    const result = await checkAiConnection({ ...base, endpoint: "http://127.0.0.1:11434/v1", secretRefId: null }, { consentToBillableProbe: false, readKey });
    expect(readKey).not.toHaveBeenCalled();
    expect(new Headers(calls()[0].init.headers).get("authorization")).toBeNull();
    expect(result.modelList.state).toBe("listed");
  });

  it("refuses origins outside the allowlist, plain HTTP off loopback, and URL tricks before any request", async () => {
    for (const endpoint of ["https://other.example.com/v1", "http://192.0.2.10:8080/v1", "https://user:pw@ai.example.com/v1", "https://ai.example.com/v1?x=1"]) {
      await expect(checkAiConnection({ ...base, endpoint }, { consentToBillableProbe: true, readKey })).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readKey).not.toHaveBeenCalled();
  });

  it("validates settings strictly", () => {
    expect(aiConnectionInput.safeParse(base).success).toBe(true);
    for (const bad of [{ ...base, apiKey: "inline" }, { ...base, protocol: "openai-compatible" }, { ...base, endpoint: "ftp://ai.example.com/v1" }, { ...base, model: "bad model" }]) {
      expect(aiConnectionInput.safeParse(bad).success).toBe(false);
    }
  });
});
