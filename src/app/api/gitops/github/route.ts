import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, verifyApiAccess } from "@/lib/auth/guard";
import { getCanonicalOrigin } from "@/lib/auth/session";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { disconnectGithubAuthorization, githubConnectionStatus, GithubAuthorizationError, startGithubAuthorization } from "@/lib/gitops/github-authorization";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

async function operator(req: Request, requireWrite: boolean) {
  const auth = await verifyApiAccess(req, { requireWrite });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth) || !auth.user?.sid) {
    return NextResponse.json({ error: "A signed-in operator session is required." }, { status: 403, headers });
  }
  return { id: auth.user.id, sid: auth.user.sid };
}

async function withOperator(req: Request, requireWrite: boolean, action: (user: { id: string; sid: string }) => Promise<unknown>) {
  const user = await operator(req, requireWrite);
  if (user instanceof Response) return user;
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("storage unavailable");
    return NextResponse.json(await action(user), { headers });
  } catch (error) {
    if (error instanceof GithubAuthorizationError && error.code !== "unavailable") {
      return NextResponse.json({ error: error.code === "not_configured"
        ? "GitHub App authorization is not configured."
        : "Reconnect GitHub before disconnecting its authorization. You can also revoke it in GitHub settings." },
      { status: 409, headers });
    }
    return NextResponse.json({ error: "GitHub authorization is temporarily unavailable." }, { status: 503, headers });
  }
}

export function GET(req: Request) {
  return withOperator(req, false, async user => ({ status: await githubConnectionStatus(user.id) }));
}

export function POST(req: Request) {
  return withOperator(req, true, async user => ({ url: await startGithubAuthorization(user, getCanonicalOrigin(req)) }));
}

export function DELETE(req: Request) {
  return withOperator(req, true, async user => {
    const outcome = await disconnectGithubAuthorization(user.id);
    return { status: "disconnected", outcome };
  });
}
