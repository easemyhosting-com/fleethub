import { randomUUID } from "node:crypto";
import { supportsInventory, validateInventoryConfig } from "@/lib/inventory/collectors";
import { CollectionError } from "@/lib/inventory/model";
import { NextResponse } from "next/server";
import { queryClient } from "@/lib/db/client";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { pluginRegistry } from "@/lib/plugins/registry";
import "@/lib/plugins/defaults";
import { MASTER_CATALOG } from "@/lib/catalog/providers";
import { verifyApiAccess, createUnauthorizedResponse, readJsonWithLimit } from "@/lib/auth/guard";
import { classifyProviderConfig, providerOnboardingSchema, publicProviderMeta } from "@/lib/providers/config-security";
import { identityEmail } from "@/lib/fleet/accounts";
import { accountScope, findDuplicateAccount, recordAccountScope } from "@/lib/fleet/accounts";
import { AccountAttachmentError, registerVaultedAccount } from "@/lib/onboarding/provider-credentials";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await verifyApiAccess(req);
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    await bootstrapDatabase();

    const url = new URL(req.url);
    const search = (url.searchParams.get("search") || "").toLowerCase().trim();
    const category = url.searchParams.get("category") || "all";

    // 1. Fetch currently configured accounts from DB
    let configuredAccounts: any[] = [];
    try {
      configuredAccounts = await queryClient`
        SELECT id, identity_id as "identityId", kind, label, owner_email as "ownerEmail",
               login_email as "loginEmail", role, is_protected as "isProtected",
               health, meta, enabled,
               created_at as "createdAt"
        FROM provider_accounts
        ORDER BY created_at DESC;
      `;
    } catch {
      console.warn("[Providers API] Failed to fetch provider accounts from DB");
    }

    // Count accounts per provider
    const countsByProvider: Record<string, number> = {};
    for (const acc of configuredAccounts) {
      if (acc.enabled) countsByProvider[acc.kind] = (countsByProvider[acc.kind] || 0) + 1;
    }

    // 2. Build catalog of supported providers from registry and master catalog
    const registeredPlugins = pluginRegistry.list();
    const pluginsMap = new Map(registeredPlugins.map((p) => [p.id, p]));

    const catalogProviders = MASTER_CATALOG.map((cat) => {
      const plugin = pluginsMap.get(cat.id);
      return {
        id: cat.id,
        name: cat.name,
        description: cat.description,
        tier: cat.tier,
        capabilities: plugin?.capabilities || (cat.quotas.map((q) => q.category) as any[]),
        configFields: plugin?.configFields || [
          {
            key: "apiKey",
            label: "API Key / Token",
            type: "password",
            description: "Provider access credential.",
            required: true,
            secret: true,
          },
        ],
        connectedAccountsCount: countsByProvider[cat.id] || 0,
        quotasCount: cat.quotas.length,
      };
    });

    // Add any registered plugin that wasn't in MASTER_CATALOG (e.g. infisical)
    for (const plugin of registeredPlugins) {
      if (!catalogProviders.some((p) => p.id === plugin.id)) {
        catalogProviders.push({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description || `${plugin.name} Integration`,
          tier: (plugin.tier || "always_free") as any,
          capabilities: plugin.capabilities,
          configFields: plugin.configFields || [
            {
              key: "apiKey",
              label: "API Key / Token",
              type: "password",
              description: "Provider access credential.",
              required: true,
              secret: true,
            },
          ],
          connectedAccountsCount: countsByProvider[plugin.id] || 0,
          quotasCount: 0,
        });
      }
    }

    // Apply search filter
    let filteredProviders = catalogProviders;
    if (search) {
      filteredProviders = filteredProviders.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.id.toLowerCase().includes(search) ||
          p.description.toLowerCase().includes(search) ||
          p.capabilities.some((c: string) => c.toLowerCase().includes(search))
      );
    }

    if (category !== "all") {
      filteredProviders = filteredProviders.filter((p) =>
        p.capabilities.includes(category as any)
      );
    }

    return NextResponse.json({
      providers: filteredProviders,
      totalSupportedProviders: catalogProviders.length,
      connectedAccounts: configuredAccounts.map((account) => ({
        id: account.id,
        identityId: account.identityId,
        kind: account.kind,
        label: account.label,
        ownerEmail: account.ownerEmail,
        loginEmail: account.loginEmail,
        role: account.role,
        isProtected: account.isProtected,
        health: account.health,
        enabled: account.enabled,
        createdAt: account.createdAt,
        meta: publicProviderMeta(account.meta),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to load providers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    const body = await readJsonWithLimit<unknown>(req, 16 * 1024);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
    const parsed = providerOnboardingSchema.safeParse(body.data);
    if (!parsed.success) return NextResponse.json({ error: "Invalid provider onboarding request" }, { status: 400 });
    const {
      providerId, label, ownerEmail: requestedOwner, loginEmail,
      role = "general", isProtected = false, config = {},
    } = parsed.data;

    let ownerEmail = requestedOwner ?? auth.user?.email;
    if (parsed.data.identityId) {
      await bootstrapDatabase();
      const owner = await identityEmail(parsed.data.identityId);
      if (!owner) return NextResponse.json({ error: "That identity does not exist or has no email contact" }, { status: 400 });
      ownerEmail = requestedOwner ?? owner;
    }
    if (!ownerEmail) return NextResponse.json({ error: "Owner email is required for provider registration" }, { status: 400 });

    const plugin = pluginRegistry.get(providerId);
    if (!plugin) {
      return NextResponse.json(
        { error: "Provider is not supported yet" },
        { status: 404 }
      );
    }

    const decision = classifyProviderConfig(plugin, config);
    if (decision.kind === "invalid") return NextResponse.json({ error: decision.error }, { status: 400 });
    if (decision.kind === "vault-required") {
      if (supportsInventory(providerId)) {
        try { validateInventoryConfig(providerId, config); }
        catch (error) {
          const fields = error instanceof CollectionError ? error.fields : [];
          return NextResponse.json({ error: `Use the documented management API credentials and account scope for this provider${fields.length ? `. Missing or invalid: ${fields.join(", ")}` : ""}` }, { status: 400 });
        }
      }
      const scope = accountScope(providerId, config as Record<string, unknown>);
      if (scope && !parsed.data.accountId) {
        const duplicate = await findDuplicateAccount(providerId, scope).catch(() => null);
        if (duplicate) return NextResponse.json({ error: `Already connected as "${duplicate.label}" (same ${plugin.name} account). Archive that one first if you want to replace it.` }, { status: 409 });
      }
      try {
        const account = await registerVaultedAccount({ ...parsed.data, ownerEmail });
        if (scope) await recordAccountScope(account.id, scope).catch(() => undefined);
        return NextResponse.json({ success: true, account, message: supportsInventory(providerId) ? "Credentials saved and read back from the secret store. Inventory collection queued." : "Credentials saved. Automatic collection is unavailable for this provider." });
      } catch (error) {
        if (error instanceof AccountAttachmentError) return NextResponse.json({ error: "Account not found, already credentialed, or does not match this registration" }, { status: 409 });
        return NextResponse.json({ error: "Credentialed onboarding requires a verified secret store (Infisical or the built-in store) in setup." }, { status: 503 });
      }
    }

    if (parsed.data.accountId) return NextResponse.json({ error: "Existing accounts can only be upgraded by attaching management credentials" }, { status: 400 });
    await bootstrapDatabase();

    // Generate unique account ID
    const accountId = `acc-${randomUUID()}`;

    // Inventory registration is pending verification. No connection test or
    // resource discovery is possible without a credential store.
    await queryClient`
      INSERT INTO provider_accounts (
        id, kind, label, owner_email, login_email, role, is_protected, health, meta, notes, enabled
      ) VALUES (
        ${accountId},
        ${providerId},
        ${label},
        ${ownerEmail},
        ${loginEmail || ownerEmail},
        ${role},
        ${providerId === "oracle" || Boolean(isProtected)},
        'unknown',
        ${JSON.stringify({ onboardingStatus: "pending_verification", publicConfig: decision.publicConfig })},
        ${`${plugin.name} inventory registration pending verification`},
        false
      );
    `;

    return NextResponse.json({
      success: true,
      message: `${plugin.name} inventory account registered; verification is pending`,
      account: {
        id: accountId,
        provider: providerId,
        onboardingStatus: "pending_verification",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to register provider inventory account" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) {
    return createUnauthorizedResponse(auth);
  }

  try {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("id");

    if (!accountId) {
      return NextResponse.json({ error: "Account ID is required" }, { status: 400 });
    }

    const outcome = await queryClient.begin(async transaction => {
      await transaction`SELECT pg_advisory_xact_lock(76411213)`;
      const [account] = await transaction`SELECT id, secret_ref_id FROM provider_accounts WHERE id = ${accountId} FOR UPDATE`;
      if (!account) return "missing";
      // Keep vault-backed accounts and their references tracked until a durable,
      // owner-approved cleanup operation can coordinate both storage systems.
      if (account.secret_ref_id) return "vault-backed";
      await transaction`SELECT account_id FROM account_collections WHERE account_id = ${accountId} FOR UPDATE`;
      await transaction`DELETE FROM resources WHERE account_id = ${accountId}`;
      await transaction`DELETE FROM quota_samples WHERE meter_id IN (SELECT id FROM quota_meters WHERE account_id = ${accountId})`;
      await transaction`DELETE FROM quota_meters WHERE account_id = ${accountId}`;
      await transaction`DELETE FROM account_collections WHERE account_id = ${accountId}`;
      await transaction`DELETE FROM provider_accounts WHERE id = ${accountId}`;
      return "deleted";
    });
    if (outcome === "missing") return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (outcome === "vault-backed") return NextResponse.json({ error: "Vault-backed account removal is disabled until coordinated credential cleanup is available. This account and its credential reference remain tracked." }, { status: 409 });
    return NextResponse.json({ success: true, deletedId: accountId });
  } catch {
    return NextResponse.json({ error: "Failed to delete provider account" }, { status: 500 });
  }
}
