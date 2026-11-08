import { NextResponse } from "next/server";
import { createUnauthorizedResponse, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { readFootprints, readOrphans, readUsedBy } from "@/lib/projects/footprint";
import { projectSlug } from "@/lib/projects/schemas";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Read-only: project footprints, orphan resources and the resource to projects map. */
export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const slug = new URL(req.url).searchParams.get("project");
  if (slug !== null && !projectSlug.safeParse(slug).success) return NextResponse.json({ error: "Invalid project slug" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const [projects, orphans, usedBy] = await Promise.all([readFootprints(slug ?? undefined), slug ? Promise.resolve([]) : readOrphans(), slug ? Promise.resolve({}) : readUsedBy()]);
    return NextResponse.json({ projects, orphans, usedBy, authoritative: false }, { headers });
  } catch { return NextResponse.json({ error: "Project footprint unavailable" }, { status: 503, headers }); }
}
