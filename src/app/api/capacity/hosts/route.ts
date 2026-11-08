import { NextResponse } from "next/server";
import { createUnauthorizedResponse, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { fit, parseAsk, reserve } from "@/lib/capacity/host";
import { readHostCapacities } from "@/lib/capacity/read";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Read-only. Declared requests per compute host against its size. Add ?cpu=500m&memory=256Mi to also test whether a new workload fits on each host. */
export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const url = new URL(req.url);
  const cpu = url.searchParams.get("cpu"), memory = url.searchParams.get("memory");
  const ask = cpu || memory ? parseAsk(cpu, memory) : null;
  if ((cpu || memory) && !ask) return NextResponse.json({ error: "cpu like 500m or 1 and memory like 256Mi or 1Gi" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const hosts = await readHostCapacities();
    return NextResponse.json({ hosts, fits: ask ? hosts.map(host => fit(host, ask)) : undefined, reserve, basis: "declared_requests", measured: false }, { headers });
  } catch { return NextResponse.json({ error: "Capacity unavailable" }, { status: 503, headers }); }
}
