import { z } from "zod";

export type ContactKind = "email" | "phone";
export type ProviderKind =
  | "oracle"
  | "cloudflare"
  | "google"
  | "nvidia"
  | "upstash"
  | "github"
  | "freellmapi"
  | "turso"
  | "neon";
export type AccountHealth = "ok" | "degraded" | "error" | "pending";

export interface IdentityContact {
  id: string;
  identityId: string;
  kind: ContactKind;
  value: string;
  isPrimary: boolean;
  isVerified: boolean;
  label?: string | null;
  createdAt?: string;
  maskedValue?: string;
}

export interface SafeSecretRef {
  id: string;
  label: string;
  status: string;
  lastVerifiedAt?: string | null;
  infisicalProject: string;
  environment: string;
  path: string;
  keysCount: number;
}

export interface LinkedResource {
  id: string;
  name: string;
  category: "compute" | "storage" | "database" | "serverless" | "llm";
  provider: string;
  accountId: string;
  state: "online" | "idle" | "busy" | "offline" | "ephemeral";
  isProtected: boolean;
  tags: string[];
  attributes: Record<string, unknown>;
  billing?: "free_tier" | "billable" | "unknown";
  lastSeenAt: string;
}

export interface LinkedQuotaMeter {
  id: string;
  accountId: string;
  key: string;
  name: string;
  category: string;
  unit: string;
  limitValue: number;
  currentValue?: number;
  warnPct: number;
  critPct: number;
  source: "api" | "derived" | "manual" | "none";
  observationTime?: string;
}

export interface ProviderAccountDetail {
  plan?: "free" | "paid" | "unknown";
  contactId?: string | null;
  archived?: boolean;
  id: string;
  identityId: string;
  provider: ProviderKind;
  label: string;
  ownerEmail: string;
  loginEmail: string;
  role: string;
  isProtected: boolean;
  health: AccountHealth;
  healthDetail?: string | null;
  secretRefId?: string | null;
  secretRef?: SafeSecretRef | null;
  resources: LinkedResource[];
  quotaMeters: LinkedQuotaMeter[];
  notes?: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface IdentityWithAccounts {
  id: string;
  displayName: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  contacts: IdentityContact[];
  accounts: ProviderAccountDetail[];
}

export type GraphNodeType = "identity" | "email" | "provider" | "account" | "resource" | "quota" | "secret_ref";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  subLabel?: string;
  isProtected?: boolean;
  health?: AccountHealth;
  role?: string;
  provider?: ProviderKind;
  parentId?: string;
  childCount?: number;
  observationTime?: string;
  provenance?: "live" | "derived" | "manual" | "sample";
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface IdentityGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: {
    totalIdentities: number;
    totalProviders: number;
    totalAccounts: number;
    protectedAccounts: number;
    totalResources: number;
    totalQuotaMeters: number;
  };
}

/**
 * Mask phone numbers by default for PII protection.
 * E.g. "+1 (555) 010-0198" -> "+1 •••-••0198"
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || phone.trim().length === 0) return "";
  const cleaned = phone.trim();
  // Keep only the country code and last 4 digits; the area code is never shown
  if (cleaned.length <= 4) return "••••";
  const lastFour = cleaned.slice(-4);
  const prefix = cleaned.match(/^\+\d{1,3}(?=[\s(-])/)?.[0] ?? "+";
  return `${prefix} •••-••${lastFour}`;
}

/**
 * Input validation schemas
 */
export const CreateIdentitySchema = z.object({
  displayName: z.string().min(2, "Display name must be at least 2 characters").max(100),
  notes: z.string().max(500).optional(),
});

export const AddContactSchema = z
  .object({
    identityId: z.string().min(1, "Identity ID is required"),
    kind: z.enum(["email", "phone"]),
    value: z.string().min(3).max(100),
    isPrimary: z.boolean().default(false),
    isVerified: z.boolean().default(false),
    label: z.string().max(50).optional(),
  })
  .refine(
    (data) => {
      if (data.kind === "email") {
        return z.string().email().safeParse(data.value).success;
      }
      return data.value.replace(/[^0-9]/g, "").length >= 7;
    },
    {
      message: "Invalid contact value format",
    }
  );

export const LinkAccountSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  identityId: z.string().min(1, "Identity ID is required"),
  provider: z.string().min(2),
  label: z.string().min(2),
  loginEmail: z.string().email().optional(),
  role: z.string().min(1).optional(),
  isProtected: z.boolean().optional(),
  notes: z.string().optional(),
});

export const UpdateProtectionSchema = z.object({
  accountId: z.string().min(1),
  isProtected: z.boolean(),
  reason: z.string().optional(),
});
