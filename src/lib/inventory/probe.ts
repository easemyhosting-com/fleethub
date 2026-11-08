import { collectInventory, supportsInventory, validateInventoryConfig } from "./collectors";
import { CollectionError, collectionError } from "./model";

const expectedProducts: Record<string, string[]> = {
  cloudflare: ["zone", "worker", "kv", "d1", "r2"],
  oracle: ["instance", "volume", "bootvolume", "bucket", "database"],
};

export type ProbeResult =
  | { ok: true; counts: Record<string, number>; total: number; missing: string[]; plan: "free" | "paid" | null }
  | { ok: false; code: string; message: string; fields: readonly string[] };

/** Reads what a credential can see, without storing anything. A product the key cannot read is listed as missing, so a wrong policy shows up before the account is saved. */
export async function probeCredential(provider: string, config: unknown, signal: AbortSignal = AbortSignal.timeout(30_000)): Promise<ProbeResult> {
  if (!supportsInventory(provider)) return { ok: false, code: "unsupported", message: new CollectionError("unsupported").message, fields: [] };
  try {
    validateInventoryConfig(provider, config);
    const inventory = await collectInventory(provider, config, signal);
    const counts: Record<string, number> = {};
    for (const resource of inventory.resources) { const key = resource.product ?? resource.category; counts[key] = (counts[key] ?? 0) + 1; }
    const covered = new Set(inventory.covered ?? []);
    const missing = inventory.covered ? (expectedProducts[provider] ?? []).filter(product => !covered.has(product)) : [];
    return { ok: true, counts, total: inventory.resources.length, missing, plan: inventory.plan ?? null };
  } catch (error) {
    const failure = collectionError(error);
    return { ok: false, code: failure.code, message: failure.message, fields: failure.fields };
  }
}
