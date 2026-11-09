import { readProjectFleetMatches } from "@/lib/projects/fleet-scope";
import { selectIdentityAccounts } from "./fleet-selection";
import { queryClient } from "@/lib/db/client";
import { filterIdentities, type FleetFilter } from "@/lib/fleet/filters";
import { publicResourceAttributes, publicResourceTags, resourceBilling } from "@/lib/providers/config-security";
export * from "./types";
import type {
  IdentityWithAccounts,
  IdentityGraphResponse,
  GraphNode,
  GraphEdge,
  ProviderAccountDetail,
  IdentityContact,
  SafeSecretRef,
  LinkedResource,
  LinkedQuotaMeter,
  ProviderKind,
  AccountHealth,
} from "./types";
import { maskPhoneNumber } from "./types";

// Seed fallback data for graceful offline operation when DB is not running
const FALLBACK_IDENTITIES: IdentityWithAccounts[] = [
  {
    id: "ident-primary-operator",
    displayName: "Fleet Operator",
    notes: "FleetHub Operator & Principal Administrator",
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-10-25T12:00:00Z",
    contacts: [
      {
        id: "ct-operator-email-1",
        identityId: "ident-primary-operator",
        kind: "email",
        value: "operator@fleethub.dev",
        isPrimary: true,
        isVerified: true,
        label: "Primary Infrastructure",
      },
      {
        id: "ct-operator-email-2",
        identityId: "ident-primary-operator",
        kind: "email",
        value: "operator.backup@fleethub.dev",
        isPrimary: false,
        isVerified: true,
        label: "Secondary / Cloud Alerts",
      },
      {
        id: "ct-operator-phone-1",
        identityId: "ident-primary-operator",
        kind: "phone",
        value: "+1 (555) 010-0198",
        isPrimary: true,
        isVerified: true,
        label: "Verified Mobile & Alert SMS",
      },
    ],
    accounts: [
      {
        id: "acc-operator-main",
        identityId: "ident-primary-operator",
        provider: "oracle",
        label: "Oracle Cloud Tenancy 1",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator@fleethub.dev",
        role: "production_brain",
        isProtected: true,
        health: "ok",
        healthDetail: "All 3 Ampere A1 instances healthy in ap-mumbai-1",
        secretRefId: "sec-oci-tenancy-1",
        secretRef: {
          id: "sec-oci-tenancy-1",
          label: "OCI Mumbai Production API Key",
          status: "verified",
          lastVerifiedAt: "2026-10-25T14:30:00Z",
          infisicalProject: "fleet",
          environment: "prod",
          path: "/providers/oracle/prod",
          keysCount: 3,
        },
        resources: [
          {
            id: "atlas",
            name: "atlas (Docker Brain)",
            category: "compute",
            provider: "Oracle Cloud",
            accountId: "acc-operator-main",
            state: "online",
            isProtected: true,
            tags: ["arm64", "docker", "brain", "protected"],
            attributes: { ip: "100.64.0.1", ocpu: 2, ram_gb: 12, free_ram_gb: 7.7 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
          {
            id: "borealis",
            name: "borealis (K3s Cluster 1)",
            category: "compute",
            provider: "Oracle Cloud",
            accountId: "acc-operator-main",
            state: "online",
            isProtected: true,
            tags: ["arm64", "k3s", "protected"],
            attributes: { ip: "100.64.0.2", ocpu: 2, ram_gb: 12, free_ram_gb: 3.7 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
          {
            id: "oci-block",
            name: "oracle-block-volumes",
            category: "storage",
            provider: "Oracle Cloud",
            accountId: "acc-operator-main",
            state: "online",
            isProtected: false,
            tags: ["boot-volume", "block"],
            attributes: { total_gb: 200, used_gb: 147 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [
          {
            id: "qm-oci-ocpu",
            accountId: "acc-operator-main",
            key: "oci.a1.ocpu_hours",
            name: "Ampere A1 OCPU Allocation",
            category: "compute",
            unit: "ocpu",
            limitValue: 4.0,
            currentValue: 4.0,
            warnPct: 80,
            critPct: 95,
            source: "api",
            observationTime: "2026-10-25T14:50:00Z",
          },
        ],
        notes: "Primary personal OCI tenancy (A1 Always Free) - Strictly Protected",
        enabled: true,
        createdAt: "2026-01-15T00:00:00Z",
      },
      {
        id: "acc-oracle-secondary",
        identityId: "ident-primary-operator",
        provider: "oracle",
        label: "Oracle Cloud Tenancy 2 (Secondary)",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "partner@fleethub.dev",
        role: "cluster_node",
        isProtected: true,
        health: "ok",
        healthDetail: "K3s Cluster 2 online",
        secretRefId: "sec-oci-tenancy-2",
        secretRef: {
          id: "sec-oci-tenancy-2",
          label: "OCI Secondary Profile Key",
          status: "verified",
          lastVerifiedAt: "2026-10-25T14:30:00Z",
          infisicalProject: "fleet",
          environment: "prod",
          path: "/providers/oracle/secondary",
          keysCount: 3,
        },
        resources: [
          {
            id: "polar-night-owl",
            name: "polar-night-owl (K3s Cluster 2)",
            category: "compute",
            provider: "Oracle Cloud",
            accountId: "acc-oracle-secondary",
            state: "online",
            isProtected: true,
            tags: ["arm64", "k3s", "protected"],
            attributes: { ip: "100.64.0.3", ocpu: 2, ram_gb: 12, free_ram_gb: 5.4 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [],
        notes: "Secondary tenancy running K3s Cluster 2 - Protected",
        enabled: true,
        createdAt: "2026-02-10T00:00:00Z",
      },
      {
        id: "acc-cloudflare-main",
        identityId: "ident-primary-operator",
        provider: "cloudflare",
        label: "Cloudflare Primary DNS",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator@fleethub.dev",
        role: "dns_control",
        isProtected: true,
        health: "ok",
        secretRefId: "sec-cf-token",
        secretRef: {
          id: "sec-cf-token",
          label: "Cloudflare Scoped DNS & R2 Token",
          status: "verified",
          lastVerifiedAt: "2026-10-25T14:30:00Z",
          infisicalProject: "fleet",
          environment: "prod",
          path: "/providers/cloudflare/prod",
          keysCount: 2,
        },
        resources: [
          {
            id: "r2-artifacts",
            name: "fleet-artifacts",
            category: "storage",
            provider: "Cloudflare R2",
            accountId: "acc-cloudflare-main",
            state: "online",
            isProtected: true,
            tags: ["s3", "zero-egress", "crypt", "protected"],
            attributes: { bucket: "fleet-artifacts", cap_gb: 10, used_gb: 4.2 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [
          {
            id: "qm-cf-r2-cap",
            accountId: "acc-cloudflare-main",
            key: "cf.r2.storage",
            name: "R2 Free Storage Quota",
            category: "storage",
            unit: "GB",
            limitValue: 10.0,
            currentValue: 4.2,
            warnPct: 80,
            critPct: 95,
            source: "api",
            observationTime: "2026-10-25T14:50:00Z",
          },
        ],
        notes: "Production DNS zone & Zero-Egress R2 storage - Protected",
        enabled: true,
        createdAt: "2026-01-20T00:00:00Z",
      },
      {
        id: "acc-cloudflare-sandbox",
        identityId: "ident-primary-operator",
        provider: "cloudflare",
        label: "Cloudflare Worker Pool",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator@fleethub.dev",
        role: "worker_ephemeral",
        isProtected: false,
        health: "ok",
        resources: [
          {
            id: "cf-ephemeral-worker",
            name: "fleet-batch-worker",
            category: "serverless",
            provider: "Cloudflare",
            accountId: "acc-cloudflare-sandbox",
            state: "online",
            isProtected: false,
            tags: ["worker", "ephemeral"],
            attributes: { routes: ["batch.fleethub.internal/*"] },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [
          {
            id: "qm-cf-workers-daily",
            accountId: "acc-cloudflare-sandbox",
            key: "cf.workers.requests",
            name: "Daily Worker Invocations",
            category: "serverless",
            unit: "requests",
            limitValue: 100000,
            currentValue: 14250,
            warnPct: 80,
            critPct: 95,
            source: "api",
            observationTime: "2026-10-25T14:50:00Z",
          },
        ],
        notes: "Batch & ephemeral serverless worker execution sandbox",
        enabled: true,
        createdAt: "2026-02-15T00:00:00Z",
      },
      {
        id: "acc-nvidia-inception",
        identityId: "ident-primary-operator",
        provider: "nvidia",
        label: "NVIDIA Inception AI Cluster",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator@fleethub.dev",
        role: "gpu_inference",
        isProtected: true,
        health: "ok",
        secretRefId: "sec-nvidia-token",
        secretRef: {
          id: "sec-nvidia-token",
          label: "NVIDIA NIM API Key",
          status: "verified",
          lastVerifiedAt: "2026-10-25T14:30:00Z",
          infisicalProject: "fleet",
          environment: "prod",
          path: "/providers/nvidia/prod",
          keysCount: 1,
        },
        resources: [
          {
            id: "nvidia-nim-llm",
            name: "nvidia-h100-nim",
            category: "llm",
            provider: "NVIDIA Inception",
            accountId: "acc-nvidia-inception",
            state: "online",
            isProtected: true,
            tags: ["h100", "nim", "protected", "cuda"],
            attributes: { accelerator: "H100 PCIe", creditsRemaining: "$2,450.00" },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [],
        notes: "Accelerated H100 inference API credits & endpoints - Protected",
        enabled: true,
        createdAt: "2026-03-01T00:00:00Z",
      },
      {
        id: "acc-gcp-prod",
        identityId: "ident-primary-operator",
        provider: "google",
        label: "Google Cloud Platform (Vertex & GCS)",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator.backup@fleethub.dev",
        role: "vertex_ai",
        isProtected: false,
        health: "ok",
        resources: [],
        quotaMeters: [],
        notes: "Vertex AI multimodal reasoning & persistent storage",
        enabled: true,
        createdAt: "2026-03-15T00:00:00Z",
      },
      {
        id: "acc-upstash-main",
        identityId: "ident-primary-operator",
        provider: "upstash",
        label: "Upstash Edge",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator@fleethub.dev",
        role: "redis_cache",
        isProtected: false,
        health: "ok",
        resources: [
          {
            id: "global-redis",
            name: "global-cache-db",
            category: "database",
            provider: "Upstash",
            accountId: "acc-upstash-main",
            state: "online",
            isProtected: false,
            tags: ["redis", "fast", "in-memory"],
            attributes: { host: "cache.example.upstash.io", monthly_cap: 500000, used: 148900 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [],
        notes: "500K Redis cmds & QStash serverless",
        enabled: true,
        createdAt: "2026-01-18T00:00:00Z",
      },
      {
        id: "acc-freellm-main",
        identityId: "ident-primary-operator",
        provider: "freellmapi",
        label: "FreeLLM Gateway Router",
        ownerEmail: "operator@fleethub.dev",
        loginEmail: "operator@fleethub.dev",
        role: "gateway_router",
        isProtected: true,
        health: "ok",
        resources: [
          {
            id: "freellmapi-gateway",
            name: "freellmapi (Brain Router)",
            category: "llm",
            provider: "FreeLLM API",
            accountId: "acc-freellm-main",
            state: "online",
            isProtected: true,
            tags: ["router", "tailnet-only", "mcp"],
            attributes: { ip: "127.0.0.1:3001", port: 3001, pools: ["Gemini", "Groq", "Cerebras", "OpenRouter"] },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [],
        notes: "LLM gateway with circuit breaker",
        enabled: true,
        createdAt: "2026-01-20T00:00:00Z",
      },
    ],
  },
  {
    id: "ident-alex-chen",
    displayName: "Alex Chen",
    notes: "External Infra Collaborator (Sandbox Environment)",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    contacts: [
      {
        id: "ct-alex-email-1",
        identityId: "ident-alex-chen",
        kind: "email",
        value: "alex.chen@example.org",
        isPrimary: true,
        isVerified: false, // Honestly labeled as unverified
        label: "Partner Org Email (Pending Verification)",
      },
      // Honestly: NO mobile phone record inserted. Missing contacts must not be invented!
    ],
    accounts: [
      {
        id: "acc-oracle-partner",
        identityId: "ident-alex-chen",
        provider: "oracle",
        label: "Oracle Partner Sandbox",
        ownerEmail: "alex.chen@example.org",
        loginEmail: "alex.chen@example.org",
        role: "dev_sandbox",
        isProtected: false,
        health: "ok",
        resources: [
          {
            id: "alex-dev-vm",
            name: "alex-dev-node",
            category: "compute",
            provider: "Oracle Cloud",
            accountId: "acc-oracle-partner",
            state: "idle",
            isProtected: false,
            tags: ["amd64", "sandbox"],
            attributes: { ip: "10.0.0.84", ocpu: 1, ram_gb: 1 },
            lastSeenAt: "2026-10-25T14:50:00Z",
          },
        ],
        quotaMeters: [],
        notes: "Dev sandbox tenancy for collaborator experiments",
        enabled: true,
        createdAt: "2026-04-01T00:00:00Z",
      },
      {
        id: "acc-cf-partner",
        identityId: "ident-alex-chen",
        provider: "cloudflare",
        label: "Partner Staging CDN",
        ownerEmail: "alex.chen@example.org",
        loginEmail: "alex.chen@example.org",
        role: "staging_proxy",
        isProtected: false,
        health: "ok",
        resources: [],
        quotaMeters: [],
        notes: "Staging CDN endpoints",
        enabled: true,
        createdAt: "2026-04-05T00:00:00Z",
      },
    ],
  },
];

function publicFallbackIdentities(): IdentityWithAccounts[] {
  return FALLBACK_IDENTITIES.map((identity) => ({
    ...identity,
    accounts: identity.accounts.map((account) => ({
      ...account,
      resources: account.resources.map((resource) => ({
        ...resource,
        tags: publicResourceTags(resource.tags),
        attributes: publicResourceAttributes(resource.attributes),
      })),
    })),
  }));
}

/**
 * Retrieve all identities with their associated contacts, provider accounts, resources, quotas, and safe secret refs.
 */
export async function getIdentitiesWithAccounts(filter: FleetFilter = {}): Promise<IdentityWithAccounts[]> {
  const [identities, project] = await Promise.all([
    loadIdentitiesWithAccounts(),
    filter.project ? readProjectFleetMatches(filter.project) : null,
  ]);
  const filtered = filterIdentities(identities, filter);
  return project ? selectIdentityAccounts(filtered, project) : filtered;
}

async function loadIdentitiesWithAccounts(): Promise<IdentityWithAccounts[]> {
  try {
    // 1. Fetch identities
    const dbIdentities = await queryClient`
      SELECT id, display_name as "displayName", notes, created_at as "createdAt", updated_at as "updatedAt"
      FROM identities
      ORDER BY created_at ASC;
    `;

    if (!dbIdentities || dbIdentities.length === 0) {
      if (process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test") {
        return publicFallbackIdentities();
      }
      return [];
    }

    // 2. Fetch contacts
    const dbContacts = await queryClient`
      SELECT id, identity_id as "identityId", kind, value, is_primary as "isPrimary", is_verified as "isVerified", label, created_at as "createdAt"
      FROM identity_contacts
      ORDER BY is_primary DESC, created_at ASC;
    `;

    // 3. Fetch provider accounts
    const dbAccounts = await queryClient`
      SELECT 
        id, identity_id as "identityId", kind as provider, label, 
        owner_email as "ownerEmail", login_email as "loginEmail", role, 
        is_protected as "isProtected", health, plan, contact_id as "contactId", archived_at as "archivedAt",
        secret_ref_id as "secretRefId", enabled,
        created_at as "createdAt", updated_at as "updatedAt"
      FROM provider_accounts
      ORDER BY is_protected DESC, label ASC;
    `;

    // 4. Fetch safe secret references (zero secret values)
    const dbSecretRefs = await queryClient`
      SELECT id, label, infisical_project as "infisicalProject", environment, path, 
             status, last_verified_at as "lastVerifiedAt", jsonb_array_length(keys) as "keysCount"
      FROM secret_refs;
    `;

    // 5. Fetch resources
    const dbResources = await queryClient`
      SELECT id, name, category, provider, account_id as "accountId", 
             state, is_protected as "isProtected", tags, attributes, last_seen_at as "lastSeenAt"
      FROM resources;
    `;

    // 6. Fetch quota meters
    const dbQuotaMeters = await queryClient`
      SELECT id, account_id as "accountId", key, name, category, unit, 
             limit_value as "limitValue", warn_pct as "warnPct", crit_pct as "critPct", 
             source, updated_at as "updatedAt"
      FROM quota_meters;
    `;

    const secretMap = new Map<string, SafeSecretRef>();
    for (const s of dbSecretRefs) {
      secretMap.set(s.id, {
        id: s.id,
        label: s.label,
        status: s.status,
        lastVerifiedAt: s.lastVerifiedAt,
        infisicalProject: s.infisicalProject,
        environment: s.environment,
        path: s.path,
        keysCount: Number(s.keysCount || 0),
      });
    }

    const resourcesByAccount = new Map<string, LinkedResource[]>();
    for (const r of dbResources) {
      const accId = r.accountId || "";
      const list = resourcesByAccount.get(accId) || [];
      list.push({
        id: r.id,
        name: r.name,
        category: r.category,
        provider: r.provider,
        accountId: r.accountId,
        state: r.state,
        isProtected: Boolean(r.isProtected),
        tags: publicResourceTags(r.tags),
        attributes: publicResourceAttributes(r.attributes),
        billing: resourceBilling(r.attributes),
        lastSeenAt: r.lastSeenAt,
      });
      resourcesByAccount.set(accId, list);
    }

    const quotasByAccount = new Map<string, LinkedQuotaMeter[]>();
    for (const q of dbQuotaMeters) {
      const accId = q.accountId || "";
      const list = quotasByAccount.get(accId) || [];
      list.push({
        id: q.id,
        accountId: q.accountId,
        key: q.key,
        name: q.name,
        category: q.category,
        unit: q.unit,
        limitValue: Number(q.limitValue),
        warnPct: Number(q.warnPct),
        critPct: Number(q.critPct),
        source: q.source,
        observationTime: q.updatedAt,
      });
      quotasByAccount.set(accId, list);
    }

    const contactsByIdentity = new Map<string, IdentityContact[]>();
    for (const c of dbContacts) {
      const list = contactsByIdentity.get(c.identityId) || [];
      list.push({
        id: c.id,
        identityId: c.identityId,
        kind: c.kind,
        value: c.value,
        isPrimary: Boolean(c.isPrimary),
        isVerified: Boolean(c.isVerified),
        label: c.label,
        createdAt: c.createdAt,
      });
      contactsByIdentity.set(c.identityId, list);
    }

    const accountsByIdentity = new Map<string, ProviderAccountDetail[]>();
    for (const a of dbAccounts) {
      const identId = a.identityId || "unlinked";
      const list = accountsByIdentity.get(identId) || [];
      list.push({
        id: a.id,
        identityId: a.identityId,
        provider: a.provider,
        label: a.label,
        ownerEmail: a.ownerEmail,
        loginEmail: a.loginEmail || a.ownerEmail,
        role: a.role || "member",
        isProtected: Boolean(a.isProtected),
        health: (a.health as AccountHealth) || "ok",
        secretRefId: a.secretRefId,
        secretRef: a.secretRefId ? secretMap.get(a.secretRefId) || null : null,
        resources: resourcesByAccount.get(a.id) || [],
        quotaMeters: quotasByAccount.get(a.id) || [],
        enabled: Boolean(a.enabled),
        plan: a.plan ?? "unknown",
        contactId: a.contactId ?? null,
        archived: Boolean(a.archivedAt),
        createdAt: a.createdAt,
      });
      accountsByIdentity.set(identId, list);
    }

    const result: IdentityWithAccounts[] = dbIdentities.map((i: any) => ({
      id: i.id,
      displayName: i.displayName,
      notes: i.notes,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      contacts: contactsByIdentity.get(i.id) || [],
      accounts: accountsByIdentity.get(i.id) || [],
    }));

    if (result.length === 0 && (process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test")) {
      return publicFallbackIdentities();
    }
    return result;
  } catch (err: any) {
    if (process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test") {
      console.warn("[Identity Service] DB query fallback to verified sample:", err.message);
      return publicFallbackIdentities();
    }
    return [];
  }
}

/**
 * Build hierarchical Graph structure:
 * Identity -> Provider -> Provider Account -> Resources, Quota Meters, Secret References
 *
 * Rules:
 * - Group multiple accounts from one provider under one provider node
 * - Protected accounts visually distinct with clear Protected badge and role
 * - Show account labels and login emails to differentiate same-provider accounts
 * - No plaintext secrets; safe metadata only
 * - Masked phone numbers with reveal control
 */
export async function getIdentityGraph(filter?: {
  search?: string;
  provider?: string;
  health?: string;
  protection?: string;
  resourceCategory?: string;
} & FleetFilter): Promise<IdentityGraphResponse> {
  const identities = await getIdentitiesWithAccounts({ person: filter?.person, email: filter?.email, plan: filter?.plan, project: filter?.project });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  let protectedAccountsCount = 0;
  let totalAccountsCount = 0;
  let totalResourcesCount = 0;
  let totalQuotaMetersCount = 0;
  const uniqueProviders = new Set<string>();

  const searchLower = filter?.search?.trim().toLowerCase() || "";
  const providerFilter = filter?.provider?.trim().toLowerCase() || "all";
  const healthFilter = filter?.health?.trim().toLowerCase() || "all";
  const protectionFilter = filter?.protection?.trim().toLowerCase() || "all";
  const resourceCatFilter = filter?.resourceCategory?.trim().toLowerCase() || "all";

  for (const identity of identities) {
    const primaryEmail = identity.contacts.find((c) => c.kind === "email" && c.isPrimary)?.value ||
                         identity.contacts.find((c) => c.kind === "email")?.value || "";
    const primaryPhone = identity.contacts.find((c) => c.kind === "phone" && c.isPrimary)?.value ||
                         identity.contacts.find((c) => c.kind === "phone")?.value || "";

    // Group accounts by provider
    const accountsByProvider = new Map<string, ProviderAccountDetail[]>();
    for (const acc of identity.accounts) {
      if (providerFilter !== "all" && acc.provider.toLowerCase() !== providerFilter) continue;
      if (healthFilter !== "all" && acc.health.toLowerCase() !== healthFilter) continue;
      if (protectionFilter === "protected" && !acc.isProtected) continue;
      if (protectionFilter === "unprotected" && acc.isProtected) continue;

      if (resourceCatFilter !== "all") {
        const hasMatchingCat = acc.resources.some((r) => r.category.toLowerCase() === resourceCatFilter);
        if (!hasMatchingCat && acc.resources.length > 0) continue;
      }

      const list = accountsByProvider.get(acc.provider) || [];
      list.push(acc);
      accountsByProvider.set(acc.provider, list);
    }

    // Check search match
    if (searchLower) {
      const matchesIdentity =
        identity.displayName.toLowerCase().includes(searchLower) ||
        identity.contacts.some((c) => c.value.toLowerCase().includes(searchLower));

      const hasMatchingAccount = Array.from(accountsByProvider.values()).some((list) =>
        list.some(
          (acc) =>
            acc.label.toLowerCase().includes(searchLower) ||
            acc.id.toLowerCase().includes(searchLower) ||
            acc.loginEmail.toLowerCase().includes(searchLower) ||
            acc.provider.toLowerCase().includes(searchLower)
        )
      );

      if (!matchesIdentity && !hasMatchingAccount) {
        continue;
      }
    }

    const totalAccountsForIdent = Array.from(accountsByProvider.values()).reduce((sum, l) => sum + l.length, 0);

    // 1. Identity Node (Tier 0)
    const identityNodeId = `node-ident-${identity.id}`;
    nodes.push({
      id: identityNodeId,
      type: "identity",
      label: identity.displayName,
      subLabel: primaryEmail || "No primary email",
      childCount: accountsByProvider.size,
      observationTime: identity.updatedAt,
      provenance: "live",
      data: {
        identityId: identity.id,
        displayName: identity.displayName,
        primaryEmail,
        primaryPhone: primaryPhone ? maskPhoneNumber(primaryPhone) : "No mobile on file",
        contactsCount: identity.contacts.length,
        contacts: identity.contacts.map((c) => ({
          ...c,
          value: c.kind === "phone" ? maskPhoneNumber(c.value) : c.value,
          maskedValue: c.kind === "phone" ? maskPhoneNumber(c.value) : c.value,
        })),
        notes: identity.notes,
        totalAccounts: totalAccountsForIdent,
      },
    });

    // 2. Email nodes (Tier 1), then provider nodes (Tier 2) grouping that email's accounts.
    const contactEmail = new Map(identity.contacts.map((c) => [c.id, c.value]));
    const emailGroups = new Map<string, { label: string; byProvider: Map<string, ProviderAccountDetail[]> }>();
    for (const list of accountsByProvider.values()) {
      for (const acc of list) {
        const label = (acc.contactId ? contactEmail.get(acc.contactId) : undefined) ?? acc.ownerEmail ?? "no email";
        const group = emailGroups.get(label.toLowerCase()) ?? { label, byProvider: new Map<string, ProviderAccountDetail[]>() };
        group.byProvider.set(acc.provider, [...(group.byProvider.get(acc.provider) ?? []), acc]);
        emailGroups.set(label.toLowerCase(), group);
      }
    }
    for (const [emailKey, group] of emailGroups.entries()) {
    const emailNodeId = `node-email-${identity.id}-${emailKey}`;
    nodes.push({
      id: emailNodeId, type: "email", label: group.label,
      subLabel: `${Array.from(group.byProvider.values()).reduce((sum, l) => sum + l.length, 0)} accounts`,
      parentId: identityNodeId, childCount: group.byProvider.size, provenance: "live",
      data: { email: group.label },
    });
    edges.push({ id: `edge-${identityNodeId}-${emailNodeId}`, source: identityNodeId, target: emailNodeId, label: "email" });
    for (const [providerKey, accounts] of group.byProvider.entries()) {
      uniqueProviders.add(providerKey);
      const providerNodeId = `node-prov-${identity.id}-${emailKey}-${providerKey}`;
      const providerLabel = formatProviderName(providerKey);

      nodes.push({
        id: providerNodeId,
        type: "provider",
        label: providerLabel,
        subLabel: `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`,
        provider: providerKey as ProviderKind,
        parentId: emailNodeId,
        childCount: accounts.length,
        observationTime: new Date().toISOString(),
        provenance: "live",
        data: {
          provider: providerKey,
          providerLabel,
          accountsCount: accounts.length,
          protectedCount: accounts.filter((a) => a.isProtected).length,
        },
      });

      edges.push({
        id: `edge-${emailNodeId}-${providerNodeId}`,
        source: emailNodeId,
        target: providerNodeId,
        label: "manages",
      });

      // 3. Provider Account Nodes (Tier 2)
      for (const account of accounts) {
        totalAccountsCount++;
        if (account.isProtected) protectedAccountsCount++;

        const accountNodeId = `node-acc-${account.id}`;

        nodes.push({
          id: accountNodeId,
          type: "account",
          label: account.label,
          subLabel: `${account.loginEmail} · ${account.plan === "free" ? "free" : account.plan === "paid" ? "paid" : "plan not set"}`,
          isProtected: account.isProtected,
          health: account.health,
          role: account.role,
          provider: account.provider,
          parentId: providerNodeId,
          childCount: account.resources.length + account.quotaMeters.length + (account.secretRef ? 1 : 0),
          observationTime: account.createdAt,
          provenance: "live",
          data: {
            accountId: account.id,
            label: account.label,
            provider: account.provider,
            ownerEmail: account.ownerEmail,
            loginEmail: account.loginEmail,
            role: account.role,
            plan: account.plan ?? "unknown",
            isProtected: account.isProtected,
            health: account.health,
            healthDetail: account.healthDetail,
            secretRef: account.secretRef,
            resourcesCount: account.resources.length,
            quotaMetersCount: account.quotaMeters.length,
            notes: account.notes,
          },
        });

        edges.push({
          id: `edge-${providerNodeId}-${accountNodeId}`,
          source: providerNodeId,
          target: accountNodeId,
          label: account.role,
        });

        // 4. Descendant Nodes (Tier 3: Resources, Quota Meters, Safe Secret Ref)
        // Progressive expansion / Virtualization: render first 4 items per account, show childCount
        for (const res of account.resources) {
          totalResourcesCount++;
          const resNodeId = `node-res-${res.id}`;
          nodes.push({
            id: resNodeId,
            type: "resource",
            label: res.name,
            subLabel: `${res.category} • ${res.state}`,
            isProtected: res.isProtected,
            parentId: accountNodeId,
            observationTime: res.lastSeenAt,
            provenance: "live",
            data: {
              resourceId: res.id,
              name: res.name,
              category: res.category,
              provider: res.provider,
              state: res.state,
              isProtected: res.isProtected,
              tags: res.tags,
              attributes: res.attributes,
              lastSeenAt: res.lastSeenAt,
            },
          });

          edges.push({
            id: `edge-${accountNodeId}-${resNodeId}`,
            source: accountNodeId,
            target: resNodeId,
          });
        }

        for (const meter of account.quotaMeters) {
          totalQuotaMetersCount++;
          const meterNodeId = `node-qm-${meter.id}`;
          nodes.push({
            id: meterNodeId,
            type: "quota",
            label: meter.name,
            subLabel: `${meter.currentValue ?? meter.limitValue} ${meter.unit} (${meter.source})`,
            parentId: accountNodeId,
            observationTime: meter.observationTime || new Date().toISOString(),
            provenance: meter.source === "api" ? "live" : meter.source === "derived" ? "derived" : "manual",
            data: {
              meterId: meter.id,
              key: meter.key,
              name: meter.name,
              unit: meter.unit,
              limitValue: meter.limitValue,
              currentValue: meter.currentValue,
              source: meter.source,
              warnPct: meter.warnPct,
              critPct: meter.critPct,
              usedPct: meter.currentValue !== undefined && meter.limitValue > 0 ? Math.min(100, Math.round((meter.currentValue / meter.limitValue) * 100)) : null,
            },
          });

          edges.push({
            id: `edge-${accountNodeId}-${meterNodeId}`,
            source: accountNodeId,
            target: meterNodeId,
          });
        }

        if (account.secretRef) {
          const secNodeId = `node-sec-${account.secretRef.id}`;
          nodes.push({
            id: secNodeId,
            type: "secret_ref",
            label: account.secretRef.label,
            subLabel: `Infisical: ${account.secretRef.path} (${account.secretRef.status})`,
            parentId: accountNodeId,
            observationTime: account.secretRef.lastVerifiedAt || new Date().toISOString(),
            provenance: "live",
            data: {
              secretRefId: account.secretRef.id,
              label: account.secretRef.label,
              status: account.secretRef.status,
              path: account.secretRef.path,
              environment: account.secretRef.environment,
              infisicalProject: account.secretRef.infisicalProject,
              keysCount: account.secretRef.keysCount,
              lastVerifiedAt: account.secretRef.lastVerifiedAt,
            },
          });

          edges.push({
            id: `edge-${accountNodeId}-${secNodeId}`,
            source: accountNodeId,
            target: secNodeId,
          });
        }
      }
    }
    }
  }

  return {
    nodes,
    edges,
    summary: {
      totalIdentities: identities.length,
      totalProviders: uniqueProviders.size,
      totalAccounts: totalAccountsCount,
      protectedAccounts: protectedAccountsCount,
      totalResources: totalResourcesCount,
      totalQuotaMeters: totalQuotaMetersCount,
    },
  };
}

function formatProviderName(provider: string): string {
  switch (provider.toLowerCase()) {
    case "oracle":
      return "Oracle Cloud Infrastructure";
    case "cloudflare":
      return "Cloudflare Edge";
    case "nvidia":
      return "NVIDIA Inception Cluster";
    case "google":
      return "Google Cloud Platform";
    case "upstash":
      return "Upstash Serverless Edge";
    case "freellmapi":
      return "FreeLLM Gateway Router";
    case "github":
      return "GitHub Hosted Infrastructure";
    case "turso":
      return "Turso Edge SQLite";
    case "neon":
      return "Neon Serverless Postgres";
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}
