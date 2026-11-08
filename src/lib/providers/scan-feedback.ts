import type { ProbeResult } from "@/lib/inventory/probe";

export function describeProbe(result: ProbeResult): string {
  if (!result.ok) return `${result.message}${result.fields.length ? ` Check: ${result.fields.join(", ")}.` : ""}`;
  const seen = Object.entries(result.counts).map(([product, count]) => `${product} ${count}`).join(", ");
  const base = result.total === 0 ? "Credentials work; nothing found yet." : `Credentials work. Found ${result.total}: ${seen}.`;
  const missing = result.missing.length ? ` Cannot read: ${result.missing.join(", ")}. Widen the read permissions if you want those listed.` : "";
  return `${base}${missing}${result.plan ? ` Plan: ${result.plan}.` : ""}`;
}

export interface ScanState { state: string; resourceCount: number; message: string }

/** The first scan after connecting, in words: still running, done with a count, or the exact failure. */
export function describeScan(collection: ScanState | undefined): { done: boolean; ok: boolean; message: string } {
  if (!collection) return { done: false, ok: true, message: "Connected. Waiting for the first scan to start…" };
  if (collection.state === "ready") return { done: true, ok: true, message: `First scan done: found ${collection.resourceCount} resource${collection.resourceCount === 1 ? "" : "s"}.` };
  if (collection.state === "error") return { done: true, ok: false, message: `First scan failed: ${collection.message}` };
  if (collection.state === "running") return { done: false, ok: true, message: "Connected. Scanning now…" };
  return { done: false, ok: true, message: "Connected. First scan is queued…" };
}
