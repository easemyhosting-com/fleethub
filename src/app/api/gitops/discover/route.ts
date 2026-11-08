import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { maxTotalBytes } from "@/lib/gitops/parse";
import { applyDiscovery, propose } from "@/lib/gitops/register";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const maxDiscoveryFiles = 600;
const input = z.strictObject({
  files: z.array(z.strictObject({ path: z.string().max(300), content: z.string().max(200 * 1024) })).min(1).max(maxDiscoveryFiles),
  apply: z.boolean().default(false),
  selectAll: z.boolean().default(false),
  select: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,38}$/)).max(200).default([]),
  sourceRef: z.string().max(200).default("gitops upload"),
});

/** Operator-only. Without `apply` this is a dry run that writes nothing. With `apply` it registers only the selected project slugs. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can register projects from GitOps." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 4 * maxTotalBytes);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = input.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Send {files:[{path, content}], apply?, select?, sourceRef?}. YAML only, at most 600 files of 200 KB." }, { status: 400, headers });
  if (parsed.data.apply && !parsed.data.selectAll && !parsed.data.select.length) return NextResponse.json({ error: "Select at least one project to register" }, { status: 400, headers });
  try {
    if (!(await bootstrapDatabase()).success) throw new Error("unavailable");
    const proposal = propose(parsed.data.files);
    if (!parsed.data.apply) return NextResponse.json({ ...proposal, applied: false, executed: false }, { headers });
    const unknown = parsed.data.selectAll ? [] : parsed.data.select.filter(slug => !proposal.projects.some(project => project.slug === slug));
    if (unknown.length) return NextResponse.json({ error: `Not in this repository: ${unknown.slice(0, 5).join(", ")}` }, { status: 400, headers });
    return NextResponse.json({ ...(await applyDiscovery(parsed.data.files, parsed.data.selectAll ? ["*"] : parsed.data.select, parsed.data.sourceRef)), applied: true, executed: false }, { headers });
  } catch { return NextResponse.json({ error: "Discovery failed" }, { status: 503, headers }); }
}
