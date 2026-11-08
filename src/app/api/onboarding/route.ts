import { NextResponse } from "next/server";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { requestSchema, SetupError, SetupInputError } from "@/lib/onboarding/model";
import { refreshStaleVaultSteps, saveSetupStep, skipSetupStep, verifySetupStep } from "@/lib/onboarding/service";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const access = await verifyApiAccess(req);
  if (!access.authorized) return createUnauthorizedResponse(access);
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "Setup database is unavailable" }, { status: 503 });
    return NextResponse.json(await refreshStaleVaultSteps(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Setup status is unavailable; check database and runtime configuration" }, { status: 503 });
  }
}
export async function POST(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: true });
  if (!access.authorized) return createUnauthorizedResponse(access);
  const body = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid setup request" }, { status: 400 });
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "Setup database is unavailable" }, { status: 503 });
    const { action, step } = parsed.data;
    const state = action === "save" ? await saveSetupStep(step, parsed.data.config) : action === "skip" ? await skipSetupStep(parsed.data.step) : await verifySetupStep(step);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Never return upstream bodies, URLs containing credentials, or schema diagnostics.
    const message = error instanceof SetupError ? error.message : "Setup could not be verified. Check bootstrap credentials, allowed origins, host enrollment, and scoped permissions, then retry.";
    return NextResponse.json({ error: message }, { status: error instanceof SetupInputError ? 400 : 422 });
  }
}
