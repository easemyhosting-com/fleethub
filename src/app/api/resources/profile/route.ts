import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { ProfileError, setProfile } from "@/lib/fleet/profiles";
import { profileInputSchema } from "@/lib/fleet/vocabulary";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.object({ resourceId: z.string().min(1).max(256), profile: profileInputSchema });

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can label resources." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = input.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid resource profile" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503, headers });
    await setProfile(parsed.data.resourceId, parsed.data.profile, auth.user?.email ?? auth.principalId ?? "api:admin");
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    if (error instanceof ProfileError) return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 409, headers });
    return NextResponse.json({ error: "Profile change failed" }, { status: 500, headers });
  }
}
