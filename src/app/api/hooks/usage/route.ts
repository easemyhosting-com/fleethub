import { NextResponse } from "next/server";
import { readJsonWithLimit } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { authenticateHook } from "@/lib/projects/hook-auth";
import { idempotencyKey, usageInput, validUsagePeriod } from "@/lib/projects/schemas";
import { recordUsage, ReportConflict } from "@/lib/projects/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** A project reports what it actually uses. Accepted even if it never declared a need; unmatched references are kept, not rejected. */
export async function POST(req: Request) {
  try { if (!(await bootstrapDatabase()).success) throw new Error("unavailable"); } catch { return NextResponse.json({ error: "Usage storage unavailable" }, { status: 503, headers }); }
  const auth = await authenticateHook(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  const body = await readJsonWithLimit<unknown>(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const input = usageInput.safeParse(body.data);
  const key = idempotencyKey.safeParse(req.headers.get("idempotency-key"));
  if (!input.success || !key.success) return NextResponse.json({ error: "Invalid usage report or missing Idempotency-Key. Send structured numbers only; never credentials or logs." }, { status: 400, headers });
  if (!validUsagePeriod(input.data)) return NextResponse.json({ error: "Usage period must end now or earlier, start within 31 days, and span at most 31 days" }, { status: 400, headers });
  try {
    const result = await recordUsage(auth.projectId, key.data, input.data);
    return NextResponse.json({ ...result, accepted: true, trust: "project_reported_unverified" }, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    if (error instanceof ReportConflict) return NextResponse.json({ error: "Idempotency-Key already used for a different report" }, { status: 409, headers });
    return NextResponse.json({ error: "Usage could not be recorded" }, { status: 503, headers });
  }
}
