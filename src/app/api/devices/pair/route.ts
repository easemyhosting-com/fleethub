import { NextResponse } from "next/server";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { checkAuthRateLimit, readJsonWithLimit } from "@/lib/auth/guard";
import { createSessionCookie, createSessionToken, hasAuthSecret, isAllowedOrigin } from "@/lib/auth/session";
import { pairingPolicy } from "@/lib/pairing/policy";
import { deviceSessionDays, redeemInput, redeemPairing } from "@/lib/auth/sessions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });

export async function POST(req: Request) {
  try { if (!isAllowedOrigin(req)) return fail("Invalid request origin", 403); } catch { return fail("Invalid request origin", 403); }
  if ((req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin")) return fail("Invalid request origin", 403);
  try { if (!await checkAuthRateLimit(req)) return fail("Too many attempts. Wait a minute and try again.", 429); } catch { return fail("Pairing temporarily unavailable", 503); }
  if (!pairingPolicy().enabled) return fail("Device pairing is disabled on this server", 403);
  if (!hasAuthSecret()) return fail("Pairing temporarily unavailable", 503);
  const body = await readJsonWithLimit<unknown>(req, 2 * 1024);
  if (!body.ok) return fail(body.error, body.status);
  const parsed = redeemInput.safeParse(body.data);
  if (!parsed.success) return fail("Enter the pairing code shown on your signed-in device", 400);
  try {
    if (!(await bootstrapDatabase()).success) return fail("Pairing temporarily unavailable", 503);
    const redeemed = await redeemPairing(parsed.data.code, parsed.data.label, pairingPolicy().maxScope);
    if (!redeemed) return fail("Invalid, expired or already used pairing code", 401);
    const expiresAt = Date.now() + deviceSessionDays * 86_400_000;
    const token = createSessionToken({ ...redeemed.user, sid: redeemed.sid, exp: expiresAt });
    const response = NextResponse.json({ success: true, scope: redeemed.scope, label: redeemed.label, expiresAt: new Date(expiresAt).toISOString() }, { headers });
    response.headers.set("Set-Cookie", createSessionCookie(token, req, deviceSessionDays * 86_400));
    return response;
  } catch { return fail("Pairing temporarily unavailable", 503); }
}
