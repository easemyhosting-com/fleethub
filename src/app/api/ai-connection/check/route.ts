import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { aiCheckRequest } from "@/lib/ai/model";
import { checkAiConnection } from "@/lib/ai/probe";
import { readAiConnection, readAiKey } from "@/lib/ai/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// A write-scoped action: the check sends the stored key to the configured endpoint.
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Operator access required" }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const input = aiCheckRequest.safeParse(raw.data);
  if (!input.success) return NextResponse.json({ error: "State whether a billable test request is allowed" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return NextResponse.json({ error: "AI connection settings unavailable" }, { status: 503, headers });
    const { connection } = await readAiConnection();
    if (!connection) return NextResponse.json({ error: "Save an AI connection first" }, { status: 409, headers });
    // Compare the displayed settings as well as the timestamp, including saves within the same millisecond.
    if (JSON.stringify(input.data.expectedConnection) !== JSON.stringify(connection)) return NextResponse.json({ error: "Connection changed; reload and confirm consent again" }, { status: 409, headers });
    return NextResponse.json(await checkAiConnection(connection, { ...input.data, readKey: readAiKey }), { headers });
  } catch {
    return NextResponse.json({ error: "AI connection check failed; check the endpoint and allowed origins" }, { status: 422, headers });
  }
}
