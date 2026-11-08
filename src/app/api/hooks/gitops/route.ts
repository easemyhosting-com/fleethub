import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonWithLimit } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { maxFiles, maxTotalBytes } from "@/lib/gitops/parse";
import { syncProjectFromFiles, UnknownProject } from "@/lib/gitops/sync";
import { authenticateHook } from "@/lib/projects/hook-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const body = z.strictObject({ files: z.array(z.strictObject({ path: z.string().max(300), content: z.string().max(200 * 1024) })).min(1).max(maxFiles) });

/** A CI job in the GitOps repo pushes its manifests; FleetHub never needs a GitHub token for this path. Links are written only for the key's own project. */
export async function POST(req: Request) {
  try { if (!(await bootstrapDatabase()).success) throw new Error("unavailable"); } catch { return NextResponse.json({ error: "GitOps storage unavailable" }, { status: 503, headers }); }
  const auth = await authenticateHook(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers });
  const raw = await readJsonWithLimit<unknown>(req, maxTotalBytes + 64 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = body.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Send {files:[{path, content}]} with YAML manifests only (at most 200 files, 200 KB each)." }, { status: 400, headers });
  try {
    return NextResponse.json({ ...(await syncProjectFromFiles(auth.projectId, parsed.data.files)), accepted: true, executed: false }, { headers });
  } catch (error) {
    if (error instanceof UnknownProject) return NextResponse.json({ error: "Unknown or archived project" }, { status: 404, headers });
    return NextResponse.json({ error: "Manifests could not be processed" }, { status: 503, headers });
  }
}
