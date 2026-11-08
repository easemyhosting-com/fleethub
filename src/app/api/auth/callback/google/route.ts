import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { queryClient } from "@/lib/db/client";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { checkAuthRateLimit } from "@/lib/auth/guard";
import {
  clearGoogleOAuthCookie,
  consumeGoogleOAuthFlow,
  createSessionToken,
  createSessionCookie,
  exchangeGoogleCodeForUser,
  getCanonicalOrigin,
  isGoogleAuthEnabled,
  type SessionUser,
} from "@/lib/auth/session";
import { createServerSession, describeClient } from "@/lib/auth/sessions";

export const dynamic = "force-dynamic";

function redirect(origin: string, req: Request, result: string, success = false): NextResponse {
  const key = success ? "auth_success" : "auth_error";
  const res = NextResponse.redirect(`${origin}/?${key}=${encodeURIComponent(result)}`);
  res.headers.set("Set-Cookie", clearGoogleOAuthCookie(req));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function isAllowedEmail(email: string): boolean {
  const configured = process.env.FLEETHUB_ALLOWED_EMAILS || "";
  return configured.split(",").some((allowed) => allowed.trim().toLowerCase() === email);
}

export async function GET(req: Request) {
  try {
    if (!await checkAuthRateLimit(req, false)) return NextResponse.json({ error: "Too many authentication attempts" }, { status: 429 });
  } catch {
    return NextResponse.json({ error: "Authentication rate limiter is unavailable." }, { status: 503 });
  }
  let origin: string;
  try {
    origin = getCanonicalOrigin(req);
  } catch {
    return NextResponse.json({ error: "Authentication origin is invalid." }, { status: 503 });
  }
  if (!isGoogleAuthEnabled()) return redirect(origin, req, "google_disabled");
  const url = new URL(req.url);
  const verifier = await consumeGoogleOAuthFlow(req, url.searchParams.get("state"));
  if (!verifier) return redirect(origin, req, "invalid_state");
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error || !code) return redirect(origin, req, error || "no_code");

  const googleUser = await exchangeGoogleCodeForUser(code, origin, verifier);
  if (!googleUser) return redirect(origin, req, "google_exchange_failed");

  try {
    const bootstrap = await bootstrapDatabase();
    if (!bootstrap.success) return redirect(origin, req, "persistence_unavailable");
    if (!isAllowedEmail(googleUser.email)) {
      return redirect(origin, req, "unauthorized_email");
    }
    const candidateId = `usr-g-${crypto.randomUUID()}`;
    const persisted = await queryClient`
      INSERT INTO app_users (id, email, name, auth_provider, google_sub)
      VALUES (${candidateId}, ${googleUser.email}, ${googleUser.name}, 'google', ${googleUser.sub})
      ON CONFLICT (google_sub) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id;
    `;
    const id = persisted[0]?.id;
    if (typeof id !== "string" || !id) return redirect(origin, req, "persistence_unavailable");
    const sessionUser: SessionUser = {
      id,
      email: googleUser.email,
      name: googleUser.name,
      provider: "google",
      createdAt: Date.now(),
    };
    const sid = await createServerSession(sessionUser, "browser", "operator", describeClient(req));
    const token = createSessionToken({ ...sessionUser, sid });
    const res = redirect(origin, req, "google", true);
    res.headers.append("Set-Cookie", createSessionCookie(token, req));
    return res;
  } catch {
    return redirect(origin, req, "persistence_unavailable");
  }
}
