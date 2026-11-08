import { z } from "zod";

export type DetectedPlan = "free" | "paid" | undefined;

const named = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

export const cfZonePlan = z.object({ name: z.string().optional(), legacy_id: z.string().optional() });
export const cfSubscriptions = z.object({ success: z.literal(true), result: z.array(z.object({ price: z.number().optional(), state: z.string().optional() })) });

export const zoneIsFree = (plan: z.infer<typeof cfZonePlan> | undefined): boolean | undefined =>
  plan === undefined || (plan.name === undefined && plan.legacy_id === undefined) ? undefined : named(plan.legacy_id) === "free" || named(plan.name).startsWith("free");

/** A paid zone or a paid subscription proves a paid account. All zones free proves a free account only when the billing list was readable and shows nothing paid. */
export function cloudflarePlan(zoneFree: Array<boolean | undefined>, subscriptions: z.infer<typeof cfSubscriptions>["result"] | null): DetectedPlan {
  if (zoneFree.some(free => free === false)) return "paid";
  if (subscriptions?.some(item => (item.price ?? 0) > 0 && named(item.state) === "paid")) return "paid";
  return subscriptions !== null && zoneFree.every(free => free === true) ? "free" : undefined;
}

/** Supabase says "free", "pro", "team", "enterprise"; Neon says "free_v2", "launch", "scale", and so on. */
export function orgPlan(plan: string | undefined): DetectedPlan {
  const value = named(plan);
  if (!value) return undefined;
  return value.startsWith("free") ? "free" : "paid";
}

/** Upstash reports a type per database. Any paid database proves a paid account; databases that are all free are a free account. */
export function upstashPlan(types: Array<string | undefined>): DetectedPlan {
  const known = types.filter((type): type is string => Boolean(named(type)));
  if (known.some(type => named(type) !== "free")) return "paid";
  return known.length > 0 && known.length === types.length ? "free" : undefined;
}
export const upstashBilling = (type: string | undefined): "free_tier" | "billable" | undefined => (named(type) === "" ? undefined : named(type) === "free" ? "free_tier" : "billable");

/** Oracle has no plan endpoint this key can read. A resource that costs money proves the tenancy is paid; Always Free shapes prove nothing. */
export function ociPlan(billing: Array<"free_tier" | "billable" | undefined>): DetectedPlan {
  return billing.includes("billable") ? "paid" : undefined;
}
export function ociShapeBilling(shape: string): "free_tier" | "billable" {
  return /A1\.Flex/i.test(shape) || /E2\.1\.Micro/i.test(shape) ? "free_tier" : "billable";
}
