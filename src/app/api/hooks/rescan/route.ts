import { NextResponse } from "next/server";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createHash } from "node:crypto";
import { isRescanKeyFormat, lookupRescanKey, requestRescan } from "@/lib/connectors/schedule";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const requestsPerMinute = 30;
const windows = new Map<string, { count: number; start: number }>();
function allow(identity: string, now: number): boolean {
  for (const [key, entry] of windows) if (now - entry.start >= 60_000) windows.delete(key);
  const entry = windows.get(identity);
  if (!entry && windows.size >= 4096) return false;
  if (!entry) { windows.set(identity, { count: 1, start: now }); return true; }
  entry.count += 1;
  return entry.count <= requestsPerMinute;
}

/**
 * A Flux notification (generic provider) or any CI step asks for a rescan of one connector with that connector's rescan key as a bearer token.
 * It only marks the connector; the worker runs the scan. The body is ignored, so Flux events of any shape are accepted.
 */
export async function POST(req: Request) {
  const key = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!key) return NextResponse.json({ error: "Missing rescan key" }, { status: 401, headers });
  if (!isRescanKeyFormat(key)) return NextResponse.json({ error: "Invalid rescan key" }, { status: 401, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const known = await lookupRescanKey(key);
    const identity = known ? createHash("sha256").update(key).digest("hex") : "unknown";
    if (!allow(identity, Date.now())) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429, headers });
    if (!known) return NextResponse.json({ error: "Invalid rescan key" }, { status: 401, headers });
    const connector = await requestRescan(key);
    if (!connector) return NextResponse.json({ error: "Invalid rescan key" }, { status: 401, headers });
    return NextResponse.json({ accepted: true, connector: connector.label }, { status: 202, headers });
  } catch { return NextResponse.json({ error: "Connector storage unavailable" }, { status: 503, headers }); }
}
