import { NextResponse } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { observationInput, idempotencyKeySchema, validObservationTime, recordObservation, listObservations, ReportConflict, UnknownResource } from "@/lib/observations/report";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: false });
  if (!access.authorized) return createUnauthorizedResponse(access);
  const resourceId = new URL(req.url).searchParams.get("resourceId");
  if (resourceId !== null && !observationInput.shape.resourceId.safeParse(resourceId).success) return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return NextResponse.json({ observations: await listObservations(resourceId ?? undefined), limit: 100, authoritative: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Observation history unavailable" }, { status: 503 }); }
}
export async function POST(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: true, allowObservationKey: true });
  if (!access.authorized) return createUnauthorizedResponse(access);
  if (!access.user && !access.principalId) return NextResponse.json({ error: "Authenticated reporter required" }, { status: 401 });
  const body = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const input = observationInput.safeParse(body.data);
  const key = idempotencyKeySchema.safeParse(req.headers.get("idempotency-key"));
  if (!input.success || !key.success) return NextResponse.json({ error: "Invalid observation or missing Idempotency-Key. Send structured facts, never credentials or raw logs." }, { status: 400 });
  if (!validObservationTime(input.data)) return NextResponse.json({ error: "Observation timestamps must be recent, with a future expiry no more than 24 hours after observation" }, { status: 400 });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const reporter = access.principalId ?? (access.user ? `user:${access.user.id}` : "api:admin");
    const result = await recordObservation(input.data, reporter, key.data);
    return NextResponse.json({ ...result, accepted: true, authoritative: false, trust: "external_report_unverified" }, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ReportConflict ? 409 : error instanceof UnknownResource ? 404 : 503;
    return NextResponse.json({ error: status === 409 ? "Idempotency-Key already used for a different report" : status === 404 ? "Register this resource before reporting observations" : "Observation could not be recorded" }, { status });
  }
}
