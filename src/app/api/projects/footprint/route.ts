import { NextResponse } from "next/server";
import { createUnauthorizedResponse, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { readFootprints, readOrphans, readUsedBy } from "@/lib/projects/footprint";
import { projectSlug, resourceIdParam } from "@/lib/projects/schemas";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Read-only: project footprints, orphan resources and the resource to projects map; `?resource=` reads one resource's links. */
export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const params = new URL(req.url).searchParams;
  const slug = params.get("project");
  const resource = params.get("resource");
  if (slug !== null && !projectSlug.safeParse(slug).success) return NextResponse.json({ error: "Invalid project slug" }, { status: 400, headers });
  if (resource !== null && (slug !== null || !resourceIdParam.safeParse(resource).success)) return NextResponse.json({ error: "Invalid resource ID" }, { status: 400, headers });
  if (params.get("confirmedOnly") === "true" && !slug) return NextResponse.json({ error: "confirmedOnly requires a project slug" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    if (resource !== null) return NextResponse.json({ ...(await readUsedBy(resource)), authoritative: false }, { headers });
    const [projects, orphans, links] = await Promise.all([readFootprints(slug ?? undefined, params.get("confirmedOnly") === "true"), slug ? Promise.resolve([]) : readOrphans(), slug ? Promise.resolve({ usedBy: {}, truncated: false }) : readUsedBy()]);
    return NextResponse.json({ projects, orphans, usedBy: links.usedBy, usedByTruncated: links.truncated, authoritative: false }, { headers });
  } catch { return NextResponse.json({ error: "Project footprint unavailable" }, { status: 503, headers }); }
}
