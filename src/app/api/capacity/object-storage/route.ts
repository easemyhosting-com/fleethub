import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { compareManualObjectStorage } from "@/lib/capacity/object-storage";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Bounded, operator-only manual comparison. No database writes or provider calls. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Operator access required" }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  try {
    return NextResponse.json(compareManualObjectStorage(body.data), { headers });
  } catch {
    return NextResponse.json({ error: "Invalid object-storage comparison" }, { status: 400, headers });
  }
}
