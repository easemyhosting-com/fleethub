import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFleetClient } from "./client";
import { createFleetServer } from "./server";

async function main() {
  const client = createFleetClient({ baseUrl: process.env.FLEETHUB_URL ?? "http://localhost:3060", key: process.env.FLEETHUB_READONLY_KEY });
  await createFleetServer(client).connect(new StdioServerTransport());
}

main().catch(error => {
  console.error(`fleethub-mcp could not start: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
