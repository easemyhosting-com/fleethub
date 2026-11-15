import { authenticateProjectKey } from "./keys";
import { z } from "zod";
import { consumeSharedLimit } from "@/lib/auth/rate-limit";

export const hookRequestsPerMinute = 120;
export const hookTimestampWindowMs = 5 * 60 * 1000;
const windows = new Map<string, { count: number; start: number }>();
/** Shared through PostgreSQL in production, like the API limiter; otherwise a per-process window. A failing shared limiter denies, never allows. */
async function allow(projectId: string, now: number): Promise<boolean> {
  if (process.env.NODE_ENV === "production" && process.env.FLEETHUB_LOCAL_MODE !== "true") return consumeSharedLimit(`hook:${projectId}`, hookRequestsPerMinute).then(result => result.allowed, () => false);
  const entry = windows.get(projectId);
  if (!entry || now - entry.start > 60_000) { windows.set(projectId, { count: 1, start: now }); return true; }
  entry.count += 1;
  return entry.count <= hookRequestsPerMinute;
}
export type HookAuth = { ok: true; projectId: string } | { ok: false; status: 400 | 401 | 429 | 503; error: string };

/** Project key as bearer token, a fresh X-FleetHub-Timestamp (replay window), and a per-project rate limit. The key only reaches its own project. */
const isoInstant = z.iso.datetime({ offset: true });

export async function authenticateHook(req: Request, now = Date.now()): Promise<HookAuth> {
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!bearer) return { ok: false, status: 401, error: "Missing project key" };
  const auth = await authenticateProjectKey(bearer);
  if (auth.status === "unavailable") return { ok: false, status: 503, error: "Project key store unavailable" };
  if (auth.status === "invalid") return { ok: false, status: 401, error: "Invalid project key" };
  // A zone-less time would be read in server-local time, so an explicit Z or offset is required.
  const header = req.headers.get("x-fleethub-timestamp") ?? "";
  const stamp = isoInstant.safeParse(header).success ? Date.parse(header) : Number.NaN;
  if (!Number.isFinite(stamp) || Math.abs(now - stamp) > hookTimestampWindowMs) return { ok: false, status: 400, error: "X-FleetHub-Timestamp must be an ISO time within five minutes of now" };
  const limited = await allow(auth.projectId, now);
  if (!limited) return { ok: false, status: 429, error: "Rate limit exceeded" };
  return { ok: true, projectId: auth.projectId };
}
