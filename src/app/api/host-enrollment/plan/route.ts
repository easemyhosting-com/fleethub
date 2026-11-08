import { NextResponse } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";
import { hostEnrollmentInput, planHostEnrollment } from "@/lib/enrollment/plan";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: false });
  if (!access.authorized) return createUnauthorizedResponse(access);
  const body = await readJsonWithLimit<unknown>(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = hostEnrollmentInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid public host description. Supply references, never SSH keys or tokens." }, { status: 400 });
  return NextResponse.json(planHostEnrollment(parsed.data), { headers: { "Cache-Control": "no-store" } });
}
