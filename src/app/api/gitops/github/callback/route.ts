import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, verifyApiAccess } from "@/lib/auth/guard";
import { getCanonicalOrigin } from "@/lib/auth/session";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { finishGithubAuthorization } from "@/lib/gitops/github-authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth) || !auth.user?.sid) {
    return NextResponse.json({ error: "A signed-in operator session is required." }, { status: 403, headers });
  }
  let origin: string;
  try { origin = getCanonicalOrigin(req); } catch {
    return NextResponse.json({ error: "GitHub authorization origin is unavailable." }, { status: 503, headers });
  }
  const next = new URL("/?view=projects&github_connection=failed", origin);
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("storage unavailable");
    const params = new URL(req.url).searchParams;
    const code = params.has("error") ? null : params.get("code");
    if (await finishGithubAuthorization({ id: auth.user.id, sid: auth.user.sid }, origin, params.get("state"), code)) {
      next.searchParams.set("github_connection", "connected");
    }
  } catch { /* Return a bounded status. Never include provider response or authorization parameters. */ }
  return NextResponse.redirect(next, { status: 303, headers });
}
