import { NextResponse } from "next/server";
import { createUnauthorizedResponse, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { getSetupState } from "@/lib/onboarding/service";
import { inspectCliProxy } from "@/lib/cliproxy/capabilities";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: true });
  if (!access.authorized) return createUnauthorizedResponse(access);
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "Setup database is unavailable" }, { status: 503, headers });
    const step = (await getSetupState()).steps.find(item => item.id === "cliproxy");
    if (!step || step.status === "unconfigured") return NextResponse.json({ error: "Save gateway connection settings first" }, { status: 409, headers });
    return NextResponse.json(await inspectCliProxy(step.config), { headers });
  } catch {
    return NextResponse.json({ error: "Gateway capabilities are unavailable; check saved settings and allowed origins" }, { status: 422, headers });
  }
}
