import { SetupError } from "./model";
/** Contains only transport status, never the upstream response body or destination. */
export class ServiceRequestError extends SetupError {
  constructor(readonly status: number) {
    super("Service rejected the request; check its URL, credentials, and scoped permissions");
  }
}
/** Credentials require TLS outside loopback unless an operator explicitly trusts the service network. */
export function secureServiceUrl(base: string): string {
  const url = new URL(base);
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol) ||
      (url.protocol === "http:" && !loopback && process.env.FLEETHUB_ALLOW_INSECURE_SERVICE_HTTP !== "true")) {
    throw new SetupError("Use HTTPS for service credentials; trusted internal HTTP requires FLEETHUB_ALLOW_INSECURE_SERVICE_HTTP=true");
  }
  return base;
}
export function approvedApiUrl(base: string): string {
  const url = new URL(base);
  const allowed = (process.env.FLEETHUB_ONBOARDING_ALLOWED_ORIGINS || "").split(",").map(value => value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !allowed.includes(url.origin)) {
    throw new SetupError("Set FLEETHUB_ONBOARDING_ALLOWED_ORIGINS to the intended service origin before verification");
  }
  secureServiceUrl(base);
  return url.toString().replace(/\/$/, "");
}

export async function requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
  secureServiceUrl(url);
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ServiceRequestError(response.status);
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new SetupError("Service response is too large");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
