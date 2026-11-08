/**
 * FleetHub API Authentication & Authorization Guard
 * 
 * Provides defense-in-depth protection across all API routes:
 * 1. Bearer Token & x-api-key verification against FLEETHUB_API_KEY (admin) and FLEETHUB_READONLY_KEY (scoped read-only).
 * 2. Strict production fail-closed policy: ALL requests (reads & writes) rejected if unauthenticated.
 * 3. Streaming request payload size limiter (64 KB) with a 5-second slow-read deadline against slow-loris attacks.
 * 4. Rate limiting per client identity/token with proxy header validation.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { consumeSharedLimit } from "./rate-limit";
import { isAllowedOrigin, getSessionFromRequest, SessionUser } from "./session";
import { resolveSession, type SessionScope } from "./sessions";
import { refreshRuntimeEnv } from "@/lib/config/runtime-env";
import { authenticateAgentKey, isAgentKeyFormat } from "./agent-keys";

export const isOperator = (auth: { user?: unknown; scope?: string; principalId?: string }) => Boolean((auth.user && auth.scope === "operator") || auth.principalId === "api:admin");

export interface AuthVerificationResult {
  authorized: boolean;
  reason?: string;
  status: number;
  user?: SessionUser;
  principalId?: string;
  scope?: SessionScope;
}

// In-memory rate limiting map: identifier -> { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_READ_REQUESTS_PER_MIN = 120;
const MAX_WRITE_REQUESTS_PER_MIN = 20;
export const MAX_PAYLOAD_SIZE_BYTES = 64 * 1024; // 64 KB

const identityHashKey = process.env.FLEETHUB_RATE_LIMIT_SECRET || process.env.FLEETHUB_API_KEY || process.env.FLEETHUB_READONLY_KEY || process.env.FLEETHUB_AUTH_SECRET || crypto.randomBytes(32);
const knownAgentIdentities = new Map<string, number>();
function rememberAgentKey(token: string) {
  const now = Date.now();
  for (const [digest, expiresAt] of knownAgentIdentities) if (expiresAt <= now) knownAgentIdentities.delete(digest);
  if (knownAgentIdentities.size >= 500) knownAgentIdentities.delete(knownAgentIdentities.keys().next().value!);
  knownAgentIdentities.set(crypto.createHmac("sha256", identityHashKey).update(token).digest("hex"), now + 5 * 60_000);
}
function getClientIdentifier(req: Request): string {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.substring(7).trim()
    : (req.headers.get("x-api-key") || req.headers.get("x-fleethub-token") || "").trim();
  const authenticated = [process.env.FLEETHUB_API_KEY, process.env.FLEETHUB_READONLY_KEY]
    .some((key) => key?.trim() && timingSafeEqualStr(token, key.trim()));
  if (authenticated) return `auth:${crypto.createHmac("sha256", identityHashKey).update(token).digest("hex")}`;
  if (isAgentKeyFormat(token)) {
    const digest = crypto.createHmac("sha256", identityHashKey).update(token).digest("hex");
    if ((knownAgentIdentities.get(digest) ?? 0) > Date.now()) return `agent:${digest}`;
  }
  const session = getSessionFromRequest(req);
  if (session) return `session:${crypto.createHmac("sha256", identityHashKey).update(session.id).digest("hex")}`;
  // Only enable behind an ingress that strips and replaces this header.
  const trustedHeader = process.env.FLEETHUB_TRUSTED_IP_HEADER;
  if (trustedHeader && ["cf-connecting-ip", "x-real-ip"].includes(trustedHeader)) {
    const ip = req.headers.get(trustedHeader)?.trim();
    if (ip) return `ip:${crypto.createHmac("sha256", identityHashKey).update(ip).digest("hex")}`;
  }
  return "anonymous";
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function checkRateLimit(req: Request, isWrite: boolean, namespace = "api"): { allowed: boolean; remaining: number } {
  const identifier = `${namespace}:${isWrite ? "write" : "read"}:${getClientIdentifier(req)}`;
  for (const [key, entry] of rateLimitMap) {
    if (Date.now() - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
  }
  const now = Date.now();
  const maxRequests = isWrite ? MAX_WRITE_REQUESTS_PER_MIN : MAX_READ_REQUESTS_PER_MIN;

  const entry = rateLimitMap.get(identifier);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(identifier, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count };
}

async function checkSharedRateLimit(req: Request, isWrite: boolean, namespace = "api") {
  const key = `${namespace}:${isWrite ? "write" : "read"}:${getClientIdentifier(req)}`;
  return consumeSharedLimit(key, isWrite ? MAX_WRITE_REQUESTS_PER_MIN : MAX_READ_REQUESTS_PER_MIN);
}

export async function checkAuthRateLimit(req: Request, isWrite = true): Promise<boolean> {
  const isProd = process.env.NODE_ENV === "production" && process.env.FLEETHUB_LOCAL_MODE !== "true";
  return (isProd ? await checkSharedRateLimit(req, isWrite, "login") : checkRateLimit(req, isWrite, "login")).allowed;
}

/**
 * Streaming JSON parser that enforces a hard payload size limit and a 5-second slow-read deadline.
 */
