/**
 * Infisical Secrets Management Integration
 * Complies strictly with the Zero-Secret Rule:
 * Never stores or exposes plaintext secrets in the database, API responses, or UI.
 * Uses operator-configured Infisical Universal Auth and optional Agent Vault endpoints.
 */

export interface InfisicalWorkspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdAt: string;
  environments: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  secretCount?: number;
  secretKeys?: string[];
}

export interface SecretReferenceItem {
  id: string;
  provider: string;
  path: string;
  environment: string;
  workspaceName: string;
  workspaceId: string;
  keys: string[];
  status: "verified" | "pending" | "missing";
  lastVerifiedAt: string;
  agentVaultProxyUrl?: string;
  notes: string;
}

export interface InfisicalVaultStatus {
  connected: boolean;
  domain: string;
  environment: string;
  project: string;
  authMethod: "universal-auth" | "agent-vault";
  agentVault: {
    uiUrl: string;
    proxyUrl: string;
    status: "online" | "offline";
    ip: string;
  };
  totalWorkspaces: number;
  totalSecretKeys: number;
  lastSyncedAt: string;
  workspaces: InfisicalWorkspace[];
  secretReferences: SecretReferenceItem[];
}

function getCredentials() {
  return {
    baseUrl: process.env.INFISICAL_URL || "",
    clientId: process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID || "",
    clientSecret: process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET || "",
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export function _resetTokenCache() {
  cachedToken = null;
}

async function getUniversalAuthToken(): Promise<string | null> {
  const { baseUrl, clientId, clientSecret } = getCredentials();
  if (!clientId || !clientSecret) {
    // Fail closed: Missing credentials must never use a hardcoded fallback
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/auth/universal-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[Infisical] Auth failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.accessToken) {
      cachedToken = {
        token: data.accessToken,
        expiresAt: Date.now() + (data.expiresIn ? data.expiresIn * 1000 : 3600000),
      };
      return data.accessToken;
    }
    return null;
  } catch (err: any) {
    console.warn(`[Infisical] Error acquiring token:`, err.message);
    return null;
  }
}

export async function checkAgentVaultStatus(): Promise<"online" | "offline"> {
  try {
    const url = process.env.AGENT_VAULT_URL;
    if (!url) return "offline";
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2000),
    });
    return res.status === 200 ? "online" : "offline";
  } catch {
    // Fail closed: Do not report "online" if unreachable
    return "offline";
  }
}

