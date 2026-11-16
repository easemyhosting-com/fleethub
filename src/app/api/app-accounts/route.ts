import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { appAccountCommand } from "@/lib/app-accounts/model";
import { readAppAccounts, saveAppAccountCommand } from "@/lib/app-accounts/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// Contacts and credential relationships are visible only to operators, even on reads.
export async function GET(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Operator access required" }, { status: 403, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return NextResponse.json(await readAppAccounts(), { headers });
  } catch { return NextResponse.json({ error: "App accounts unavailable" }, { status: 503, headers }); }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Operator access required" }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const input = appAccountCommand.safeParse(raw.data);
  if (!input.success) return NextResponse.json({ error: "Invalid app-account metadata" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const id = await saveAppAccountCommand(input.data);
    return id ? NextResponse.json({ id }, { headers }) : NextResponse.json({ error: "Related record not found" }, { status: 404, headers });
  } catch { return NextResponse.json({ error: "App-account change could not be saved" }, { status: 503, headers }); }
}
