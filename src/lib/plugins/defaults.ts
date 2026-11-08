import type { ProviderPlugin, CollectContext, CollectResult } from "./types";
import { pluginRegistry } from "./registry";
import { getOciFleetResources } from "@/lib/providers/oci";

function unavailableCollection(): CollectResult {
  return {
    resources: [],
    samples: [],
    health: { ok: false, latencyMs: 0, error: "Live collection is not implemented for this provider" },
  };
}

export const cloudflarePlugin: ProviderPlugin = {
  id: "cloudflare",
  name: "Cloudflare",
  description: "Edge workers, R2 zero-egress object storage, Pages, and Zero Trust Tunnels.",
  tier: "always_free",
  capabilities: ["serverless", "storage"],
  configFields: [
    { key: "apiToken", label: "API Token", type: "password", description: "Token with Zone: Read permission for the selected account.", required: true, secret: true },
    { key: "accountId", label: "Account ID", type: "text", description: "Cloudflare account whose zones will be listed.", required: true },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `cf-workers-${ctx.accountId}`,
          name: "production-edge-router",
          category: "serverless",
          provider: "cloudflare",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["edge", "worker", "fast"],
          attributes: { env: "prod", routes: ["hub.fleethub.internal/*"] },
        },
        {
          id: `cf-r2-${ctx.accountId}`,
          name: "fleet-artifacts",
          category: "storage",
          provider: "cloudflare",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["r2", "zero-egress", "s3-compatible"],
          attributes: { sizeGb: 4.2, objectCount: 1420 },
        },
      ],
      samples: [
        {
          meterId: "cf.workers.requests",
          providerId: "cloudflare",
          accountEmail: ctx.accountEmail,
          value: 42150,
          observedAt: new Date(),
          method: "api",
        },
        {
          meterId: "cf.r2.storage",
          providerId: "cloudflare",
          accountEmail: ctx.accountEmail,
          value: 4.2,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const upstashPlugin: ProviderPlugin = {
  id: "upstash",
  name: "Upstash",
  description: "Serverless Redis, QStash message queues, and ephemeral Box containers.",
  tier: "always_free",
  capabilities: ["database", "compute"],
  configFields: [
    { key: "apiEmail", label: "Upstash API Email", type: "text", description: "Email for the Upstash Developer API.", required: true },
    { key: "apiKey", label: "Upstash API Key", type: "password", description: "Management API key, preferably read only.", required: true, secret: true },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `upstash-redis-${ctx.accountId}`,
          name: "global-cache-db",
          category: "database",
          provider: "upstash",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["redis", "in-memory", "cache"],
          attributes: { region: "ap-south-1", memoryUsageMb: 18 },
        },
        {
          id: `upstash-box-${ctx.accountId}`,
          name: "ephemeral-task-runner",
          category: "compute",
          provider: "upstash",
          accountEmail: ctx.accountEmail,
          state: "idle",
          tags: ["container", "ephemeral", "amd64"],
          attributes: { vcpus: 2, ramMb: 4096 },
        },
      ],
      samples: [
        {
          meterId: "upstash.redis.commands",
          providerId: "upstash",
          accountEmail: ctx.accountEmail,
          value: 148900,
          observedAt: new Date(),
          method: "api",
        },
        {
          meterId: "upstash.box.hours",
          providerId: "upstash",
          accountEmail: ctx.accountEmail,
          value: 1.8,
          observedAt: new Date(),
          method: "derived",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const supabasePlugin: ProviderPlugin = {
  id: "supabase", name: "Supabase", description: "Supabase projects in one organization.", tier: "always_free", capabilities: ["database"],
  configFields: [
    { key: "accessToken", label: "Access Token", type: "password", description: "Management API token with projects:read permission.", required: true, secret: true },
    { key: "organizationId", label: "Organization ID", type: "text", description: "Organization whose projects will be listed.", required: true },
  ],
  async collect(): Promise<CollectResult> { return unavailableCollection(); },
};

export const githubPlugin: ProviderPlugin = {
  id: "github",
  name: "GitHub",
  description: "Hosted runners, ARC self-hosted runners, and container registries.",
  tier: "always_free",
  capabilities: ["compute"],
  configFields: [
    {
      key: "authMethod",
      label: "Authentication Method",
      type: "select",
      description: "Fine-grained PATs or SSH Deploy Keys restrict access to specific repositories.",
      defaultValue: "fine_grained_pat",
      options: [
        { label: "Fine-Grained PAT (Recommended - Least Privilege)", value: "fine_grained_pat" },
        { label: "Classic Personal Access Token", value: "classic_pat" },
        { label: "SSH Deploy Key (Private Key)", value: "ssh_deploy_key" },
      ],
      required: true,
    },
    {
      key: "token",
      label: "Personal Access Token / Key",
      type: "password",
      description: "GitHub token (github_pat_... or ghp_...) with repo & actions scopes.",
      placeholder: "github_pat_...",
      required: true,
      secret: true,
    },
    {
      key: "sshDeployKey",
      label: "SSH Deploy Key (Optional)",
      type: "textarea",
      description: "Deploy key used for read-only or CI worker git checkouts.",
      placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
      required: false,
      secret: true,
    },
    {
      key: "owner",
      label: "Owner / Organization",
      type: "text",
      description: "GitHub repository owner or organization name.",
      placeholder: "e.g. acme-corp or your-handle",
      required: true,
    },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `github-actions-${ctx.accountId}`,
          name: "hosted-ubuntu-runners",
          category: "compute",
          provider: "github",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["ci-runner", "amd64", "ephemeral"],
          attributes: { parallelExecutors: 2 },
        },
      ],
      samples: [
        {
          meterId: "github.actions.minutes",
          providerId: "github",
          accountEmail: ctx.accountEmail,
          value: 850,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const oraclePlugin: ProviderPlugin = {
  id: "oracle",
  name: "Oracle Cloud",
  description: "Always Free Ampere A1 ARM64 compute (currently 2 OCPUs and 12 GB RAM per tenancy), AMD micro VMs, and block and object storage.",
  tier: "always_free",
  capabilities: ["compute", "storage"],
  configFields: [
    { key: "tenancyId", label: "Tenancy OCID", type: "text", description: "Your tenancy OCID. Leave all fields empty to register this account for manual inventory only.", required: false },
    { key: "userId", label: "User OCID", type: "text", description: "A dedicated read-only IAM user is recommended.", required: false },
    { key: "region", label: "Region", type: "text", description: "For example ap-mumbai-1. One region per account.", placeholder: "ap-mumbai-1", required: false },
    { key: "fingerprint", label: "API key fingerprint", type: "text", description: "Shown in the console after uploading the public key.", required: false, secret: true },
    { key: "privateKey", label: "API private key (PEM)", type: "textarea", description: "Unencrypted PEM. Stored in the secret store; used only for read-only listing. OCI resources stay protected.", required: false, secret: true },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    const start = Date.now();
    try {
      const ociReport = await getOciFleetResources();
      if (!ociReport.connected) {
        return { resources: [], samples: [], health: { ok: false, latencyMs: Date.now() - start, error: "OCI discovery unavailable; offline snapshot excluded from telemetry" } };
      }
      const resources = ociReport.instances.map((inst) => ({
        id: inst.id,
        name: `${inst.name} (${inst.role.split(" ")[0]})`,
        category: "compute" as const,
        provider: "oracle",
        accountEmail: ctx.accountEmail,
        state: (inst.state === "RUNNING" ? "online" : "idle") as any,
        tags: [
          inst.shape.includes("A1") ? "arm64" : "amd64",
          `${inst.ocpus}-ocpu`,
          `${inst.memoryGb}gb`,
          inst.isProtected ? "protected" : "unprotected",
        ],
        attributes: {
          shape: inst.shape,
          processor: inst.processor,
          region: inst.region,
          tenancyProfile: inst.tenancyProfile,
          role: inst.role,
        },
      }));

      return {
        resources,
        samples: ctx.isMock === true ? [
          {
            meterId: "oci.a1.ocpu_hours",
            providerId: "oracle",
            accountEmail: ctx.accountEmail,
            value: ociReport.totalOcpusAllocated * 24 * 15, // realistic cycle calculation
            observedAt: new Date(),
            method: "derived",
          },
          {
            meterId: "oci.storage.block",
            providerId: "oracle",
            accountEmail: ctx.accountEmail,
            value: 147,
            observedAt: new Date(),
            method: "derived",
          },
        ] : [],
        health: { ok: true, latencyMs: Date.now() - start },
      };
    } catch (e: any) {
      return {
        resources: [],
        samples: [],
        health: { ok: false, latencyMs: Date.now() - start, error: e.message },
      };
    }
  },
};

export const tursoPlugin: ProviderPlugin = {
  id: "turso",
  name: "Turso",
  description: "Serverless distributed SQLite database powered by LibSQL.",
  tier: "always_free",
  capabilities: ["database"],
  configFields: [
    {
      key: "authMethod",
      label: "Authentication Method",
      type: "select",
      description: "Authenticate via Database Auth Token or Platform API Key.",
      defaultValue: "db_token",
      options: [
        { label: "Database Auth Token (Least Privilege)", value: "db_token" },
        { label: "Platform API Key (Full Organization Management)", value: "api_key" },
      ],
      required: true,
    },
    {
      key: "databaseUrl",
      label: "LibSQL Database URL",
      type: "text",
      description: "Primary database URL (e.g. libsql://your-db.turso.io).",
      placeholder: "libsql://my-db.turso.io",
      required: true,
    },
    {
      key: "authToken",
      label: "Auth Token / Secret",
      type: "password",
      description: "Turso JWT auth token generated via `turso db tokens create`.",
      placeholder: "eyJhbGciOi...",
      required: true,
      secret: true,
    },
    {
      key: "organization",
      label: "Organization Slug (Optional)",
      type: "text",
      description: "Turso organization or team identifier.",
      placeholder: "e.g. fleethub-team",
      required: false,
    },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `turso-db-${ctx.accountId}`,
          name: "fleethub-edge-db",
          category: "database",
          provider: "turso",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["sqlite", "edge", "libsql"],
          attributes: { syncUrl: ctx.credentials?.databaseUrl || "libsql://fleethub-org.turso.io" },
        },
      ],
      samples: [
        {
          meterId: "turso.storage.bytes",
          providerId: "turso",
          accountEmail: ctx.accountEmail,
          value: 0.85,
          observedAt: new Date(),
          method: "api",
        },
        {
          meterId: "turso.rows.read",
          providerId: "turso",
          accountEmail: ctx.accountEmail,
          value: 12500000,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const neonPlugin: ProviderPlugin = {
  id: "neon",
  name: "Neon Postgres",
  description: "Serverless Postgres with autoscaling, branching, and scale-to-zero.",
  tier: "always_free",
  capabilities: ["database"],
  configFields: [
    { key: "apiKey", label: "Neon API Key", type: "password", description: "Management API key for project listing.", required: true, secret: true },
    { key: "organizationId", label: "Organization ID", type: "text", description: "Organization whose projects will be listed.", required: true },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `neon-pg-${ctx.accountId}`,
          name: "serverless-postgres",
          category: "database",
          provider: "neon",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["postgres", "serverless", "scale-to-zero"],
          attributes: { computeUnits: 0.25 },
        },
      ],
      samples: [
        {
          meterId: "neon.compute.hours",
          providerId: "neon",
          accountEmail: ctx.accountEmail,
          value: 34.5,
          observedAt: new Date(),
          method: "api",
        },
        {
          meterId: "neon.storage.gb",
          providerId: "neon",
          accountEmail: ctx.accountEmail,
          value: 0.28,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const gdrivePlugin: ProviderPlugin = {
  id: "gdrive",
  name: "Google Drive (rclone crypt)",
  description: "Client-side AES-256 encrypted storage remote with rclone and zero provider snooping.",
  tier: "always_free",
  capabilities: ["storage"],
  configFields: [
    {
      key: "authMethod",
      label: "Storage Method",
      type: "select",
      description: "Access via preconfigured rclone crypt remote or service account JSON.",
      defaultValue: "rclone_remote",
      options: [
        { label: "Rclone Crypt Remote (Client-Side Encrypted)", value: "rclone_remote" },
        { label: "Google Service Account JSON", value: "service_account" },
      ],
      required: true,
    },
    {
      key: "remoteName",
      label: "Rclone Remote Name",
      type: "text",
      description: "Configured rclone remote name.",
      defaultValue: "gdrive-crypt:",
      placeholder: "gdrive-crypt:",
      required: true,
    },
    {
      key: "serviceAccountJson",
      label: "Service Account JSON (Optional)",
      type: "textarea",
      description: "GCP Service Account JSON key for autonomous headless backups.",
      placeholder: "{\n  \"project_id\": \"your-project\",\n  \"client_email\": \"...\",\n  ...\n}",
      required: false,
      secret: true,
    },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `gdrive-crypt-${ctx.accountId}`,
          name: "encrypted-vault-drive",
          category: "storage",
          provider: "gdrive",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["rclone", "crypt", "cold-archive"],
          attributes: { encryption: "AES-256", rcloneRemote: ctx.credentials?.remoteName || "gdrive-crypt:" },
        },
      ],
      samples: [
        {
          meterId: "gdrive.storage.bytes",
          providerId: "gdrive",
          accountEmail: ctx.accountEmail,
          value: 8.4,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const modalPlugin: ProviderPlugin = {
  id: "modal",
  name: "Modal",
  description: "Serverless Python compute with GPU bursts, cron jobs, and web endpoints.",
  tier: "always_free",
  capabilities: ["compute"],
  configFields: [
    {
      key: "tokenId",
      label: "Modal Token ID",
      type: "text",
      description: "Modal API Token ID created in settings.",
      placeholder: "ak-...",
      required: true,
    },
    {
      key: "tokenSecret",
      label: "Modal Token Secret",
      type: "password",
      description: "Modal API Token Secret.",
      placeholder: "as-...",
      required: true,
      secret: true,
    },
    {
      key: "workspace",
      label: "Workspace (Optional)",
      type: "text",
      description: "Modal team or personal workspace name.",
      placeholder: "e.g. my-workspace",
      required: false,
    },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `modal-app-${ctx.accountId}`,
          name: "python-batch-runner",
          category: "compute",
          provider: "modal",
          accountEmail: ctx.accountEmail,
          state: "idle",
          tags: ["gpu-burst", "serverless", "python"],
          attributes: { freeMonthlyCredit: "$30" },
        },
      ],
      samples: [
        {
          meterId: "modal.credits.usd",
          providerId: "modal",
          accountEmail: ctx.accountEmail,
          value: 8.5,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const freellmapiPlugin: ProviderPlugin = {
  id: "freellmapi",
  name: "FreeLLM API Gateway",
  description: "Unified AI gateway aggregating free-tier LLM keys across Groq, Gemini, Cerebras, and OpenRouter.",
  tier: "always_free",
  capabilities: ["llm"],
  configFields: [
    {
      key: "gatewayUrl",
      label: "Gateway Endpoint URL",
      type: "text",
      description: "Base URL for the FreeLLMAPI router.",
      defaultValue: "http://localhost:3001/v1",
      placeholder: "http://127.0.0.1:3001/v1",
      required: true,
    },
    {
      key: "apiKey",
      label: "Gateway Unified Key (Optional)",
      type: "password",
      description: "Bearer authentication key for gateway routing.",
      placeholder: "fh_...",
      required: false,
      secret: true,
    },
  ],
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: "freellmapi-gateway",
          name: "freellmapi-router",
          category: "llm",
          provider: "freellmapi",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["gateway", "groq", "gemini", "cerebras", "openrouter"],
          attributes: { endpoint: ctx.credentials?.gatewayUrl || "http://127.0.0.1:3001/v1", healthyBackends: 4 },
        },
      ],
      samples: [
        {
          meterId: "freellmapi.groq.requests",
          providerId: "freellmapi",
          accountEmail: ctx.accountEmail,
          value: 4210,
          observedAt: new Date(),
          method: "api",
        },
        {
          meterId: "freellmapi.gemini.tpd",
          providerId: "freellmapi",
          accountEmail: ctx.accountEmail,
          value: 610,
          observedAt: new Date(),
          method: "api",
        },
      ],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const infisicalPlugin: ProviderPlugin = {
  id: "infisical",
  name: "Infisical Secret Vault",
  description: "Universal Auth encrypted secret broker, zero-secret runtime proxy, and automated credential rotation.",
  tier: "always_free",
  capabilities: ["compute", "storage", "database", "llm"],
  configFields: [
    {
      key: "deploymentMode",
      label: "Deployment Source",
      type: "select",
      description: "Connect to your existing Infisical Vault (Cloud/Self-Hosted) or bundled local Docker service.",
      defaultValue: "existing",
      options: [
        { label: "Connect Existing Vault (Infisical Cloud or Self-Hosted)", value: "existing" },
        { label: "Use Bundled Local Docker Service", value: "bundled" },
      ],
      required: true,
    },
    {
      key: "baseUrl",
      label: "Infisical Console & API URL",
      type: "text",
      description: "Cloud (https://app.infisical.com) or custom self-hosted URL.",
      defaultValue: "https://app.infisical.com",
      placeholder: "https://app.infisical.com",
      required: true,
    },
    {
      key: "clientId",
      label: "Universal Auth Client ID",
      type: "text",
      description: "Machine Identity Client ID with read access to project secrets.",
      placeholder: "e.g. 550e8400-e29b-41d4-a716-446655440000",
      required: true,
    },
    {
      key: "clientSecret",
      label: "Universal Auth Client Secret",
      type: "password",
      description: "Machine Identity Client Secret.",
      placeholder: "Client secret token",
      required: true,
      secret: true,
    },
    {
      key: "projectSlug",
      label: "Project Slug",
      type: "text",
      description: "Default Infisical project slug.",
      placeholder: "e.g. fleethub",
      required: false,
    },
    {
      key: "environment",
      label: "Environment",
      type: "select",
      description: "Default secret environment scope.",
      defaultValue: "prod",
      options: [
        { label: "Production (prod)", value: "prod" },
        { label: "Staging (staging)", value: "staging" },
        { label: "Development (dev)", value: "dev" },
      ],
      required: true,
    },
  ],
  async testConnection(credentials) {
    let url = credentials.baseUrl || "https://app.infisical.com";
    if (process.env.DATABASE_URL?.includes("fleetdeck-db") && (url.includes("127.0.0.1:8088") || url.includes("localhost:8088"))) {
      url = url.replace("127.0.0.1:8088", "infisical:8080").replace("localhost:8088", "infisical:8080");
    }
    try {
      const res = await fetch(`${url}/api/v1/auth/universal-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret }),
      });
      return {
        ok: res.ok,
        message: res.ok ? "Universal Auth successful! Connected to Infisical Vault." : `Auth failed with HTTP ${res.status}`,
      };
    } catch (e: any) {
      return { ok: false, message: `Could not connect to Infisical at ${url}: ${e.message}` };
    }
  },
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    return {
      resources: [
        {
          id: `infisical-vault-${ctx.accountId}`,
          name: "agent-secret-vault",
          category: "storage",
          provider: "infisical",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["secrets", "zero-secret", "universal-auth"],
          attributes: {
            url: ctx.credentials?.baseUrl || "https://app.infisical.com",
            siteUrl: ctx.credentials?.baseUrl || "https://app.infisical.com",
            vaultUrl: ctx.credentials?.baseUrl || "https://app.infisical.com",
            deploymentMode: ctx.credentials?.deploymentMode || "existing",
            environment: ctx.credentials?.environment || "prod",
            projectSlug: ctx.credentials?.projectSlug,
          },
        },
      ],
      samples: [],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const cliproxyapiPlugin: ProviderPlugin = {
  id: "cliproxyapi",
  name: "CLIProxyAPI (Antigravity & AI Router)",
  description: "Wraps Antigravity, Claude Code, ChatGPT Codex, Grok, Kimi, and Devin as OpenAI/Claude/Gemini APIs with multi-credential quota rotation.",
  tier: "always_free",
  capabilities: ["llm"],
  configFields: [
    {
      key: "deploymentMode",
      label: "Deployment Source",
      type: "select",
      description: "Connect to your existing running CLIProxy instance or use bundled Docker service.",
      defaultValue: "existing",
      options: [
        { label: "Connect Existing Instance (Remote, Host, or Tailscale)", value: "existing" },
        { label: "Use Bundled Local Docker Service", value: "bundled" },
      ],
      required: true,
    },
    {
      key: "endpointUrl",
      label: "CLIProxyAPI Base URL",
      type: "text",
      description: "Base URL where CLIProxyAPI is running (e.g. http://127.0.0.1:8317, https://cliproxy.internal, or Tailscale IP).",
      placeholder: "http://127.0.0.1:8317",
      defaultValue: "http://127.0.0.1:8317",
      required: true,
    },
    {
      key: "managementUrl",
      label: "Web Management UI URL (Optional)",
      type: "text",
      description: "Browser URL for the management console, normally /management.html on the API server.",
      placeholder: "https://your-gateway.example/management.html",
      required: false,
    },
    {
      key: "managementKey",
      label: "Management API Secret (CPAMC)",
      type: "password",
      description: "Admin key for CLI Proxy API Management Center and real-time quota inspection.",
      placeholder: "cpamc_secret_...",
      required: false,
      secret: true,
    },
  ],
  async testConnection(credentials) {
    let url = credentials.endpointUrl || "http://127.0.0.1:8317";
    if (process.env.DATABASE_URL?.includes("fleetdeck-db") && (url.includes("127.0.0.1:8317") || url.includes("localhost:8317"))) {
      url = url.replace("127.0.0.1:8317", "cli-proxy-api:8317").replace("localhost:8317", "cli-proxy-api:8317");
    }
    try {
      const res = await fetch(`${url}/v1/models`, {
        headers: credentials.managementKey ? { Authorization: `Bearer ${credentials.managementKey}` } : {},
      });
      return {
        ok: res.ok,
        message: res.ok ? "Successfully connected to CLIProxyAPI gateway." : `Gateway responded with HTTP ${res.status}`,
      };
    } catch (e: any) {
      return { ok: false, message: `Could not connect to CLIProxyAPI at ${url}: ${e.message}` };
    }
  },
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    const endpoint = ctx.credentials?.endpointUrl || "http://127.0.0.1:8317";
    const managementPage = new URL(endpoint);
    managementPage.username = "";
    managementPage.password = "";
    managementPage.pathname = "/management.html";
    managementPage.search = "";
    managementPage.hash = "";
    const managementUrl = ctx.credentials?.managementUrl || managementPage.toString();
    return {
      resources: [
        {
          id: `cliproxy-${ctx.accountId}`,
          name: "cliproxy-ai-gateway",
          category: "llm",
          provider: "cliproxyapi",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["llm-router", "multi-credential", "antigravity", "claude-code", "codex"],
          attributes: {
            endpointUrl: endpoint,
            managementUrl: managementUrl,
            deploymentMode: ctx.credentials?.deploymentMode || "existing",
            platforms: ["Claude Code", "Antigravity", "ChatGPT Codex", "Grok", "Kimi"],
            _infisicalRef: ctx.credentials?._infisicalRef,
            _vaultBackend: ctx.credentials?._vaultBackend,
          },
        },
      ],
      samples: [],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

export const tailscalePlugin: ProviderPlugin = {
  id: "tailscale",
  name: "Tailscale (WireGuard Mesh)",
  description: "Private zero-trust WireGuard mesh interconnecting FleetHub, Oracle Cloud VMs, CLIProxy, and edge egress nodes.",
  tier: "always_free",
  capabilities: ["network"],
  configFields: [
    {
      key: "tailnet",
      label: "Tailnet Name / Domain",
      type: "text",
      description: "Your Tailscale network identifier (e.g. example.ts.net or my-tailnet).",
      placeholder: "e.g. my-tailnet.ts.net",
      required: true,
    },
    {
      key: "authKey",
      label: "Tailscale Auth Key / OAuth Secret",
      type: "password",
      description: "Reusable or tagged auth key (tskey-auth-...) stored encrypted in Infisical.",
      placeholder: "tskey-auth-...",
      required: true,
      secret: true,
    },
    {
      key: "tailscaleIp",
      label: "Hub / Node Tailscale IP",
      type: "text",
      description: "Private WireGuard IP assigned by Tailscale (e.g. 100.80.x.y).",
      placeholder: "100.x.y.z",
      required: false,
    },
    {
      key: "role",
      label: "Network Mesh Role",
      type: "select",
      description: "Topology role for this Tailscale node in the fleet.",
      defaultValue: "mesh_backbone",
      options: [
        { label: "Mesh Backbone (Control Plane & Oracle Interconnect)", value: "mesh_backbone" },
        { label: "Ephemeral Runner Sidecar", value: "agent_sidecar" },
      ],
      required: true,
    },
  ],
  async testConnection(credentials) {
    return { ok: false, message: "Tailscale connection verification is unavailable until live integration is implemented" };
  },
  async collect(ctx: CollectContext): Promise<CollectResult> {
    if (ctx.isMock !== true) return unavailableCollection();
    const start = Date.now();
    const ip = ctx.credentials?.tailscaleIp || "100.64.0.1";
    return {
      resources: [
        {
          id: `tailscale-mesh-${ctx.accountId}`,
          name: `tailscale-${ctx.credentials?.tailnet || "mesh"}`,
          category: "network",
          provider: "tailscale",
          accountEmail: ctx.accountEmail,
          state: "online",
          tags: ["wireguard", "mesh", "private-transport", ctx.credentials?.role || "mesh_backbone"],
          attributes: {
            tailnet: ctx.credentials?.tailnet,
            tailscaleIp: ip,
            role: ctx.credentials?.role || "mesh_backbone",
            _infisicalRef: ctx.credentials?._infisicalRef,
            _vaultBackend: ctx.credentials?._vaultBackend,
          },
        },
      ],
      samples: [],
      health: { ok: true, latencyMs: Date.now() - start },
    };
  },
};

// Register all plugins
pluginRegistry.register(cloudflarePlugin);
pluginRegistry.register(upstashPlugin);
pluginRegistry.register(supabasePlugin);
pluginRegistry.register(githubPlugin);
pluginRegistry.register(oraclePlugin);
pluginRegistry.register(tursoPlugin);
pluginRegistry.register(neonPlugin);
pluginRegistry.register(gdrivePlugin);
pluginRegistry.register(modalPlugin);
pluginRegistry.register(freellmapiPlugin);
pluginRegistry.register(infisicalPlugin);
pluginRegistry.register(cliproxyapiPlugin);
pluginRegistry.register(tailscalePlugin);
