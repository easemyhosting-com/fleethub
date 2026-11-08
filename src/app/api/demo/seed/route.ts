import { NextResponse } from "next/server";
import { queryClient } from "@/lib/db/client";
import { seedInitialIdentitiesAndAccounts } from "@/lib/db/bootstrap";
import { verifyApiAccess, createUnauthorizedResponse } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    await seedInitialIdentitiesAndAccounts();
    return NextResponse.json({
      success: true,
      message: "Sample sandbox fleet populated successfully.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    // Clear all seeded data
    await queryClient`DELETE FROM quota_samples`;
    await queryClient`DELETE FROM quota_meters`;
    await queryClient`DELETE FROM resources`;
    await queryClient`DELETE FROM network_gateways`;
    await queryClient`DELETE FROM provider_accounts`;
    await queryClient`DELETE FROM identity_contacts`;
    await queryClient`DELETE FROM identities`;

    return NextResponse.json({
      success: true,
      message: "All data cleared. FleetHub reset to clean slate.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
