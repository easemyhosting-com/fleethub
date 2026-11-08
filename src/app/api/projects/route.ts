import { NextResponse } from "next/server";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { createProjectInput, updateProjectInput } from "@/lib/projects/schemas";
import { createProject, listProjects, SlugTaken, updateProject } from "@/lib/projects/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Project storage unavailable" }, { status: 503, headers });

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: false });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  try { if (!(await bootstrapDatabase()).success) return unavailable(); return NextResponse.json({ projects: await listProjects() }, { headers }); } catch { return unavailable(); }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can register projects." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = createProjectInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide slug (lowercase letters, digits, dashes), name, and optional https repoUrl, environment, criticality, notes" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return NextResponse.json(await createProject(parsed.data, null), { status: 201, headers });
  } catch (error) {
    if (error instanceof SlugTaken) return NextResponse.json({ error: "That project slug already exists" }, { status: 409, headers });
    return unavailable();
  }
}

/** Reclassify a project (app, service, platform) or rename it. A manual kind is kept across rescans; "auto" hands it back to discovery. */
export async function PATCH(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can change projects." }, { status: 403, headers });
  const body = await readJsonWithLimit<unknown>(req, 2 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status, headers });
  const parsed = updateProjectInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide projectId and a kind (app, service, platform, auto) or a name" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) return unavailable();
    return (await updateProject(parsed.data)) ? NextResponse.json({ ok: true }, { headers }) : NextResponse.json({ error: "Unknown project" }, { status: 404, headers });
  } catch { return unavailable(); }
}
