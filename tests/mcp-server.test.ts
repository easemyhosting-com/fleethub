import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFleetServer } from "../src/mcp/server";
import { tools } from "../src/lib/mcp/tools";
async function connect(callTool = vi.fn(async () => ({ isError: false, text: '{"ok":true}' }))) {
 const [a, b] = InMemoryTransport.createLinkedPair();
 await createFleetServer({ callTool }).connect(b);
 const client = new Client({ name: "test", version: "0" }); await client.connect(a);
 return { client, callTool };
}
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);
describe("standard MCP server", () => {
 it("lists exactly the registry, all read-only, with no execution tools", async () => {
  const { client } = await connect(); const listed = (await client.listTools()).tools;
  expect(listed.map(t => t.name)).toEqual(tools.map(t => t.name));
  for (const tool of listed) { expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false }); expect(tool.inputSchema.type).toBe("object"); }
  expect(listed.some(t => /dispatch|refresh|register|write|execute|ssh/i.test(t.name))).toBe(false);
 });
 it("forwards validated arguments (with defaults) and relays results", async () => {
  const { client, callTool } = await connect();
  expect(text(await client.callTool({ name: "list_resources", arguments: { category: "compute" } }))).toEqual({ ok: true });
  expect(callTool).toHaveBeenCalledWith("list_resources", { category: "compute", includeMissing: false }, expect.anything());
  await client.callTool({ name: "get_quotas" });
  expect(callTool).toHaveBeenLastCalledWith("get_quotas", {}, expect.anything());
 });
 it("relays upstream errors as isError, never empty success", async () => {
  const { client } = await connect(vi.fn(async () => ({ isError: true, text: '{"status":"unavailable"}' })));
  const result = await client.callTool({ name: "get_fleet_context" });
  expect(result.isError).toBe(true); expect(text(result).status).toBe("unavailable");
 });
 it("rejects unknown tools and invalid arguments without calling upstream", async () => {
  const { client, callTool } = await connect();
  for (const request of [{ name: "dispatch_workload" }, { name: "list_resources", arguments: { category: "credentials" } }, { name: "get_quotas", arguments: { extra: 1 } }]) {
   const result = await client.callTool(request); expect(result.isError).toBe(true); expect(text(result).status).toBe("rejected");
  }
  expect(callTool).not.toHaveBeenCalled();
 });
});
