import { NextResponse } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse } from "@/lib/auth/guard";
import { getAgentContext } from "@/lib/agent-context/context";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: false });
  if (!access.authorized) return createUnauthorizedResponse(access);
  const context = await getAgentContext();
  return NextResponse.json(context, { status: context.inventory.status === "unavailable" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