export async function getInfisicalStatus(): Promise<InfisicalVaultStatus> {
  const { baseUrl } = getCredentials();
  const agentVaultState = await checkAgentVaultStatus();
  const token = await getUniversalAuthToken();

  let workspaces: InfisicalWorkspace[] = [];
  const secretReferences: SecretReferenceItem[] = [];
  let totalKeys = 0;

  if (token) {
    try {
      const wsRes = await fetch(`${baseUrl}/api/v1/workspace`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });

      if (wsRes.ok) {
        const wsData = await wsRes.json();
        const rawWorkspaces = wsData.workspaces || [];

        // For each workspace, fetch secret keys for prod environment
        for (const ws of rawWorkspaces) {
          let secretKeys: string[] = [];
          let secretsVerified = false;
          try {
            const secRes = await fetch(
              `${baseUrl}/api/v3/secrets/raw?workspaceId=${encodeURIComponent(ws.id)}&environment=prod&viewSecretValue=false`,
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(4000),
              }
            );
            if (secRes.ok) {
              const secData = await secRes.json();
              if (Array.isArray(secData.secrets)) {
                secretsVerified = true;
                // Metadata only: map keys, never store or inspect plaintext values
                secretKeys = secData.secrets
                  .map((s: any) => s.secretKey || s.key || s.name)
                  .filter(Boolean);
              }
            }
          } catch {
            // Non-fatal if specific workspace permissions differ
          }

          totalKeys += secretKeys.length;

          workspaces.push({
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
            description: ws.description || "",
            createdAt: ws.createdAt,
            environments: ws.environments || [],
            secretCount: secretKeys.length,
            secretKeys,
          });

          secretReferences.push({
            id: `sec-ws-${ws.slug}`,
            provider: ws.name,
            path: `/projects/${ws.slug}/prod`,
            environment: "prod",
            workspaceName: ws.name,
            workspaceId: ws.id,
            keys: secretKeys,
            status: secretsVerified ? "verified" : "pending",
            lastVerifiedAt: secretsVerified ? new Date().toISOString() : "",
            agentVaultProxyUrl: process.env.AGENT_VAULT_URL,
            notes: `Managed securely via Infisical Universal Auth (${ws.environments?.length || 0} envs)`,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[Infisical] Workspace fetch error:`, err.message);
    }
  }

  const isLive = Boolean(token && workspaces.length > 0);

  // Fallback to sample projects ONLY in test or demo environments
  if (workspaces.length === 0 && (process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test")) {
    workspaces = [
      {
        id: "demo-workspace-gateway",
        name: "freellmapi-keys",
        slug: "freellmapi-keys",
        description: "FreeLLM API Gateway keys & provider tokens",
        createdAt: "2026-01-01T00:00:00.000Z",
        environments: [{ id: "demo-env-gateway", name: "Production", slug: "prod" }],
        secretCount: 5,
        secretKeys: ["INFISICAL_OAUTH_COOKIE_SECRET", "FREELLMAPI_API_KEY", "AI_MODEL", "AI_BASE_URL", "GOOGLE_OAUTH_CLIENT_SECRET"],
      },
      {
        id: "demo-workspace-infrastructure",
        name: "infrastructure",
        slug: "infrastructure",
        description: "Fleet infrastructure credentials & cloud tokens",
        createdAt: "2026-01-01T00:00:00.000Z",
        environments: [{ id: "demo-env-infrastructure", name: "Production", slug: "prod" }],
        secretCount: 8,
        secretKeys: ["OCI_TENANCY_OCID", "OCI_USER_OCID", "OCI_FINGERPRINT", "CLOUDFLARE_API_TOKEN", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
      },
      {
        id: "demo-workspace-agents",
        name: "ai-agent-credentials",
        slug: "ai-agent-credentials",
        description: "Coding agents & autonomous bot keys",
        createdAt: "2026-01-01T00:00:00.000Z",
        environments: [{ id: "demo-env-agents", name: "Production", slug: "prod" }],
        secretCount: 4,
        secretKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY"],
      },
    ];
    totalKeys = 17;
  }

  return {
    connected: isLive,
    domain: baseUrl,
    environment: "prod",
    project: "Fleet & Router Secrets",
    authMethod: "universal-auth",
    agentVault: {
      uiUrl: process.env.AGENT_VAULT_URL || "",
      proxyUrl: process.env.AGENT_VAULT_PROXY_URL || "",
      status: agentVaultState,
      ip: "",
    },
    totalWorkspaces: workspaces.length,
    totalSecretKeys: totalKeys,
    lastSyncedAt: new Date().toISOString(),
    workspaces,
    secretReferences: secretReferences.length > 0 ? secretReferences : (process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test") ? [
      {
        id: "sec-freellmapi-keys",
        provider: "FreeLLM API Gateway",
        path: "/freellmapi-keys/prod",
        environment: "prod",
        workspaceName: "freellmapi-keys",
        workspaceId: "demo-workspace-gateway",
        keys: ["FREELLMAPI_API_KEY", "AI_MODEL", "AI_BASE_URL", "GOOGLE_OAUTH_CLIENT_SECRET"],
        status: isLive ? "verified" : "pending",
        lastVerifiedAt: new Date().toISOString(),
        agentVaultProxyUrl: process.env.AGENT_VAULT_URL,
        notes: isLive
          ? "Universal Auth verified against secrets.fleethub.dev"
          : "Offline baseline snapshot (live auth unconfigured)",
      },
      {
        id: "sec-infrastructure",
        provider: "Infrastructure & OCI",
        path: "/infrastructure/prod",
        environment: "prod",
        workspaceName: "infrastructure",
        workspaceId: "demo-workspace-infrastructure",
        keys: ["OCI_TENANCY_OCID", "OCI_USER_OCID", "CLOUDFLARE_API_TOKEN", "R2_ACCESS_KEY_ID"],
        status: isLive ? "verified" : "pending",
        lastVerifiedAt: new Date().toISOString(),
        agentVaultProxyUrl: process.env.AGENT_VAULT_URL,
        notes: isLive
          ? "Universal Auth verified against secrets.fleethub.dev"
          : "Offline baseline snapshot (live auth unconfigured)",
      },
    ] : [],
  };
}
