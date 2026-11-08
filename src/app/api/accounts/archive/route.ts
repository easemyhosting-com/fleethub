import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { AccountOwnerError, setAccountArchived } from "@/lib/fleet/accounts";
import { enqueueInventory } from "@/lib/inventory/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.strictObject({ accountId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/), archived: z.boolean() });

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can archive an account." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = input.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide an account and whether to archive it" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "Storage is unavailable" }, { status: 503, headers });
    const actor = auth.user?.email ?? auth.principalId ?? "api:admin";
    await setAccountArchived(parsed.data.accountId, parsed.data.archived, actor);
    // A restored account is scanned again right away; one that cannot be scanned (no credential, unsupported) simply stays as it is.
    if (!parsed.data.archived) await enqueueInventory(parsed.data.accountId).catch(() => undefined);
    return NextResponse.json({ success: true, message: parsed.data.archived ? "Account archived. Scanning and alerts are off; history is kept." : "Account restored. A fresh scan is queued." }, { headers });
  } catch (error) {
    if (error instanceof AccountOwnerError) return NextResponse.json({ error: error.message }, { status: 404, headers });
    return NextResponse.json({ error: "Archive change failed" }, { status: 500, headers });
  }
}
