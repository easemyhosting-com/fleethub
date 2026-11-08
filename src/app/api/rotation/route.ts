import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { configureRotation, listRotation, replaceCredentials, rotateNow, setManualExpiry } from "@/lib/rotation/service";
import { RotationError } from "@/lib/rotation/types";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const accountId = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/);
const input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("replace"), accountId, config: z.record(z.string(), z.unknown()) }),
  z.strictObject({ action: z.literal("rotate"), accountId }),
  z.strictObject({ action: z.literal("expiry"), accountId, expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value))).nullable() }),
  z.strictObject({
    action: z.literal("configure"), accountId, rotatorSecret: z.string().min(1).max(4096).optional(),
    scheduleDays: z.number().int().min(1).max(365).nullable().optional(), removeRotator: z.boolean().optional(),
  }),
]);
const statusFor = { not_found: 404, not_supported: 400, rotator_missing: 400, invalid_config: 400, scope_mismatch: 409, busy: 409, vault_unavailable: 503, provider_rejected: 502, store_failed_after_roll: 500 } as const;
const unavailable = () => NextResponse.json({ error: "Rotation storage is unavailable" }, { status: 503, headers });

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json(await listRotation(), { headers });
  } catch { return unavailable(); }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can change credentials." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = input.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid rotation request" }, { status: 400, headers });
  const actor = auth.user?.email ?? auth.principalId ?? "api:admin";
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    const request = parsed.data;
    if (request.action === "replace") {
      await replaceCredentials(request.accountId, request.config, "manual", actor);
      return NextResponse.json({ success: true, message: "Credentials replaced and stored in the vault. A fresh collection is queued." }, { headers });
    }
    if (request.action === "expiry") {
      await setManualExpiry(request.accountId, request.expiresOn, actor);
      return NextResponse.json({ success: true, message: request.expiresOn ? "Expiry date saved. FleetHub will warn before it." : "Expiry date cleared." }, { headers });
    }
    if (request.action === "rotate") {
      await rotateNow(request.accountId, "rotate", actor);
      return NextResponse.json({ success: true, message: "Credential rotated and stored in the vault. A fresh collection is queued." }, { headers });
    }
    await configureRotation(request.accountId, request, actor);
    return NextResponse.json({ success: true, message: request.removeRotator ? "Rotation credential removed." : "Rotation settings saved." }, { headers });
  } catch (error) {
    if (error instanceof RotationError) {
      const fields = error.fields.length ? `. Check: ${error.fields.join(", ")}` : "";
      return NextResponse.json({ error: `${error.message}${fields}`, code: error.code }, { status: statusFor[error.code], headers });
    }
    return NextResponse.json({ error: "Credential change failed" }, { status: 500, headers });
  }
}
