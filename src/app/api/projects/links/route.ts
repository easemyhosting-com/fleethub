import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { decideLink } from "@/lib/gitops/sync";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.strictObject({ projectId: z.string().regex(/^prj-[0-9a-f-]{36}$/), resourceId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/), decision: z.enum(["confirm", "reject", "clear"]) });

/** The owner's decision on a suggested link. Remembered across syncs. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can decide links." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 2 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = input.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide projectId, resourceId and decision (confirm, reject or clear)" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return (await decideLink(parsed.data.projectId, parsed.data.resourceId, parsed.data.decision, auth.user?.email ?? auth.principalId ?? "api:admin"))
      ? NextResponse.json({ ok: true }, { headers }) : NextResponse.json({ error: "Unknown project" }, { status: 404, headers });
  } catch { return NextResponse.json({ error: "Decision could not be saved" }, { status: 503, headers }); }
}
