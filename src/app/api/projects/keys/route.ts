import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createProjectKey, ProjectKeyLimitReached, revokeProjectKey, UnknownProject } from "@/lib/projects/keys";
import { createProjectKeyInput } from "@/lib/projects/schemas";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Project key storage unavailable" }, { status: 503, headers });

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can issue project keys." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 2 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = createProjectKeyInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide projectId and optional expiresInDays (1-365)" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    const created = await createProjectKey(parsed.data.projectId, parsed.data.expiresInDays, auth.user?.email ?? auth.principalId ?? "api:admin");
    return NextResponse.json({ ...created, notice: "Copy this key now. It cannot be shown again." }, { status: 201, headers });
  } catch (error) {
    if (error instanceof UnknownProject) return NextResponse.json({ error: "Unknown or archived project" }, { status: 404, headers });
    if (error instanceof ProjectKeyLimitReached) return NextResponse.json({ error: "Too many active project keys. Revoke one first." }, { status: 409, headers });
    return unavailable();
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can revoke project keys." }, { status: 403, headers });
  const id = z.string().regex(/^pkey-[0-9a-f-]{36}$/).safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Invalid key id" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return (await revokeProjectKey(id.data)) ? NextResponse.json({ revoked: true }, { headers }) : NextResponse.json({ error: "Key not found" }, { status: 404, headers });
  } catch { return unavailable(); }
}
