import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";
import { confirmEmptyInventory, enqueueInventory } from "@/lib/inventory/service";
import { accountIdSchema, CollectionError } from "@/lib/inventory/model";

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const body = await readJsonWithLimit(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = z.strictObject({ accountId: accountIdSchema, confirmEmpty: z.boolean().optional() }).safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid account ID" }, { status: 400 });
  try {
    if (parsed.data.confirmEmpty) {
      if (!(await confirmEmptyInventory(parsed.data.accountId))) {
        return NextResponse.json({ error: "There is no empty scan awaiting confirmation for this account" }, { status: 409 });
      }
    } else {
      await enqueueInventory(parsed.data.accountId);
    }
    return NextResponse.json({ state: "queued" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CollectionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof Error && error.message === "Account not found") return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: "Inventory database unavailable" }, { status: 503 });
  }
}
