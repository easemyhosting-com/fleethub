import { NextResponse } from "next/server";
import { removeDemoSeed, seedInitialIdentitiesAndAccounts } from "@/lib/db/bootstrap";
import { verifyApiAccess, createUnauthorizedResponse, isOperator } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ success: false, error: "Forbidden: only an operator can change demo data." }, { status: 403 });

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }
  if (!isOperator(auth)) return forbidden();

  try {
    await seedInitialIdentitiesAndAccounts();
    return NextResponse.json({
      success: true,
      message: "Sample sandbox fleet populated successfully.",
    });
  } catch {
    return NextResponse.json({ success: false, error: "Demo data could not be seeded." }, { status: 500 });
  }
}

/** Removes only the demo rows, including those an older install seeded without the `demo-` prefix. Real inventory is never touched; if real data references a demo row, nothing is deleted. */
export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }
  if (!isOperator(auth)) return forbidden();

  try {
    await removeDemoSeed();

    return NextResponse.json({
      success: true,
      message: "Demo data removed. Other inventory is unchanged.",
    });
  } catch {
    return NextResponse.json({ success: false, error: "Demo data could not be removed. Nothing was deleted; other records may still reference it." }, { status: 500 });
  }
}
