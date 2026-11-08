import { NextResponse } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse } from "@/lib/auth/guard";
import { parseFilter } from "@/lib/fleet/filters";
import { readSnapshot } from "@/lib/inventory/snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  try {
    const params = new URL(req.url).searchParams;
    return NextResponse.json(await readSnapshot({
      accountId: params.get("accountId") ?? undefined,
      ownerEmail: params.get("ownerEmail") ?? undefined,
      ...parseFilter(params),
    }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable", error: "Inventory database unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
