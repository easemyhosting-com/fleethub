import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { aiConnectionInput } from "@/lib/ai/model";
import { deleteAiConnection, readAiConnection, saveAiConnection } from "@/lib/ai/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const forbidden = () => NextResponse.json({ error: "Operator access required" }, { status: 403, headers });
const unavailable = () => NextResponse.json({ error: "AI connection settings unavailable" }, { status: 503, headers });

async function operator(req: Request, requireWrite: boolean) {
  const auth = await verifyApiAccess(req, requireWrite ? { requireWrite: true } : undefined);
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  return isOperator(auth) ? null : forbidden();
}

export async function GET(req: Request) {
  const denied = await operator(req, false);
  if (denied) return denied;
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return NextResponse.json(await readAiConnection(), { headers });
  } catch { return unavailable(); }
}

export async function PUT(req: Request) {
  const denied = await operator(req, true);
  if (denied) return denied;
  const raw = await readJsonWithLimit<unknown>(req, 8 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const input = aiConnectionInput.safeParse(raw.data);
  if (!input.success) return NextResponse.json({ error: "Invalid AI connection settings" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return await saveAiConnection(input.data)
      ? NextResponse.json({ saved: true }, { headers })
      : NextResponse.json({ error: "Secret reference not found" }, { status: 404, headers });
  } catch { return unavailable(); }
}

export async function DELETE(req: Request) {
  const denied = await operator(req, true);
  if (denied) return denied;
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    await deleteAiConnection();
    return NextResponse.json({ removed: true }, { headers });
  } catch { return unavailable(); }
}
