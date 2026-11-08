import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { AccountOwnerError, accountPlans, setAccountIdentity, setAccountLabel, setAccountOwner, setAccountPlan } from "@/lib/fleet/accounts";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const accountId = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/);
const input = z.union([
  z.strictObject({ accountId, ownerEmail: z.email().max(254) }),
  z.strictObject({ accountId, plan: z.enum(accountPlans) }),
  z.strictObject({ accountId, label: z.string().trim().min(1).max(200) }),
  z.strictObject({ accountId, identityId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/), email: z.email().max(254).optional() }),
]);

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can change an account's owner." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = input.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide an account and an identity or a valid owner email" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503, headers });
    const actor = auth.user?.email ?? auth.principalId ?? "api:admin";
    if ("plan" in parsed.data) { await setAccountPlan(parsed.data.accountId, parsed.data.plan, actor); return NextResponse.json({ success: true, message: "Plan updated." }, { headers }); }
    if ("label" in parsed.data) { await setAccountLabel(parsed.data.accountId, parsed.data.label, actor); return NextResponse.json({ success: true, message: "Label updated." }, { headers }); }
    if ("identityId" in parsed.data) await setAccountIdentity(parsed.data.accountId, parsed.data.identityId, actor, parsed.data.email);
    else await setAccountOwner(parsed.data.accountId, parsed.data.ownerEmail, actor);
    return NextResponse.json({ success: true, message: "Account owner updated." }, { headers });
  } catch (error) {
    if (error instanceof AccountOwnerError) return NextResponse.json({ error: error.message }, { status: 404, headers });
    return NextResponse.json({ error: "Owner change failed" }, { status: 500, headers });
  }
}
