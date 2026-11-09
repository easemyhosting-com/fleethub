import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { githubReadToken, GithubAuthorizationError } from "@/lib/gitops/github-authorization";
import { fetchRepoFiles, GithubError, isRepo } from "@/lib/gitops/github";
import { syncProjectFromFiles, UnknownProject } from "@/lib/gitops/sync";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.strictObject({
  projectId: z.string().regex(/^prj-[0-9a-f-]{36}$/),
  repo: z.string().refine(isRepo),
  branch: z.string().regex(/^[A-Za-z0-9_.\/-]{1,100}$/).default("main"),
  path: z.string().regex(/^[A-Za-z0-9_.\/-]{0,200}$/).refine(value => !value.split("/").includes("..")).default(""),
});
const messages: Record<GithubError["code"], [number, string]> = {
  not_configured: [409, "Connect a GitHub App, set FLEETHUB_GITHUB_READ_TOKEN on the server, or push manifests with the GitOps hook."],
  unauthorized: [502, "GitHub refused the credential for this repository. Check the app installation, or reconnect GitHub."], not_found: [404, "Repository, branch or path not found for this token."],
  rate_limited: [429, "GitHub rate limit reached. Try again later."], unavailable: [502, "GitHub is unavailable."], too_large: [413, "More than 200 YAML files under that path. Narrow the path."],
};

/** Operator-triggered, read-only pull of a GitOps repo path, then the same reconcile as the push hook. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can sync a repository." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 2 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = input.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide projectId, repo as owner/name, and optional branch and path" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const token = auth.user?.id ? await githubReadToken(auth.user.id) : undefined;
    const files = await fetchRepoFiles(parsed.data.repo, parsed.data.branch, parsed.data.path, req.signal, token);
    return NextResponse.json({ ...(await syncProjectFromFiles(parsed.data.projectId, files)), filesRead: files.length, executed: false }, { headers });
  } catch (error) {
    if (error instanceof GithubAuthorizationError) {
      const reconnect = error.code === "reconnect" || error.code === "invalid_refresh";
      return NextResponse.json({ error: reconnect ? "Reconnect GitHub to sync this repository." : "GitHub authorization is temporarily unavailable." },
        { status: reconnect ? 409 : 503, headers });
    }
    if (error instanceof GithubError) { const [status, message] = messages[error.code]; return NextResponse.json({ error: message }, { status, headers }); }
    if (error instanceof UnknownProject) return NextResponse.json({ error: "Unknown or archived project" }, { status: 404, headers });
    return NextResponse.json({ error: "Sync failed" }, { status: 503, headers });
  }
}
