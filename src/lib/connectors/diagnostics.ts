import { z } from "zod";
import type { FleetAccount } from "@/lib/inventory/model";

const diagnosticSchema = z.strictObject({
  code: z.enum(["credentials", "permissions", "configuration", "rate_limit", "availability", "response", "budget", "unsupported", "stale", "worker", "unknown"]),
  source: z.enum(["inventory_collection", "connector_scan"]),
  observedAt: z.iso.datetime().nullable(),
  summary: z.string().max(160),
  repair: z.string().max(300),
});
export const diagnosticsSchema = z.array(diagnosticSchema).max(3);
export type Diagnostic = z.infer<typeof diagnosticSchema>;
const remedies = {
  credentials: ["Credential access needs attention", "Check the saved secret reference and vault connection. Replace revoked or expired credentials through the account credential controls, then collect inventory again."],
  permissions: ["Read access was denied", "Check the provider's required read scopes and account membership. Keep write permissions disabled unless the documented operation requires them."],
  configuration: ["Connection settings need attention", "Check the service address, TLS certificate and saved account scope. Register a separate account when the provider scope changes."],
  rate_limit: ["The provider rate limited collection", "Wait until the next scheduled attempt. Avoid repeated manual collections while the provider is limiting requests."],
  availability: ["The upstream service could not be reached", "Check the worker's network access and the provider's service status. The previous snapshot remains available with its source time."],
  response: ["The response could not be used", "Check the deployed API version and supported connector contract. Retain the previous snapshot; report the error category without attaching raw provider responses."],
  budget: ["Collection reached its safety limit", "Narrow the provider scope or review scan limits before retrying. FleetHub keeps the previous complete snapshot."],
  unsupported: ["Automatic collection is unavailable", "Use manual inventory for this provider. For LLM accounts, use the CLIProxy console to reconnect; CLIProxy owns OAuth, token refresh and routing."],
  stale: ["Inventory needs refresh", "Check that the inventory worker is online, then collect this account. Treat the previous measurements as stale until collection succeeds."],
  worker: ["This worker no longer owns collection", "Check that the inventory worker is online. Allow the current job owner to finish before requesting another collection."],
  unknown: ["Collection needs investigation", "Check connection settings and worker status. Share only this category and source time when requesting help; do not attach raw gateway logs or credentials."],
} satisfies Record<Diagnostic["code"], readonly [string, string]>;

function diagnostic(code: Diagnostic["code"], source: Diagnostic["source"], at: string | null): Diagnostic {
  const parsed = z.iso.datetime().safeParse(at);
  return { code, source, observedAt: parsed.success ? parsed.data : null, summary: remedies[code][0], repair: remedies[code][1] };
}

/** Only fixed categories and copy cross the boundary. Raw exception messages are never accepted. */
export function connectorDiagnostics(status: string | null, at: string | null): Diagnostic[] {
  if (!status || status === "ok") return [];
  const code = status === "unauthorized" ? "credentials" : status === "forbidden" ? "permissions" :
    ["invalid_url", "not_found"].includes(status) ? "configuration" : status === "unavailable" ? "availability" :
    status === "too_large" ? "budget" : status === "invalid_response" ? "response" : "unknown";
  return [diagnostic(code, "connector_scan", at)];
}

export function accountDiagnostics(collection: FleetAccount["collection"]): Diagnostic[] {
  const error = collection.errorCode;
  if (error) {
    const code = error === "credentials_unavailable" ? "credentials" : error === "unauthorized" ? "permissions" :
      ["invalid_config", "scope_changed"].includes(error) ? "configuration" : error === "rate_limited" ? "rate_limit" :
      error === "provider_unavailable" ? "availability" : ["invalid_response", "unexpected_empty"].includes(error) ? "response" :
      ["scan_limit", "scan_timeout"].includes(error) ? "budget" : error === "lease_lost" ? "worker" : "unsupported";
    return [diagnostic(code, "inventory_collection", collection.lastAttemptAt)];
  }
  const code = collection.state === "needs_credentials" ? "credentials" : collection.state === "unsupported" ? "unsupported" :
    collection.state === "stale" ? "stale" : collection.state === "error" ? "unknown" : null;
  return code ? [diagnostic(code, "inventory_collection", collection.lastAttemptAt)] : [];
}
