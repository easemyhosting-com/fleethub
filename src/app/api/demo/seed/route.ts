import { NextResponse } from "next/server";
import { queryClient } from "@/lib/db/client";
import { demoSeedIds, seedInitialIdentitiesAndAccounts } from "@/lib/db/bootstrap";
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

/** Removes only the fixed demo rows. Real inventory is never touched; if real data references a demo row, nothing is deleted. */
export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }
  if (!isOperator(auth)) return forbidden();

  try {
    await queryClient.begin(async tx => {
      await tx`DELETE FROM quota_meters WHERE account_id IN ${tx(demoSeedIds.accounts)}`;
      await tx`DELETE FROM resources WHERE id IN ${tx(demoSeedIds.resources)}`;
      await tx`DELETE FROM network_gateways WHERE id IN ${tx(demoSeedIds.gateways)}`;
      await tx`DELETE FROM provider_accounts WHERE id IN ${tx(demoSeedIds.accounts)}`;
      await tx`DELETE FROM identities WHERE id IN ${tx(demoSeedIds.identities)}`;
    });

    return NextResponse.json({
      success: true,
      message: "Demo data removed. Other inventory is unchanged.",
    });
  } catch {
    return NextResponse.json({ success: false, error: "Demo data could not be removed. Nothing was deleted; other records may still reference it." }, { status: 500 });
  }
}
