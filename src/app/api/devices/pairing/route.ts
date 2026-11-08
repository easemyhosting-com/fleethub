import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { pairingPolicy, scopeAllowed } from "@/lib/pairing/policy";
import { cancelPairing, createPairing, listPairings, PairingLimitReached, pairingInput } from "@/lib/auth/sessions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Pairing storage is unavailable" }, { status: 503, headers });
const forbidden = () => NextResponse.json({ error: "Forbidden: Only a signed-in operator can pair devices." }, { status: 403, headers });
const idSchema = z.string().regex(/^pair-[0-9a-f-]{36}$/);

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return forbidden();
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json({ pairings: await listPairings(), options: pairingPolicy() }, { headers });
  } catch { return unavailable(); }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!auth.user || auth.scope !== "operator") return forbidden();
  const policy = pairingPolicy();
  if (!policy.enabled) return NextResponse.json({ error: "Device pairing is disabled on this server (FLEETHUB_DEVICE_PAIRING)." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = pairingInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide a label (1-80 characters), scope (read or operator) and expiresInMinutes (1-30)" }, { status: 400, headers });
  if (!scopeAllowed(policy, parsed.data.scope)) return NextResponse.json({ error: "This server only allows read-only devices (FLEETHUB_PAIRING_MAX_SCOPE)." }, { status: 403, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    const created = await createPairing(parsed.data, auth.user);
    return NextResponse.json({ ...created, notice: "Enter this code on the new device now. It works once and cannot be shown again." }, { status: 201, headers });
  } catch (error) {
    if (error instanceof PairingLimitReached) return NextResponse.json({ error: "Too many pending pairing codes. Cancel one or wait for it to expire." }, { status: 409, headers });
    return unavailable();
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return forbidden();
  const id = idSchema.safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "A valid pairing id is required" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return (await cancelPairing(id.data))
      ? NextResponse.json({ success: true }, { headers })
      : NextResponse.json({ error: "Pairing not found or already used" }, { status: 404, headers });
  } catch { return unavailable(); }
}
