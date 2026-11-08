import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { ConnectorError } from "@/lib/connectors/clients";
import { scanConnector, UnknownConnector } from "@/lib/connectors/service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.strictObject({ id: z.string().regex(/^conn-[0-9a-f-]{36}$/), apply: z.boolean().default(false), selectAll: z.boolean().default(false), select: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,38}$/)).max(200).default([]) });
const failures: Record<ConnectorError["code"], [number, string]> = {
  invalid_url: [400, "The connector URL is not allowed."], unauthorized: [502, "The target refused the credential (401)."], forbidden: [502, "The credential lacks permission for a required read (403). Grant list on deployments and statefulsets."],
  not_found: [502, "The target does not expose the expected API."], unavailable: [502, "The target is unreachable or timed out."], too_large: [502, "The target returned too much data."], invalid_response: [502, "The target returned something unexpected."],
};

/** Operator-only. Dry run unless `apply`. Calls the target with GET requests only. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can scan connectors." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 8 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = input.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide a connector id, and apply with select (or selectAll) to register" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return NextResponse.json({ ...(await scanConnector(parsed.data.id, { apply: parsed.data.apply, select: parsed.data.selectAll ? ["*"] : parsed.data.select })), executed: false }, { headers });
  } catch (error) {
    if (error instanceof ConnectorError) { const [status, message] = failures[error.code]; return NextResponse.json({ error: message }, { status, headers }); }
    if (error instanceof UnknownConnector) return NextResponse.json({ error: "Unknown connector" }, { status: 404, headers });
    return NextResponse.json({ error: "Scan failed" }, { status: 503, headers });
  }
}
