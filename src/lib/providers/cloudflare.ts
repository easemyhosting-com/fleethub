import { z } from "zod";

/**
 * Cloudflare provider integration for separately owned accounts (personal, staging, client)
 * 
 * Supports collating multiple Cloudflare accounts across different emails & roles:
 * - Primary DNS Account (e.g. fleethub.dev - isProtected: true, strictly shielded from arbitrary batch workers)
 * - Ephemeral Worker Accounts (e.g. sandbox 1..N - isProtected: true, eligible for cron/sync jobs)
 * - R2 Storage Accounts
 * 
 * Performs REAL API verification against Cloudflare Client API (v4).
 * Enforces per-metric provenance tracking: never labels unverified workers/storage metrics as live_api.
 */

export type CloudflareRole = "dns_control" | "worker_ephemeral" | "r2_storage" | "general";

export interface MetricProvenance {
  zones: "live_api" | "sample_baseline" | "unavailable";
  workers: "live_api" | "sample_baseline" | "unavailable";
  r2: "live_api" | "sample_baseline" | "unavailable";
}

export interface CloudflareAccountInfo {
  id: string;
  label: string;
  ownerEmail: string;
  role: CloudflareRole;
  isProtected: boolean;
  connected: boolean;
  dataSource: "live_api" | "partial_live_api" | "sample_baseline" | "unavailable";
  observationTime: string;
  metricProvenance: MetricProvenance;
  zonesCount: number;
  zones: Array<{ id: string; name: string; status: string }>;
  workersUsage: {
    invocationsToday: number | null;
    dailyLimit: number | null;
    status: "healthy" | "warning" | "unknown";
  };
  r2Buckets: Array<{
    name: string;
    sizeGb: number;
    objectsCount: number;
    tier: string;
    zeroEgress: boolean;
  }>;
}

export interface CloudflareResourceReport {
  connected: boolean;
  dataSource: "live_api" | "partial_live_api" | "sample_baseline" | "unavailable";
  observationTime: string;
  totalAccounts: number;
  activeAccounts: number;
  accounts: CloudflareAccountInfo[];
  // Aggregated fleet telemetry
  zonesCount: number;
  r2Buckets: Array<{
    name: string;
    sizeGb: number;
    objectsCount: number;
    tier: string;
    zeroEgress: boolean;
  }>;
  workersUsage: {
    invocationsToday: number | null;
    dailyLimit: number | null;
    status: "healthy" | "warning" | "unknown";
  };
  zones: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  lastPolledAt: string;
}

export interface AccountConfig {
  id: string;
  label: string;
  ownerEmail: string;
  token?: string;
  role: CloudflareRole;
  isProtected: boolean;
}

const AccountConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).default("Cloudflare Account"),
  ownerEmail: z.email().default("user@example.com"),
  token: z.string().optional(),
  apiToken: z.string().optional(),
  role: z.enum(["dns_control", "worker_ephemeral", "r2_storage", "general"]).default("general"),
}).transform(({ apiToken, ...account }) => ({ ...account, token: account.token ?? apiToken, isProtected: true }));

export function discoverConfiguredAccounts(): AccountConfig[] {
  // 1. Check for structured multi-account JSON in environment
  if (process.env.CLOUDFLARE_ACCOUNTS_JSON) {
    try {
      const accounts = z.array(AccountConfigSchema).min(1).parse(JSON.parse(process.env.CLOUDFLARE_ACCOUNTS_JSON));
      if (new Set(accounts.map(account => account.id)).size !== accounts.length) return [];
      return accounts;
    } catch {
      console.warn("[Cloudflare] Invalid CLOUDFLARE_ACCOUNTS_JSON; discovery disabled");
      return [];
    }
  }

  // 2. Discover prefixed environment variables (e.g. CLOUDFLARE_API_TOKEN, CLOUDFLARE_WORKER_TOKEN_1, etc.)
  return [
    {
      id: "cf-primary-dns",
      label: "Production DNS & Core Gateway",
      ownerEmail: "operator@fleethub.dev",
      token: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_DNS_TOKEN,
      role: "dns_control",
      isProtected: true, // Primary DNS must NEVER run arbitrary untrusted batch workers
    },
    {
      id: "cf-worker-sandbox-1",
      label: "Staging account (cron and sync workers)",
      ownerEmail: "staging@fleethub.dev",
      token: process.env.CLOUDFLARE_WORKER_TOKEN_1,
      role: "worker_ephemeral",
      isProtected: true,
    },
    {
      id: "cf-worker-sandbox-2",
      label: "Client project account (edge services)",
      ownerEmail: "client-project@fleethub.dev",
      token: process.env.CLOUDFLARE_WORKER_TOKEN_2,
      role: "worker_ephemeral",
      isProtected: true,
    },
    {
      id: "cf-r2-storage-pool",
      label: "R2 Zero-Egress Storage Vault",
      ownerEmail: "storage-vault@fleethub.dev",
      token: process.env.CLOUDFLARE_R2_TOKEN,
      role: "r2_storage",
      isProtected: true,
    },
  ];
}

