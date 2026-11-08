import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, verifyApiAccess } from "@/lib/auth/guard";
import { getSessionFromRequest } from "@/lib/auth/session";
import { listSessions, revokeOtherSessions, revokeSession } from "@/lib/auth/sessions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Session storage is unavailable" }, { status: 503, headers });
const forbidden = () => NextResponse.json({ error: "Forbidden: Only an operator can manage sessions." }, { status: 403, headers });
const idSchema = z.string().regex(/^ses-[0-9a-f-]{36}$/);

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return forbidden();
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json({ sessions: await listSessions(), currentId: getSessionFromRequest(req)?.sid ?? null }, { headers });
  } catch { return unavailable(); }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return forbidden();
  const params = new URL(req.url).searchParams;
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    if (params.get("others") === "true") return NextResponse.json({ revoked: await revokeOtherSessions(getSessionFromRequest(req)?.sid) }, { headers });
    const id = idSchema.safeParse(params.get("id"));
    if (!id.success) return NextResponse.json({ error: "A valid session id is required" }, { status: 400, headers });
    return (await revokeSession(id.data))
      ? NextResponse.json({ success: true }, { headers })
      : NextResponse.json({ error: "Session not found" }, { status: 404, headers });
  } catch { return unavailable(); }
}
