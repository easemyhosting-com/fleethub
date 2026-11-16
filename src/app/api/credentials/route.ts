import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { genericCredentialInput, removeGenericCredential, storeGenericCredential, VaultNotReadyError } from "@/lib/vault/generic";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const removal = z.strictObject({ refId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/) });

async function operatorWrite(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  return isOperator(auth) ? null : NextResponse.json({ error: "Operator access required" }, { status: 403, headers });
}

/** Stores a new key and returns only its reference ID. The value is never echoed. */
export async function POST(req: Request) {
  const denied = await operatorWrite(req);
  if (denied) return denied;
  const raw = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const input = genericCredentialInput.safeParse(raw.data);
  if (!input.success) return NextResponse.json({ error: "Provide a label and a value of at most 8 KiB" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    return NextResponse.json({ id: await storeGenericCredential(input.data) }, { status: 201, headers });
  } catch (error) {
    if (error instanceof VaultNotReadyError) return NextResponse.json({ error: error.message }, { status: 409, headers });
    return NextResponse.json({ error: "Credential could not be stored" }, { status: 503, headers });
  }
}

/** Removes FleetHub's stored copy of an unused generic key. It does not revoke the key at its issuer. */
export async function DELETE(req: Request) {
  const denied = await operatorWrite(req);
  if (denied) return denied;
  const raw = await readJsonWithLimit<unknown>(req, 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const input = removal.safeParse(raw.data);
  if (!input.success) return NextResponse.json({ error: "Invalid reference" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    switch (await removeGenericCredential(input.data.refId)) {
      case "removed": return NextResponse.json({ removed: true, revokedUpstream: false }, { headers });
      case "missing": return NextResponse.json({ error: "Reference not found" }, { status: 404, headers });
      case "in_use": return NextResponse.json({ error: "Still used by an account, connector, ledger link or AI connection" }, { status: 409, headers });
      case "not_generic": return NextResponse.json({ error: "Only keys stored as generic credentials can be removed here" }, { status: 409, headers });
    }
  } catch { return NextResponse.json({ error: "Credential could not be removed" }, { status: 503, headers }); }
}
