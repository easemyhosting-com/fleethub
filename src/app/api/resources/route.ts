import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";
import { manualResourceInput } from "@/lib/inventory/model";

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  const body = await readJsonWithLimit(req);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const parsed = manualResourceInput.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ error: "Invalid manual resource" }, { status: 400 });
  const input = parsed.data;
  try {
    const id = "manual-" + createHash("sha256").update(JSON.stringify([input.accountId, input.nativeId])).digest("hex");
    const inserted = await queryClient`
      INSERT INTO resources(id, name, category, provider, account_id, account_email, state,
        is_protected, native_id, region, inventory_source, tags, attributes)
      SELECT ${id}, ${input.name}, ${input.category}, a.kind, a.id,
        a.owner_email, 'unknown', a.is_protected OR a.kind = 'oracle',
        ${input.nativeId}, ${input.region ?? null}, 'manual', '[]', '{}'
      FROM provider_accounts a WHERE a.id = ${input.accountId}
      ON CONFLICT(id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
        region = EXCLUDED.region, is_protected = resources.is_protected OR EXCLUDED.is_protected
      WHERE resources.account_id = EXCLUDED.account_id AND resources.inventory_source = 'manual'
    `;
    if (inserted.count === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json({ id, state: "unknown" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Inventory database unavailable" }, { status: 503 });
  }
}
