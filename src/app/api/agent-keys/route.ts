import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { AgentKeyLimitReached, createAgentKey, createAgentKeyInput, listAgentKeys, revokeAgentKey } from "@/lib/auth/agent-keys";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Agent key storage is unavailable" }, { status: 503, headers });
const idSchema = z.string().regex(/^agk-[0-9a-f-]{36}$/);

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: Only an operator or the administrative key can list agent keys." }, { status: 403, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json({ keys: await listAgentKeys() }, { headers });
  } catch { return unavailable(); }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const body = await readJsonWithLimit<unknown>(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = createAgentKeyInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide a label (1-80 characters) and expiresInDays (1-90)" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    const created = await createAgentKey(parsed.data, auth.user?.email ?? auth.principalId ?? "api:admin");
    return NextResponse.json({ ...created, notice: "Copy this key now. It cannot be shown again." }, { status: 201, headers });
  } catch (error) {
    if (error instanceof AgentKeyLimitReached) return NextResponse.json({ error: "Too many active agent keys. Revoke one first." }, { status: 409, headers });
    return unavailable();
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const id = idSchema.safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "A valid key id is required" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return (await revokeAgentKey(id.data))
      ? NextResponse.json({ success: true }, { headers })
      : NextResponse.json({ error: "Agent key not found" }, { status: 404, headers });
  } catch { return unavailable(); }
}
