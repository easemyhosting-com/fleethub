import { z } from "zod";

const slug = z.string().regex(/^[a-z][a-z0-9-]{1,38}$/);
const ref = z.string().regex(/^[A-Za-z0-9_.:\/-]{1,256}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

export const projectSlug = slug;
export const createProjectInput = z.strictObject({
  slug, name: text(80),
  repoUrl: z.url({ protocol: /^https$/ }).max(300).optional(),
  environment: z.enum(["prod", "staging", "dev"]).default("prod"),
  criticality: z.enum(["low", "normal", "high"]).default("normal"),
  notes: text(500).optional(),
});
export const createProjectKeyInput = z.strictObject({ projectId: z.string().regex(/^prj-[0-9a-f-]{36}$/), expiresInDays: z.number().int().min(1).max(365).default(90) });

export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);

/** What a project asks for. Categories match inventory categories; ci is a placement hint for compute. */
export const needInput = z.strictObject({
  kind: z.enum(["compute", "storage", "database", "serverless", "llm", "network"]),
  purpose: text(200),
  spec: z.strictObject({
    cpu: z.number().min(0).max(1024).optional(),
    memoryGb: z.number().min(0).max(65536).optional(),
    storageGb: z.number().min(0).max(1_000_000).optional(),
    durationHours: z.number().min(0).max(24 * 365).optional(),
    alwaysOn: z.boolean().optional(),
    providers: z.array(text(40)).max(10).optional(),
    arch: z.enum(["arm64", "amd64"]).optional(),
  }).default({}),
});
export type NeedInput = z.infer<typeof needInput>;

const isoTime = z.iso.datetime({ offset: true });
/** What a project actually uses. Neither side needs the other: a usage report never requires a prior need. */
export const usageInput = z.strictObject({
  resource: ref,
  amount: z.number().nonnegative().finite().optional(),
  unit: text(24).optional(),
  periodStart: isoTime,
  periodEnd: isoTime,
  metrics: z.record(z.string().regex(/^[a-z][A-Za-z0-9_]{0,31}$/), z.number().finite()).refine(value => Object.keys(value).length <= 16).default({}),
}).refine(value => Date.parse(value.periodEnd) >= Date.parse(value.periodStart), { message: "periodEnd before periodStart" });
export type UsageInput = z.infer<typeof usageInput>;

export function validUsagePeriod(input: UsageInput, now = Date.now()): boolean {
  const start = Date.parse(input.periodStart), end = Date.parse(input.periodEnd);
  return end <= now + 60_000 && start >= now - 31 * 86_400_000 && end - start <= 31 * 86_400_000;
}

/** Owner's correction of how a project was classified. `auto` returns control to discovery. Only these fields can change. */
export const updateProjectInput = z.strictObject({
  projectId: z.string().regex(/^prj-[0-9a-f-]{36}$/),
  kind: z.enum(["app", "service", "platform", "auto"]).optional(),
  name: z.string().trim().min(1).max(80).optional(),
}).refine(value => value.kind !== undefined || value.name !== undefined, { message: "nothing to change" });
