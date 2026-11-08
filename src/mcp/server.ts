import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { declarations, tools } from "@/lib/mcp/tools";
import type { FleetClient } from "./client";

export const serverInfo = { name: "fleethub-mcp", version: "1.0.0" };
const refusal = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: JSON.stringify({ status: "rejected", message }) }] });

export function createFleetServer(client: FleetClient): Server {
  const server = new Server(serverInfo, { capabilities: { tools: { listChanged: false } }, instructions: "Read-only FleetHub inventory. Unknown or unavailable data is never zero. No execution tools exist." });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: declarations.map(tool => ({ ...tool, inputSchema: tool.inputSchema as { type: "object" }, annotations: { ...tool.annotations } })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find(item => item.name === request.params.name);
    if (!tool) return refusal("Unknown tool. Only read-only FleetHub tools are available.");
    const args = tool.schema.safeParse(request.params.arguments ?? {});
    if (!args.success) return refusal("Invalid tool arguments.");
    const outcome = await client.callTool(tool.name, args.data, extra.signal);
    return { isError: outcome.isError, content: [{ type: "text" as const, text: outcome.text }] };
  });
  return server;
}
