import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { deleteAllowance, LimitsError, listLimits, setAllowance, setEntitlement } from "@/lib/entitlements/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const entitlementId = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+){2}$/);
const url = z.url().max(2048).refine(value => /^https?:$/.test(new URL(value).protocol));
const input = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("set_entitlement"), id: entitlementId, limit: z.number().min(0).max(1e12).optional(),
    verification: z.enum(["verified", "reported", "unverified"]).optional(), note: z.string().max(500).nullable().optional(),
    sourceUrl: url.nullable().optional(), verifiedAt: z.iso.date().nullable().optional(),
  }),
  z.strictObject({
    action: z.literal("set_allowance"), entitlementId, scopeType: z.enum(["global", "account"]),
    scopeId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/).optional(), limit: z.number().min(0).max(1e12), reason: z.string().max(500).optional(),
  }),
  z.strictObject({ action: z.literal("delete_allowance"), id: z.string().regex(/^alw-[0-9a-f-]{36}$/) }),
]);
const unavailable = () => NextResponse.json({ error: "Limits storage is unavailable" }, { status: 503, headers });

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json(await listLimits(), { headers });
  } catch { return unavailable(); }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can change limits." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = input.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid limits request" }, { status: 400, headers });
  const actor = auth.user?.email ?? auth.principalId ?? "api:admin";
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    const request = parsed.data;
    if (request.action === "set_entitlement") { const { action: _action, id, ...change } = request; await setEntitlement(id, change, actor); }
    else if (request.action === "set_allowance") { const { action: _action, ...rest } = request; await setAllowance(rest, actor); }
    else await deleteAllowance(request.id, actor);
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    if (error instanceof LimitsError) return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400, headers });
    return NextResponse.json({ error: "Limits change failed" }, { status: 500, headers });
  }
}
