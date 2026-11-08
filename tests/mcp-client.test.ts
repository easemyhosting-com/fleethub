import { describe, expect, it, vi } from "vitest";
import { createFleetClient, resolveEndpoint } from "../src/mcp/client";
const ok = (text: string, isError = false) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError, content: [{ type: "text", text }] } }));
const make = (fetchImpl: typeof fetch, extra = {}) => createFleetClient({ baseUrl: "http://127.0.0.1:3060", key: "reader-fixture-secret", fetchImpl, ...extra });
describe("FleetHub MCP client", () => {
 it("accepts only https or loopback http endpoints without embedded credentials", () => {
  expect(resolveEndpoint("http://localhost:3060/ignored").href).toBe("http://localhost:3060/api/mcp");
  expect(resolveEndpoint("http://[::1]:3060").pathname).toBe("/api/mcp");
  expect(resolveEndpoint("https://hub.example").href).toBe("https://hub.example/api/mcp");
  for (const bad of [undefined, "not a url", "http://hub.example", "ftp://localhost", "https://user:pw@hub.example", "https://hub.example/?token=x", "https://hub.example/#x"]) expect(() => resolveEndpoint(bad)).toThrow();
  expect(() => createFleetClient({ baseUrl: "http://localhost", key: " " })).toThrow("READONLY_KEY");
  expect(() => createFleetClient({ baseUrl: "http://localhost", key: undefined })).toThrow("READONLY_KEY");
 });
 it("posts one tools/call with the read-only key, no redirects", async () => {
  const fetchImpl = vi.fn(async () => ok('{"a":1}'));
  expect(await make(fetchImpl as unknown as typeof fetch).callTool("list_resources", { category: "compute" }, new AbortController().signal)).toEqual({ isError: false, text: '{"a":1}' });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("http://127.0.0.1:3060/api/mcp"); expect(init.redirect).toBe("error");
  expect((init.headers as Record<string, string>).authorization).toBe("Bearer reader-fixture-secret");
  expect(JSON.parse(init.body as string)).toMatchObject({ method: "tools/call", params: { name: "list_resources", arguments: { category: "compute" } } });
  await make(fetchImpl as unknown as typeof fetch).callTool("get_quotas", undefined);
  expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [URL, RequestInit])[1].body as string).params.arguments).toEqual({});
 });
 it("preserves server-reported errors", async () => {
  expect(await make((async () => ok('{"status":"unavailable"}', true)) as unknown as typeof fetch).callTool("get_fleet_context", {})).toEqual({ isError: true, text: '{"status":"unavailable"}' });
 });
 it("turns every failure into an error result without leaking the key or diagnostics", async () => {
  const cases: [string, () => Promise<Response>][] = [
   ["401", async () => new Response("{}", { status: 401 })],
   ["403", async () => new Response("{}", { status: 403 })],
   ["500", async () => new Response("{}", { status: 500 })],
   ["bad json", async () => new Response("<html>reader-fixture-secret</html>")],
   ["bad shape", async () => new Response(JSON.stringify({ result: { content: [] } }))],
   ["network", async () => { throw new Error("reader-fixture-secret private-diagnostic"); }],
   ["oversize", async () => new Response("x".repeat(1_000_001))],
   ["no body", async () => new Response(null, { status: 200 })],
  ];
  for (const [label, impl] of cases) {
   const outcome = await make(impl as unknown as typeof fetch).callTool("get_quotas", {});
   expect(outcome.isError, label).toBe(true);
   expect(outcome.text, label).not.toContain("reader-fixture-secret"); expect(outcome.text, label).not.toContain("private-diagnostic");
   expect(JSON.parse(outcome.text).status, label).toBe("unavailable");
  }
 });
 it("times out hung requests", async () => {
  const hung = ((_: unknown, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
  expect((await make(hung, { timeoutMs: 20 }).callTool("get_quotas", {})).isError).toBe(true);
 });
});
