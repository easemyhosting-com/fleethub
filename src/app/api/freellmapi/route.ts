import { NextResponse } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const access = await verifyApiAccess(req, { requireWrite: false });
  if (!access.authorized) return createUnauthorizedResponse(access);
  return NextResponse.json({
    status: "unavailable",
    models: [], keyPools: [], quotas: [],
    message: "Gateway model, key-pool and usage collection is not connected. Use the verified CLIProxy console from Setup connections.",
    telemetry: { status: "unavailable", gatewayUrl: null, webUiUrl: null, analytics: null },
  }, { headers: { "Cache-Control": "no-store" } });
}
