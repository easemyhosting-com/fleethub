import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { probeCredential } from "@/lib/inventory/probe";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.strictObject({ providerId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), config: z.record(z.string(), z.unknown()) });

/** Test before save: lists what these credentials can read. Nothing is stored and nothing from the credential is returned. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can test credentials." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = input.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide a provider and its credential fields" }, { status: 400, headers });
  return NextResponse.json(await probeCredential(parsed.data.providerId, parsed.data.config), { headers });
}
