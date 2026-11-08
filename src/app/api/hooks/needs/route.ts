import { NextResponse } from "next/server";
import { readJsonWithLimit } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { authenticateHook } from "@/lib/projects/hook-auth";
import { idempotencyKey, needInput } from "@/lib/projects/schemas";
import { recordNeed, ReportConflict } from "@/lib/projects/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** A project says what it needs. Answers with a recommendation; reserves nothing, starts nothing. Does not require any usage report. */
export async function POST(req: Request) {
  try { if (!(await bootstrapDatabase()).success) throw new Error("unavailable"); } catch { return NextResponse.json({ error: "Needs storage unavailable" }, { status: 503, headers }); }
  const auth = await authenticateHook(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  const body = await readJsonWithLimit<unknown>(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const input = needInput.safeParse(body.data);
  const key = idempotencyKey.safeParse(req.headers.get("idempotency-key"));
  if (!input.success || !key.success) return NextResponse.json({ error: "Invalid need or missing Idempotency-Key. Send structured fields only; never credentials." }, { status: 400, headers });
  try {
    const result = await recordNeed(auth.projectId, key.data, input.data);
    return NextResponse.json({ ...result, accepted: true, executed: false }, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    if (error instanceof ReportConflict) return NextResponse.json({ error: "Idempotency-Key already used for a different need" }, { status: 409, headers });
    return NextResponse.json({ error: "Need could not be recorded" }, { status: 503, headers });
  }
}
