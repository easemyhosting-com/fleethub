import type { ObservabilityMethod } from "../catalog/schema";

export interface DiscoveredResource {
  id: string;
  name: string;
  category: "compute" | "storage" | "database" | "serverless" | "llm" | "network";
  provider: string;
  accountEmail: string;
  state: "online" | "idle" | "busy" | "offline" | "ephemeral";
  tags: string[];
  attributes: Record<string, unknown>;
}

export interface QuotaSample {
  meterId: string;
  providerId: string;
  accountEmail: string;
  value: number;
  observedAt: Date;
  method: ObservabilityMethod;
}

export interface CollectContext {
  providerId?: string;
  accountId: string;
  accountEmail: string;
  credentials: Record<string, string>;
  isMock?: boolean;
}

export interface CollectResult {
  resources: DiscoveredResource[];
  samples: QuotaSample[];
  health: { ok: boolean; latencyMs: number; error?: string };
}

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "number" | "textarea";
  description: string;
  placeholder?: string;
  defaultValue?: string | number;
  options?: Array<{ label: string; value: string }>;
  required: boolean;
  secret?: boolean;
}

export interface ProviderPlugin {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tier?: "always_free" | "usage_based" | "hybrid";
  readonly capabilities: Array<"compute" | "storage" | "database" | "serverless" | "llm" | "network">;
  readonly configFields?: ConfigField[];
  collect(ctx: CollectContext): Promise<CollectResult>;
  testConnection?(credentials: Record<string, any>): Promise<{ ok: boolean; message?: string }>;
}
