import { z } from "zod";
import type { ProviderPlugin } from "@/lib/plugins/types";

const boundedText = z.string().trim().min(1).max(200);
export const providerOnboardingSchema = z.strictObject({
  accountId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/).optional(),
  providerId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: boundedText,
  ownerEmail: z.email().max(254).optional(),
  identityId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).optional(),
  loginEmail: z.email().max(254).optional(),
  role: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
  isProtected: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(1000).optional(),
  skipConnectionTest: z.boolean().optional(),
  // Previous form versions send these bookkeeping fields. They are never persisted.
  vaultBackend: z.string().max(64).optional(),
  infisicalReference: z.string().max(512).optional(),
});

export type ProviderOnboarding = z.infer<typeof providerOnboardingSchema>;

const legacyBookkeepingKeys = new Set(["_vaultBackend", "_infisicalRef"]);
const publicSelectKeys = new Set([
  "authMethod", "region", "role", "deploymentMode", "environment", "routingStrategy",
]);

export type ConfigDecision =
  | { kind: "inventory"; publicConfig: Record<string, string> }
  | { kind: "invalid"; error: string }
  | { kind: "vault-required" };

export function classifyProviderConfig(plugin: ProviderPlugin, config: Record<string, unknown>): ConfigDecision {
  const fields = new Map((plugin.configFields ?? []).map((field) => [field.key, field]));
  const publicConfig: Record<string, string> = {};
  let needsVault = false;

  for (const [key, value] of Object.entries(config)) {
    if (legacyBookkeepingKeys.has(key)) {
      if (value !== undefined && typeof value !== "string") return { kind: "invalid", error: "Invalid legacy config field" };
      continue;
    }
    const field = fields.get(key);
    if (!field) return { kind: "invalid", error: "Unsupported config field" };
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" && typeof value !== "number") {
      return { kind: "invalid", error: "Invalid config field" };
    }
    if (typeof value === "number" && (!Number.isFinite(value) || field.type !== "number")) {
      return { kind: "invalid", error: "Invalid config field" };
    }
    const text = String(value);
    if (text.length > (field.secret ? 8192 : 512)) return { kind: "invalid", error: "Config field is too long" };
    if (field.options && !field.options.some((option) => option.value === text)) {
      return { kind: "invalid", error: "Invalid config option" };
    }
    if (field.secret || field.type === "password" || field.type === "textarea" || !publicSelectKeys.has(key) || field.type !== "select") {
      // Freeform strings, paths and URLs can carry credentials even when a plugin
      // marks them as ordinary text. Do not test, save, or echo them yet.
      needsVault = true;
      continue;
    }
    publicConfig[key] = text;
  }

  return needsVault ? { kind: "vault-required" } : { kind: "inventory", publicConfig };
}

const pendingStatus = "pending_verification";

export function publicProviderMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (!("onboardingStatus" in value) || ![pendingStatus, "credentials_vaulted"].includes(String(value.onboardingStatus))) return {};
  return { onboardingStatus: value.onboardingStatus };
}

const numericResourceFields = [
  "sizeGb", "objectCount", "memoryUsageMb", "vcpus", "ramMb", "parallelExecutors", "computeUnits", "healthyBackends",
  "ocpu", "vcpu", "ram_gb", "free_ram_gb", "total_gb", "used_gb", "cap_gb", "storage_cap_gb",
  "monthly_cap", "used", "port", "free_minutes_month",
];

export function publicResourceAttributes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const key of numericResourceFields) {
    const item = Object.getOwnPropertyDescriptor(value, key)?.value;
    if (typeof item === "number" && Number.isFinite(item) && item >= 0) result[key] = item;
  }
  return result;
}

const publicSpecKeys = ["product", "shape", "arch", "capacityKind", "ocpus", "memoryGb", "sizeGb", "availabilityDomain", "cpuCoreCount", "storageTb", "freeTier", "billing"] as const;

/** Descriptive, non-secret facts (shape, size, architecture) copied from provider listings; anything else stored with a resource stays private. */
export function publicResourceSpecs(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const key of publicSpecKeys) {
    const item = Object.getOwnPropertyDescriptor(value, key)?.value;
    if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)) || (typeof item === "string" && item.length <= 256)) result[key] = item;
  }
  return result;
}

const publicTags = new Set([
  "arm64", "amd64", "docker", "brain", "protected", "k3s", "ephemeral", "burst", "ci-runner",
  "s3", "zero-egress", "crypt", "worker", "boot-volume", "block", "redis", "fast", "in-memory",
  "h100", "nim", "cuda", "sqlite", "edge", "libsql", "router", "tailnet-only", "mcp", "sandbox",
  "r2", "s3-compatible", "container", "postgres", "serverless", "scale-to-zero", "rclone",
  "cold-archive", "gpu-burst", "python", "gateway", "secrets", "zero-secret", "universal-auth",
  "llm-router", "multi-credential", "antigravity", "claude-code", "codex", "wireguard", "mesh",
  "private-transport",
]);

export function publicResourceTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string" && publicTags.has(tag)) : [];
}

export type ResourceBilling = "free_tier" | "billable" | "unknown";
export function resourceBilling(value: unknown): ResourceBilling {
  const item = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "billing")?.value : undefined;
  return item === "free_tier" || item === "billable" ? item : "unknown";
}
