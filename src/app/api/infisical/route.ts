import { NextResponse } from "next/server";
import { getInfisicalStatus } from "@/lib/infisical/client";
import { queryClient } from "@/lib/db/client";
import {
  verifyApiAccess,
  createUnauthorizedResponse,
  readJsonWithLimit,
} from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  const status = await getInfisicalStatus();
  return NextResponse.json(status);
}

export async function POST(req: Request) {
  // Explicit write authorization check
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    const bodyRes = await readJsonWithLimit(req);
    if (!bodyRes.ok) {
      return NextResponse.json({ error: bodyRes.error }, { status: bodyRes.status });
    }
    const body = bodyRes.data || {};
    const action = body.action || "sync";

    if (action === "sync") {
      const status = await getInfisicalStatus();
      let syncedCount = 0;

      // Upsert discovered secret references into PostgreSQL without storing secret values
      for (const sec of status.secretReferences) {
        // Record what Infisical actually confirmed; a reference whose keys could not be listed stays pending.
        const verifiedAt = sec.status === "verified" ? new Date() : null;
        try {
          await queryClient`
            INSERT INTO secret_refs (id, label, infisical_project, environment, path, keys, status, last_verified_at)
            VALUES (${sec.id}, ${sec.provider}, ${sec.workspaceName}, ${sec.environment}, ${sec.path}, ${JSON.stringify(sec.keys)}::jsonb, ${sec.status}, ${verifiedAt})
            ON CONFLICT (id) DO UPDATE SET
              keys = EXCLUDED.keys,
              infisical_project = EXCLUDED.infisical_project,
              last_verified_at = COALESCE(EXCLUDED.last_verified_at, secret_refs.last_verified_at),
              status = EXCLUDED.status;
          `;
          syncedCount++;
        } catch (dbErr: any) {
          console.warn(`[DB] Error syncing secret ref ${sec.id}:`, dbErr.message);
        }
      }

      return NextResponse.json({
        success: true,
        message: `Synchronized ${syncedCount} Infisical secret references from ${status.workspaces.length} workspaces to PostgreSQL database.`,
        syncedCount,
        totalKeys: status.totalSecretKeys,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