async function verifyLiveToken(token: string): Promise<{
  ok: boolean;
  zones: Array<{ id: string; name: string; status: string }>;
}> {
  if (!token || token.trim().length === 0) {
    return { ok: false, zones: [] };
  }

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=10", {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return { ok: false, zones: [] };
    }

    const data = await res.json();
    if (data.success && Array.isArray(data.result)) {
      return {
        ok: true,
        zones: data.result.map((z: any) => ({
          id: z.id || "zone-id",
          name: z.name || "example.com",
          status: z.status || "active",
        })),
      };
    }
    return { ok: false, zones: [] };
  } catch {
    return { ok: false, zones: [] };
  }
}

export async function getCloudflareResources(): Promise<CloudflareResourceReport> {
  const demo = process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test";
  const configs = discoverConfiguredAccounts().filter(account => demo || Boolean(account.token?.trim()));
  const accounts: CloudflareAccountInfo[] = [];

  for (const cfg of configs) {
    let isLive = false;
    let liveZones: Array<{ id: string; name: string; status: string }> = [];

    if (cfg.token) {
      const verification = await verifyLiveToken(cfg.token);
      if (verification.ok) {
        isLive = true;
        liveZones = verification.zones;
      }
    }

    const metricProvenance: MetricProvenance = {
      zones: isLive ? "live_api" : "sample_baseline",
      workers: "sample_baseline",
      r2: "sample_baseline",
    };

    if (isLive) {
      accounts.push({
        id: cfg.id,
        label: cfg.label,
        ownerEmail: cfg.ownerEmail,
        role: cfg.role,
        isProtected: true, // Account identity and isolation have not been verified.
        connected: true,
        dataSource: "partial_live_api",
        observationTime: new Date().toISOString(),
        metricProvenance,
        zonesCount: liveZones.length,
        zones: liveZones,
        workersUsage: {
          invocationsToday: 14250,
          dailyLimit: 100000,
          status: "healthy",
        },
        r2Buckets: [
          {
            name: `${cfg.id}-artifacts`,
            sizeGb: 2.1,
            objectsCount: 840,
            tier: "Standard (Zero Egress)",
            zeroEgress: true,
          },
        ],
      });
    } else {
      accounts.push({
        id: cfg.id,
        label: cfg.label,
        ownerEmail: cfg.ownerEmail,
        role: cfg.role,
        isProtected: true, // Account identity and isolation have not been verified.
        connected: false,
        dataSource: "sample_baseline",
        observationTime: "2026-07-20T12:00:00Z",
        metricProvenance,
        zonesCount: cfg.role === "dns_control" ? 1 : 0,
        zones:
          cfg.role === "dns_control"
            ? [{ id: "z-primary-dns", name: "example.com", status: "sample" }]
            : [],
        workersUsage: {
          invocationsToday: cfg.role === "worker_ephemeral" ? 8200 : 0,
          dailyLimit: 100000,
          status: "healthy",
        },
        r2Buckets:
          cfg.role === "r2_storage" || cfg.role === "dns_control"
            ? [
                {
                  name: "fleet-artifacts",
                  sizeGb: 3.4,
                  objectsCount: 1420,
                  tier: "Standard (Zero Egress)",
                  zeroEgress: true,
                },
                {
                  name: "fleethub-backups",
                  sizeGb: 1.8,
                  objectsCount: 52,
                  tier: "Standard (Zero Egress)",
                  zeroEgress: true,
                },
              ]
            : [],
      });
    }
  }

  if (!demo) {
    for (const account of accounts) {
      account.workersUsage = { invocationsToday: null, dailyLimit: null, status: "unknown" };
      account.r2Buckets = [];
      account.metricProvenance.workers = "unavailable";
      account.metricProvenance.r2 = "unavailable";
      if (!account.connected) {
        account.zones = [];
        account.zonesCount = 0;
        account.metricProvenance.zones = "unavailable";
        account.dataSource = "unavailable";
        account.observationTime = "";
      }
    }
  }
  const anyConnected = accounts.some((a) => a.connected);
  const allZones = accounts.flatMap((a) => a.zones);
  const allBuckets = accounts.flatMap((a) => a.r2Buckets);
  const totalInvocations = accounts.reduce((acc, a) => acc + (a.workersUsage.invocationsToday ?? 0), 0);

  return {
    connected: anyConnected,
    dataSource: anyConnected ? "partial_live_api" : demo ? "sample_baseline" : "unavailable",
    observationTime: anyConnected ? new Date().toISOString() : demo ? "2026-07-20T12:00:00Z" : "",
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter((a) => a.connected).length,
    accounts,
    zonesCount: allZones.length,
    zones: allZones,
    r2Buckets: allBuckets,
    workersUsage: {
      invocationsToday: demo ? totalInvocations : null,
      dailyLimit: demo ? 100000 * accounts.filter((a) => a.role === "worker_ephemeral" || a.role === "dns_control").length : null,
      status: demo ? "healthy" : "unknown",
    },
    lastPolledAt: new Date().toISOString(),
  };
}
