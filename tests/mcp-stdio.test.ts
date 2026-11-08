import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];
let http: HttpServer; let port = 0;
beforeAll(async () => {
 execFileSync(process.execPath, ["scripts/build-mcp.mjs"], { stdio: "pipe" });
 http = createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
   seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
   if (req.headers.authorization !== "Bearer stdio-reader-fixture") { res.writeHead(401).end("{}"); return; }
   const { params } = JSON.parse(body);
   res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: false, content: [{ type: "text", text: JSON.stringify({ tool: params.name, arguments: params.arguments }) }] } }));
  });
 });
 await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
 port = (http.address() as AddressInfo).port;
});
afterAll(() => { http.close(); });
const open = async (key: string | undefined) => {
 const env: Record<string, string> = { PATH: process.env.PATH ?? "", FLEETHUB_URL: `http://127.0.0.1:${port}` };
 if (key) env.FLEETHUB_READONLY_KEY = key;
 const client = new Client({ name: "stdio-test", version: "0" });
 await client.connect(new StdioClientTransport({ command: process.execPath, args: ["build/mcp-stdio.mjs"], env, stderr: "pipe" }));
 return client;
};
describe("stdio MCP bundle", () => {
 it("speaks standard MCP and only issues read-only bridge calls", async () => {
  const client = await open("stdio-reader-fixture");
  expect((await client.listTools()).tools).toHaveLength(9);
  const result = await client.callTool({ name: "list_resources", arguments: { accountId: "account-1" } });
  expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({ tool: "list_resources", arguments: { accountId: "account-1", includeMissing: false } });
  await client.close();
  expect(seen.length).toBeGreaterThan(0);
  for (const request of seen) { expect(request.method).toBe("POST"); expect(request.url).toBe("/api/mcp"); expect(JSON.parse(request.body).method).toBe("tools/call"); }
 }, 20_000);
 it("reports a rejected key as an error, not empty inventory", async () => {
  const client = await open("stdio-wrong-key");
  const result = await client.callTool({ name: "get_fleet_context", arguments: {} });
  expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("stdio-wrong-key");
  await client.close();
 }, 20_000);
 it("refuses to start without a key", async () => {
  await expect(open(undefined)).rejects.toThrow();
 }, 20_000);
});
