const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const maxResponseBytes = 1_000_000;
const requestTimeoutMs = 15_000;

export type ToolOutcome = { isError: boolean; text: string };
export type FleetClient = { callTool(name: string, args: unknown, signal?: AbortSignal): Promise<ToolOutcome> };
type ClientOptions = { baseUrl: string | undefined; key: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number };

const unavailable = (message: string): ToolOutcome => ({ isError: true, text: JSON.stringify({ status: "unavailable", message }) });

export function resolveEndpoint(baseUrl: string | undefined): URL {
  let url: URL;
  try { url = new URL(baseUrl ?? ""); } catch { throw new Error("FLEETHUB_URL must be an absolute URL"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("FLEETHUB_URL must not contain credentials, a query or a fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) throw new Error("FLEETHUB_URL must use https, or http on a loopback host");
  return new URL("/api/mcp", url);
}

async function readLimited(response: Response): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createFleetClient(options: ClientOptions): FleetClient {
  const endpoint = resolveEndpoint(options.baseUrl);
  const key = options.key?.trim();
  if (!key) throw new Error("FLEETHUB_READONLY_KEY is required");
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async callTool(name, args, signal) {
      const deadline = AbortSignal.timeout(options.timeoutMs ?? requestTimeoutMs);
      try {
        const response = await doFetch(endpoint, {
          method: "POST", redirect: "error", cache: "no-store",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args ?? {} } }),
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        });
        if (response.status === 401 || response.status === 403) return unavailable("FleetHub rejected the read-only key or denied this tool.");
        const raw = await readLimited(response);
        if (raw === null) return unavailable("FleetHub response exceeded the size limit.");
        let body: { result?: { isError?: boolean; content?: { type?: string; text?: unknown }[] } };
        try { body = JSON.parse(raw); } catch { return unavailable(`FleetHub returned an unreadable response (HTTP ${response.status}).`); }
        const first = body.result?.content?.[0];
        if (!response.ok || first?.type !== "text" || typeof first.text !== "string") return unavailable(`FleetHub could not complete the request (HTTP ${response.status}).`);
        return { isError: body.result?.isError === true, text: first.text };
      } catch {
        return unavailable("FleetHub is unreachable or did not respond in time.");
      }
    },
  };
}
