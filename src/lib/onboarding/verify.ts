import { SetupError } from "./model";
import { networkInterfaces } from "node:os";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { configSchemas, type StepId } from "./model";
import { approvedApiUrl, requestJson } from "./transport";
import { verifyVault } from "./vault";
import { countUnreadableSecrets, createBuiltinVault } from "@/lib/vault/builtin";
import { randomBytes, randomUUID } from "node:crypto";

async function verifyBuiltin() {
  const vault = createBuiltinVault();
  const name = `FLEETHUB_PROBE_${randomUUID().replaceAll("-", "")}`;
  const value = randomBytes(32).toString("hex");
  await vault.write(name, value);
  try {
    if (await vault.read(name) !== value) throw new SetupError("Built-in store round-trip did not match");
  } catch (error) {
    // Keep the original failure; a cleanup error must not replace it.
    await vault.remove(name).catch(() => console.error("[Setup] Could not remove a built-in store verification probe"));
    throw error;
  }
  try { await vault.remove(name); }
  catch { throw new SetupError("The built-in store accepted a write but could not delete it"); }
  const unreadable = await countUnreadableSecrets();
  if (unreadable > 0) throw new SetupError(`${unreadable} stored secret${unreadable === 1 ? "" : "s"} cannot be decrypted with the current FLEETHUB_SECRET_STORE_KEY. Restore the key they were saved with; FleetHub stays not ready until then`);
}

async function verifyTailscale(config: z.infer<typeof configSchemas.tailscale>) {
  const token = process.env.TAILSCALE_API_TOKEN;
  if (!token) throw new SetupError("Configure TAILSCALE_API_TOKEN on the server");
  const authMode = process.env.TAILSCALE_API_AUTH || "basic";
  if (!["basic", "bearer"].includes(authMode)) throw new SetupError("TAILSCALE_API_AUTH must be basic or bearer");
  const devices = z.object({ devices: z.array(z.object({
    id: z.string(), nodeId: z.string().optional(), authorized: z.boolean(),
    addresses: z.array(z.string()), lastSeen: z.string(),
  })) }).parse(await requestJson(`https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(config.tailnet)}/devices`, {
    headers: { Authorization: authMode === "bearer" ? `Bearer ${token}` : `Basic ${Buffer.from(`${token}:`).toString("base64")}` },
  }));
  const device = devices.devices.find(item => item.id === config.deviceId || item.nodeId === config.deviceId);
  if (!device?.authorized || !Number.isFinite(Date.parse(device.lastSeen)) || Math.abs(Date.now() - Date.parse(device.lastSeen)) > 5 * 60 * 1000) {
    throw new SetupError("Select the authorized, recently online FleetHub host device in this tailnet");
  }
  const localAddresses = Object.values(networkInterfaces()).flatMap(interfaces => interfaces?.map(item => item.address) ?? []);
  if (device.addresses.some(address => localAddresses.includes(address))) return;
  const statusFile = process.env.TAILSCALE_STATUS_FILE;
  if (statusFile) {
    const metadata = await stat(statusFile);
    if (metadata.size > 1024 * 1024 || Math.abs(Date.now() - metadata.mtimeMs) > 5 * 60 * 1000) throw new SetupError("Refresh the host Tailscale status snapshot before verification");
    const status = z.object({ BackendState: z.literal("Running"), Self: z.object({ ID: z.string(), TailscaleIPs: z.array(z.string()) }) }).parse(JSON.parse(await readFile(statusFile, "utf8")));
    if ([device.id, device.nodeId].includes(status.Self.ID) && device.addresses.some(address => status.Self.TailscaleIPs.includes(address))) return;
  }
  throw new SetupError("FleetHub host enrollment is unverified; expose its Tailscale interface or configure a fresh TAILSCALE_STATUS_FILE snapshot");
}

export async function verifyStep(id: StepId, config: Record<string, unknown>): Promise<void> {
  if (id === "tailscale") return verifyTailscale(configSchemas.tailscale.parse(config));
  if (id === "infisical") return verifyVault(configSchemas.infisical.parse(config));
  if (id === "builtin") { configSchemas.builtin.parse(config); return verifyBuiltin(); }
  const parsed = configSchemas.cliproxy.parse(config);
  const base = approvedApiUrl(parsed.apiUrl);
  const apiKey = process.env.CLIPROXY_API_KEY;
  const managementKey = process.env.CLIPROXY_MANAGEMENT_KEY;
  if (!apiKey || !managementKey) throw new SetupError("Configure CLIPROXY_API_KEY and CLIPROXY_MANAGEMENT_KEY separately on the server");
  z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await requestJson(`${base}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } }));
  z.object({ files: z.array(z.unknown()) }).parse(await requestJson(`${base}/v8/management/credentials`, { headers: { Authorization: `Bearer ${managementKey}` } }));
}
