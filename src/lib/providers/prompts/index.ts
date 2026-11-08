export interface FetchPromptFacts {
  accountLabel: string;
  scopeId?: string;
  region?: string;
  knownKinds: string[];
}

const providers = {
  cloudflare: {
    covered: ["zone", "worker", "kv", "d1", "r2"],
    enumerate: ["DNS records", "Workers and Pages", "KV namespaces", "D1 databases", "R2 buckets", "Durable Objects", "Queues", "Hyperdrive", "Vectorize", "AI Gateway", "Workers AI", "Tunnels", "Access applications and policies", "Load balancers", "other account products"],
  },
  oracle: {
    covered: ["instance", "volume", "bootvolume", "bucket", "database"],
    enumerate: ["compute instances", "block volumes", "boot volumes", "Object Storage buckets", "Autonomous Databases", "VCNs and subnets", "load balancers", "gateways", "file systems", "other accessible OCI resources"],
  },
  upstash: {
    covered: ["redis database"],
    enumerate: ["Redis databases", "QStash topics and endpoints", "Kafka clusters", "Vector databases", "Search indexes", "Upstash Workflow resources", "other products"],
  },
  supabase: {
    covered: ["project"],
    enumerate: ["projects", "project databases and branches", "organizations", "Edge Functions", "storage buckets", "Realtime and authentication configuration", "secrets by name only", "other project resources"],
  },
  neon: {
    covered: ["project"],
    enumerate: ["projects", "branches", "databases", "roles by name only", "compute endpoints", "operations and autoscaling settings", "other organization resources"],
  },
  github: {
    covered: [],
    enumerate: ["organizations and repositories", "Actions runners and workflows", "Codespaces", "packages", "deployments and environments", "webhooks by configuration only", "repository rules", "other visible resources"],
  },
  turso: {
    covered: [],
    enumerate: ["organizations", "groups", "databases", "locations and replicas", "tokens by name or metadata only", "other visible resources"],
  },
  gdrive: {
    covered: [],
    enumerate: ["shared drives", "folders and files with metadata", "storage usage and quota", "permissions by principal and role", "OAuth applications by name only", "other visible resources"],
  },
  modal: {
    covered: [],
    enumerate: ["apps", "functions", "images", "volumes", "secrets by name only", "schedules", "web endpoints", "usage and limits", "other visible resources"],
  },
  kaggle: {
    covered: [],
    enumerate: ["datasets", "models", "notebooks", "competitions", "kernels", "GPU and TPU usage or quotas", "other visible resources"],
  },
} as const;

const safeFact = (value: string | undefined) => (value ?? "not provided").replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "").trim() || "not provided";
const quote = (value: string) => JSON.stringify(value);

export function buildFetchPrompt(provider: string, facts: FetchPromptFacts): string {
  const entry = Object.prototype.hasOwnProperty.call(providers, provider)
    ? providers[provider as keyof typeof providers]
    : null;
  const covered = entry?.covered ?? facts.knownKinds;
  const additional = entry?.enumerate ?? ["all resources and services visible to your authenticated account"];
  const coveredText = covered.length ? covered.join(", ") : "none";
  const missing = additional.filter(kind => !covered.some(known => kind.toLowerCase().includes(known) || known.includes(kind.toLowerCase())));
  const example = {
    provider: safeFact(provider),
    account: safeFact(facts.accountLabel),
    collectedAt: "2026-01-01T00:00:00.000Z",
    resources: [{ kind: "resource_kind", name: "resource name", state: "state", specs: {}, usage: {} }],
    limits: [{ name: "limit name", limit: 0, unit: "unit", used: 0 }],
    notes: [],
  };

  return [
    `# Fetch inventory for ${safeFact(provider)}`,
    "",
    `Account: ${safeFact(facts.accountLabel)}`,
    `Scope ID: ${safeFact(facts.scopeId)}`,
    `Region: ${safeFact(facts.region)}`,
    "",
    "Use your own already-authenticated provider CLI or MCP. Make read-only calls only: do not create, update, delete, deploy, start, stop, or modify anything. Never print, request, copy, or include secrets, credentials, access tokens, private keys, connection strings, or secret values. Secret names or metadata may be listed without their values.",
    "",
    `FleetHub's built-in collector already lists these kinds: ${coveredText}. Known kinds from this account: ${facts.knownKinds.length ? facts.knownKinds.join(", ") : "none provided"}.`,
    `Focus on enumerating these additional kinds and anything else visible in the account: ${missing.join(", ")}.`,
    "List all resources you can read, including their current state, non-secret configuration/specifications, usage, quotas, and limits. Preserve provider-native names. If access is denied or a listing is unavailable, mention it in notes; do not infer that it is empty. Do not include credentials or secret values in any output.",
    "",
    "Return only JSON in this exact shape:",
    JSON.stringify(example),
  ].join("\n");
}

export const fetchPromptProviders = Object.keys(providers);
