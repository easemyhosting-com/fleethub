import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedJson, readBoundedText, ResponseTooLargeError } from "../src/lib/http/bounded";
import { _resetTokenCache, getInfisicalStatus } from "../src/lib/infisical/client";
import { fetchRepoFiles, GithubError } from "../src/lib/gitops/github";
import { maxFileBytes } from "../src/lib/gitops/parse";

/** A body that keeps producing chunks; a reader that does not stop would never finish. */
function endless(chunk = new Uint8Array(64 * 1024).fill(32)) {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(chunk); }, cancel() { cancelled = true; } });
  return { stream, state: () => ({ pulls, cancelled }) };
}

describe("bounded upstream reads", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); _resetTokenCache(); });

  it("parses small bodies and treats an empty body as null", async () => {
    expect(await readBoundedJson(Response.json({ ok: true }), 1024)).toEqual({ ok: true });
    expect(await readBoundedJson(new Response(""), 1024)).toBeNull();
    await expect(readBoundedJson(new Response("{"), 1024)).rejects.toThrow(SyntaxError);
  });

  it("strips a UTF-8 byte order mark like Response.json", async () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"accessToken":"fixture"}')]);
    expect(await readBoundedJson(new Response(body), 1024)).toEqual({ accessToken: "fixture" });
  });

  it("rejects an oversized declared length before reading", async () => {
    const body = endless();
    await expect(readBoundedText(new Response(body.stream, { headers: { "content-length": "2048" } }), 1024)).rejects.toThrow(ResponseTooLargeError);
    expect(body.state()).toEqual({ pulls: expect.any(Number), cancelled: true });
  });

  it("cancels an undeclared stream as soon as it passes the cap", async () => {
    const body = endless();
    await expect(readBoundedText(new Response(body.stream), 256 * 1024)).rejects.toThrow(ResponseTooLargeError);
    expect(body.state().cancelled).toBe(true);
    expect(body.state().pulls).toBeLessThan(10);
  });

  it("keeps the Infisical client offline when the token response is oversized", async () => {
    vi.stubEnv("INFISICAL_URL", "https://vault.test");
    vi.stubEnv("AGENT_VAULT_URL", "");
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_ID", "fixture-client");
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "fixture-secret");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(endless().stream));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getInfisicalStatus()).connected).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an oversized GitOps file as too_large", async () => {
    const big = new Uint8Array(maxFileBytes + 1).fill(97);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => String(input).includes("/git/trees/")
      ? Response.json({ tree: [{ path: "fleet/app.yaml", type: "blob", size: 10 }] })
      : new Response(big)));
    const error = await fetchRepoFiles("example/repo", "main", "fleet", new AbortController().signal, "fixture-token").catch(caught => caught);
    expect(error).toBeInstanceOf(GithubError);
    expect(error.code).toBe("too_large");
  });
});
