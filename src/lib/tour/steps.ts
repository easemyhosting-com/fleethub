export type TourAction = "auth" | "setup" | "provider";
export type TourStep = { id: string; title: string; body: string[]; note?: string; action?: { kind: TourAction; label: string } };

export const tourStorageKey = "fleethub.guided-tour.v1";

export const tourSteps: readonly TourStep[] = [
  { id: "welcome", title: "What FleetHub is", body: ["FleetHub is your personal inventory of cloud accounts and what they contain: services, databases, and later storage, quotas and files.", "It reads and records. It does not deploy, restart, or change anything on your accounts or servers."], note: "Oracle (OCI) servers are always protected and inventory-only." },
  { id: "operator", title: "1. Create the operator", body: ["The first person to register becomes the operator. Use the bootstrap token from your private setup file (FLEETHUB_BOOTSTRAP_TOKEN) in the Access & Auth dialog.", "Registration closes once an operator exists. Remove the bootstrap token from your running environment afterwards."], action: { kind: "auth", label: "Open Access & Auth" } },
  { id: "setup", title: "2. Connect your services (optional at first)", body: ["Setup connects a credential store, either the built-in encrypted store or an existing Infisical, plus optional Tailscale (your private network) and CLIProxy (the AI gateway).", "You can skip this for now. Without it you can still register accounts and add resources by hand; storing provider credentials requires one verified credential store. Tailscale and CLIProxy never gate inventory."], action: { kind: "setup", label: "Open setup connections" } },
  { id: "account", title: "3. Register an account", body: ["Choose a provider and either register it inventory-only, or attach management credentials once setup is verified. Credentials go to the verified store: Infisical when connected, otherwise the built-in encrypted store.", "Automatic read-only collection exists for Cloudflare, Upstash, Supabase, Neon and OCI. Other providers are manual."], action: { kind: "provider", label: "Connect a provider" } },
  { id: "resources", title: "4. Read the inventory honestly", body: ["Each resource shows whether it was collected or entered manually, how fresh it is, and whether it is protected.", "Stale means the last check is old; missing means a complete scan no longer found it. A failed scan keeps the last good snapshot and says so."], note: "Unknown is never shown as zero: quota and capacity stay unknown until they are actually measured." },
  { id: "agents", title: "5. Let your agents read it", body: ["Create a read-only key per agent under Agent access (shown once, expires, revocable). Run npm run build:mcp, then point an MCP client at: node build/mcp-stdio.mjs with FLEETHUB_URL and that key in FLEETHUB_READONLY_KEY.", "It offers read-only tools only, using the same stored inventory as this dashboard. There are no shell, secret or execution tools."], note: "To use FleetHub from a phone, pair it under Devices & sessions (one-time code, read-only by default). You can reopen this tour any time from Guided tour in the sidebar." },
];

type TourStorage = Pick<Storage, "getItem" | "setItem">;

export function shouldAutoStartTour(storage: TourStorage | undefined): boolean {
  if (!storage) return false;
  try { return storage.getItem(tourStorageKey) !== "done"; } catch { return false; }
}

export function markTourDone(storage: TourStorage | undefined): void {
  try { storage?.setItem(tourStorageKey, "done"); } catch { /* A blocked store only means the tour may reappear. */ }
}