export async function readJsonWithLimit<T = any>(
  req: Request,
  maxBytes = MAX_PAYLOAD_SIZE_BYTES,
  timeoutMs = 5000
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Payload too large. Maximum allowed size is ${maxBytes / 1024} KB.`,
    };
  }

  if (!req.body) {
    return { ok: true, data: {} as T };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  // Enforce slow-read deadline: reading stream must complete within timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ timeout: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timeout: true }), timeoutMs);
  });

  try {
    while (true) {
      const readPromise = reader.read();
      const raceResult = await Promise.race([readPromise, timeoutPromise]);

      if ("timeout" in raceResult) {
        try {
          void reader.cancel("Slow read deadline exceeded").catch(() => {});
        } catch {
          // Ignore cancel error
        }
        return {
          ok: false,
          status: 408,
          error: `Request timeout. Body stream exceeded ${timeoutMs / 1000}s slow-read deadline.`,
        };
      }

      const { done, value } = raceResult;
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            void reader.cancel("Payload exceeded maximum allowed size").catch(() => {});
          } catch {
            // Ignore cancel error
          }
          return {
            ok: false,
            status: 413,
            error: `Payload too large. Stream exceeded ${maxBytes / 1024} KB.`,
          };
        }
        chunks.push(value);
      }
    }
  } catch (err: any) {
    return { ok: false, status: 400, error: "Failed to read request body" };
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  if (chunks.length === 0) {
    return { ok: true, data: {} as T };
  }

  const totalBuffer = Buffer.concat(chunks);
  try {
    const text = totalBuffer.toString("utf-8");
    const json = JSON.parse(text);
    return { ok: true, data: json };
  } catch {
    return { ok: false, status: 400, error: "Malformed JSON payload" };
  }
}

export async function verifyApiAccess(
  req: Request,
  options?: { requireWrite?: boolean; skipRateLimit?: boolean; allowObservationKey?: boolean }
): Promise<AuthVerificationResult> {
  refreshRuntimeEnv();
  // Fail closed if request is undefined or malformed
  if (!req || typeof req.method !== "string") {
    return {
      authorized: false,
      reason: "Unauthorized: Valid Request object is required.",
      status: 401,
    };
  }

  const isWrite = options?.requireWrite ?? (req.method !== "GET" && req.method !== "HEAD");
  const isProd = process.env.NODE_ENV === "production" && process.env.FLEETHUB_LOCAL_MODE !== "true";
  const configuredAdminKey = process.env.FLEETHUB_API_KEY;
  const configuredReadOnlyKey = process.env.FLEETHUB_READONLY_KEY;

  // 1. Fast Content-Length pre-check
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE_BYTES) {
    return {
      authorized: false,
      reason: `Payload too large. Maximum allowed request size is ${MAX_PAYLOAD_SIZE_BYTES / 1024} KB.`,
      status: 413,
    };
  }

  // 2. Check Rate Limiting
  let rateLimit: { allowed: boolean };
  try {
    rateLimit = options?.skipRateLimit ? { allowed: true }
      : isProd ? await checkSharedRateLimit(req, isWrite) : checkRateLimit(req, isWrite);
  } catch {
    return { authorized: false, status: 503, reason: "Shared rate limiter unavailable" };
  }
  if (!options?.skipRateLimit && !rateLimit.allowed) {
    return {
      authorized: false,
      reason: `Rate limit exceeded. Maximum ${isWrite ? MAX_WRITE_REQUESTS_PER_MIN : MAX_READ_REQUESTS_PER_MIN} requests per minute.`,
      status: 429,
    };
  }

  // Explicit credentials take precedence over cookies and development access.
  // A typo in a supplied token must never fall through to anonymous access.
  const authorization = req.headers.get("authorization");
  const apiKey = req.headers.get("x-api-key");
  const fleetToken = req.headers.get("x-fleethub-token");
  const bearer = authorization === null ? null : /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] ?? "";
  const tokens = [bearer, apiKey?.trim() ?? null, fleetToken?.trim() ?? null]
    .filter((value): value is string => value !== null);
  const reporterKey = process.env.FLEETHUB_OBSERVATION_KEY?.trim();
  const reporterSecret = process.env.FLEETHUB_AUTH_SECRET;
  const validReporter = (token: string) => Boolean(options?.allowObservationKey &&
    req.method === "POST" && new URL(req.url).pathname === "/api/observations" &&
    reporterKey && Buffer.byteLength(reporterKey) >= 32 && reporterSecret && Buffer.byteLength(reporterSecret) >= 32 &&
    timingSafeEqualStr(token, reporterKey));
  const validAdmin = (token: string) => Boolean(configuredAdminKey?.trim() && timingSafeEqualStr(token, configuredAdminKey.trim()));
  const validReadOnly = (token: string) => Boolean(configuredReadOnlyKey?.trim() && timingSafeEqualStr(token, configuredReadOnlyKey.trim()));
  let agentKeyId: string | null = null;
  if (tokens.length === 1 && isAgentKeyFormat(tokens[0]) && !validAdmin(tokens[0]) && !validReadOnly(tokens[0])) {
    const agent = await authenticateAgentKey(tokens[0]);
    if (agent.status === "unavailable") return { authorized: false, reason: "Agent key store unavailable", status: 503 };
    if (agent.status === "valid") { agentKeyId = agent.id; rememberAgentKey(tokens[0]); }
  }
  if (!agentKeyId && tokens.some((token) => !token || (!validAdmin(token) && !validReadOnly(token) && !validReporter(token)))) {
    return { authorized: false, reason: "Unauthorized: Invalid API credentials.", status: 401 };
  }
  if (agentKeyId) {
    if (isWrite) return { authorized: false, reason: "Forbidden: Agent keys are read-only and cannot perform mutations or write operations.", status: 403 };
    return { authorized: true, status: 200, principalId: `agent-key:${agentKeyId}` };
  }

  const resolved = tokens.length === 0 ? await resolveSession(req) : null;
  if (resolved && !resolved.user && resolved.failure === "unavailable") return { authorized: false, status: 503, reason: "Session store unavailable" };
  if (resolved && !resolved.user && resolved.failure === "inactive") return { authorized: false, status: 401, reason: "Unauthorized: Session ended or revoked. Sign in again." };
  if (resolved?.user && tokens.length === 0) {
    if (isWrite) {
      try {
        if (!isAllowedOrigin(req) ||
            (req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin")) {
          return { authorized: false, status: 403, reason: "Forbidden: Invalid request origin." };
        }
      } catch {
        return { authorized: false, status: 403, reason: "Forbidden: Invalid request origin." };
      }
    }
    if (isWrite && resolved.scope === "read") return { authorized: false, status: 403, reason: "Forbidden: This device is read-only and cannot perform mutations or write operations." };
    return { authorized: true, status: 200, user: resolved.user, scope: resolved.scope };
  }

  // 5. Check for Scoped Read-Only Key
  const isReadOnlyMatch = tokens.some(validReadOnly);

  if (isReadOnlyMatch) {
    if (isWrite) {
      return {
        authorized: false,
        reason: "Forbidden: Scoped read-only API key cannot perform mutations or write operations.",
        status: 403,
      };
    }
    return { authorized: true, status: 200 };
  }

  if (tokens.length > 0 && tokens.every(validReporter)) {
    return { authorized: true, status: 200, principalId: `agent:${crypto.createHmac("sha256", reporterSecret!).update(reporterKey!).digest("hex")}` };
  }

  // 6. Check for Full Access / Admin Key
  const isAdminMatch = tokens.length > 0 && tokens.every(validAdmin);

  if (isAdminMatch) {
    return { authorized: true, status: 200, principalId: "api:admin" };
  }

  // 7. Explicit Strict Policy if Auth is mandated
  if (process.env.FLEETHUB_AUTH_REQUIRED === "true") {
    return {
      authorized: false,
      reason: "Unauthorized: Sign in with Email/Password or Google OAuth.",
      status: 401,
    };
  }

  // 8. Strict Production Policy: Fail-Closed on ALL requests if unauthenticated
  if (isProd) {
    return {
      authorized: false,
      reason: "Unauthorized: FLEETHUB_API_KEY must be configured in production to access FleetHub API endpoints.",
      status: 401,
    };
  }

  // 7. Development Mode:
  if (configuredAdminKey && configuredAdminKey.trim().length > 0) {
    return {
      authorized: false,
      reason: "Unauthorized: Invalid or missing API key. Provide Authorization: Bearer <token> or x-api-key.",
      status: 401,
    };
  }

  // In development without configured key: mutations require local origin
  if (isWrite && process.env.FLEETHUB_DEV_ALLOW_ANONYMOUS_WRITE !== "true") {
    const ident = getClientIdentifier(req);
    const isLocal = ["ip:127.0.0.1", "ip:::1"].includes(ident);
    if (!isLocal) {
      return {
        authorized: false,
        reason: "Unauthorized: Remote write operations require FLEETHUB_API_KEY authentication.",
        status: 401,
      };
    }
  }

  return { authorized: true, status: 200 };
}

export function createUnauthorizedResponse(result: AuthVerificationResult) {
  return NextResponse.json(
    {
      error: result.reason || "Unauthorized",
      status: result.status,
      timestamp: new Date().toISOString(),
    },
    {
      status: result.status,
      headers: {
        "WWW-Authenticate": 'Bearer realm="FleetHub API"',
        "Content-Type": "application/json",
      },
    }
  );
}
