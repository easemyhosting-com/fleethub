import { NextResponse } from "next/server";
import { createGoogleOAuthFlow, getCanonicalOrigin, isGoogleAuthEnabled } from "@/lib/auth/session";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { checkAuthRateLimit } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!await checkAuthRateLimit(req, false)) return NextResponse.json({ error: "Too many authentication attempts" }, { status: 429 });
  } catch {
    return NextResponse.json({ error: "Authentication rate limiter is unavailable." }, { status: 503 });
  }
  if (!isGoogleAuthEnabled()) {
    return NextResponse.json({ error: "Google authentication is not configured." }, { status: 503 });
  }
  try {
    const origin = getCanonicalOrigin(req);
    const bootstrap = await bootstrapDatabase();
    if (!bootstrap.success) throw new Error("OAuth persistence unavailable");
    const flow = await createGoogleOAuthFlow(origin, req);
    const accept = req.headers.get("accept") || "";
    const res = accept.includes("application/json")
      ? NextResponse.json({ url: flow.url })
      : NextResponse.redirect(flow.url);
    res.headers.set("Set-Cookie", flow.cookie);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ error: "Google authentication is temporarily unavailable." }, { status: 503 });
  }
}
