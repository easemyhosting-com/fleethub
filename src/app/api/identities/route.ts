import { NextResponse } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { queryClient } from "@/lib/db/client";
import { projectSlug } from "@/lib/projects/schemas";
import { parseFilter } from "@/lib/fleet/filters";
import {
  getIdentitiesWithAccounts,
  getIdentityGraph,
  CreateIdentitySchema,
  AddContactSchema,
  LinkAccountSchema,
  UpdateProtectionSchema,
} from "@/lib/identity/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    // Ensure database and schema migrations are ready
    await bootstrapDatabase();

    const url = new URL(req.url);
    if (url.searchParams.has("project") && !projectSlug.safeParse(url.searchParams.get("project")).success) {
      return NextResponse.json({ error: "Invalid project slug" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const isGraph = url.searchParams.get("graph") === "true";
    const search = url.searchParams.get("search") || undefined;
    const provider = url.searchParams.get("provider") || undefined;
    const health = url.searchParams.get("health") || undefined;
    const protection = url.searchParams.get("protection") || undefined;
    const resourceCategory = url.searchParams.get("category") || undefined;
    const fleetFilter = parseFilter(url.searchParams);

    if (isGraph) {
      const graph = await getIdentityGraph({
        search,
        provider,
        health,
        protection,
        resourceCategory,
        ...fleetFilter,
      });

      return NextResponse.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        graph,
      });
    }

    const identities = await getIdentitiesWithAccounts(fleetFilter);
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      identities,
    });
  } catch (error: any) {
    console.error("[Identities API] GET error:", error.message);
    return NextResponse.json(
      {
        status: "error",
        error: "Identity request failed",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  const payloadResult = await readJsonWithLimit(req);
  if (!payloadResult.ok) {
    return NextResponse.json(
      { error: payloadResult.error, timestamp: new Date().toISOString() },
      { status: payloadResult.status }
    );
  }

  const { action, ...payload } = payloadResult.data || {};

  try {
    await bootstrapDatabase();

    switch (action) {
      case "create_identity": {
        const parsed = CreateIdentitySchema.safeParse(payload);
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues.map((i) => i.message).join(", ") },
            { status: 400 }
          );
        }

        const slug = parsed.data.displayName.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 32);
        const newId = `ident-${slug}-${Date.now().toString(36)}`;

        await queryClient`
          INSERT INTO identities (id, display_name, notes)
          VALUES (${newId}, ${parsed.data.displayName}, ${parsed.data.notes || null});
        `;

        return NextResponse.json({
          status: "created",
          identityId: newId,
          timestamp: new Date().toISOString(),
        });
      }

      case "add_contact": {
        const parsed = AddContactSchema.safeParse(payload);
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues.map((i) => i.message).join(", ") },
            { status: 400 }
          );
        }

        const contactId = `ct-${parsed.data.identityId}-${parsed.data.kind}-${Date.now().toString(36)}`;

        await queryClient.begin(async (sql) => {
          // If primary, unmark other primary contacts of this kind
          if (parsed.data.isPrimary) {
            await sql`
              UPDATE identity_contacts
              SET is_primary = false
              WHERE identity_id = ${parsed.data.identityId} AND kind = ${parsed.data.kind};
            `;
          }

          await sql`
            INSERT INTO identity_contacts (id, identity_id, kind, value, is_primary, is_verified, label)
            VALUES (
              ${contactId},
              ${parsed.data.identityId},
              ${parsed.data.kind},
              ${parsed.data.value.trim()},
              ${parsed.data.isPrimary},
              ${parsed.data.isVerified},
              ${parsed.data.label || null}
            );
          `;

        });

        return NextResponse.json({
          status: "contact_added",
          contactId,
          timestamp: new Date().toISOString(),
        });
      }

      case "link_account": {
        const parsed = LinkAccountSchema.safeParse(payload);
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues.map((i) => i.message).join(", ") },
            { status: 400 }
          );
        }

        const updated = await queryClient`
          UPDATE provider_accounts
          SET
            identity_id = ${parsed.data.identityId},
            login_email = COALESCE(${parsed.data.loginEmail || null}, login_email),
            role = COALESCE(${parsed.data.role ?? null}, role),
            is_protected = COALESCE(${parsed.data.isProtected ?? null}, is_protected),
            updated_at = NOW()
          WHERE id = ${parsed.data.accountId}
          RETURNING id;
        `;

        if (updated.length === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });

        return NextResponse.json({
          status: "account_linked",
          accountId: parsed.data.accountId,
          identityId: parsed.data.identityId,
          timestamp: new Date().toISOString(),
        });
      }

      case "update_protection": {
        const parsed = UpdateProtectionSchema.safeParse(payload);
        if (!parsed.success) {
          return NextResponse.json(
            { error: parsed.error.issues.map((i) => i.message).join(", ") },
            { status: 400 }
          );
        }

        // Authoritative stored account protection update
        const updated = await queryClient`
          UPDATE provider_accounts
          SET
            is_protected = ${parsed.data.isProtected},
            updated_at = NOW()
          WHERE id = ${parsed.data.accountId} RETURNING id;
        `;

        if (updated.length === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });

        return NextResponse.json({
          status: "protection_updated",
          accountId: parsed.data.accountId,
          isProtected: parsed.data.isProtected,
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action '${action}'. Valid actions: create_identity, add_contact, link_account, update_protection` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("[Identities API] POST error:", error.message);
    return NextResponse.json(
      { error: "Identity request failed", timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
