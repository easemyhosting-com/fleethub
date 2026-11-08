import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import {
  getSessionFromRequest,
  getCanonicalOrigin,
  isAllowedOrigin,
  getGoogleRedirectUri,
  hashPassword,
  verifyPassword,
  createSessionToken,
  createSessionCookie,
  createClearSessionCookie,
  hasAuthSecret,
  isGoogleAuthEnabled,
  type SessionUser,
} from "@/lib/auth/session";
import { checkAuthRateLimit, readJsonWithLimit } from "@/lib/auth/guard";
import { createServerSession, describeClient, publicUser, resolveSession, revokeSession, SessionLimitReached } from "@/lib/auth/sessions";

export const dynamic = "force-dynamic";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});
const requestSchema = z.discriminatedUnion("action", [
  credentialsSchema.extend({ action: z.literal("login") }),
  credentialsSchema.extend({
    action: z.literal("register"),
    password: z.string().min(12).max(1024),
    name: z.string().trim().min(1).max(120).optional(),
    bootstrapToken: z.string().min(1),
  }),
  z.object({ action: z.literal("logout") }),
]);

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function validBootstrapToken(candidate: string): boolean {
  const configured = process.env.FLEETHUB_BOOTSTRAP_TOKEN;
  if (!configured || Buffer.byteLength(configured, "utf8") < 32) return false;
  const expected = crypto.createHash("sha256").update(configured).digest();
  const actual = crypto.createHash("sha256").update(candidate).digest();
  return crypto.timingSafeEqual(expected, actual);
}

async function setSession(req: Request, user: SessionUser) {
  let sid: string;
  try {
    sid = await createServerSession(user, "browser", "operator", describeClient(req));
  } catch (cause) {
    return cause instanceof SessionLimitReached ? error("Too many active sessions. Revoke one under Devices first.", 429) : error("Authentication temporarily unavailable", 503);
  }
  const token = createSessionToken({ ...user, sid });
  const response = NextResponse.json({ success: true, user: publicUser(user) });
  response.headers.set("Set-Cookie", createSessionCookie(token, req));
  return response;
}

export async function GET(req: Request) {
  try {
    if (!await checkAuthRateLimit(req, false)) return error("Too many authentication attempts", 429);
  } catch {
    return error("Authentication temporarily unavailable", 503);
  }
  const resolved = await resolveSession(req);
  const user = resolved.user;
  let googleRedirectUri: string | null = null;
  try {
    googleRedirectUri = getGoogleRedirectUri(getCanonicalOrigin(req));
  } catch {
    // The UI must not show a redirect URI from an invalid origin configuration.
  }
  let registrationAvailable = false;
  if (hasAuthSecret() && process.env.FLEETHUB_BOOTSTRAP_TOKEN && Buffer.byteLength(process.env.FLEETHUB_BOOTSTRAP_TOKEN, "utf8") >= 32) {
    try {
      const result = await bootstrapDatabase();
      if (result.success) {
        const [row] = await queryClient`SELECT NOT EXISTS (SELECT 1 FROM app_users) AS available`;
        registrationAvailable = row?.available === true;
      }
    } catch {
      // A failed lookup must not advertise registration.
    }
  }
  return NextResponse.json({
    authenticated: Boolean(user),
    user: user ? publicUser(user) : null,
    googleEnabled: isGoogleAuthEnabled(),
    googleRedirectUri,
    authRequired: process.env.FLEETHUB_AUTH_REQUIRED === "true",
    registrationAvailable,
  });
}

export async function POST(req: Request) {
  try {
    if (!isAllowedOrigin(req)) return error("Invalid request origin", 403);
  } catch {
    return error("Invalid request origin", 403);
  }
  if ((req.headers.has("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin")) {
    return error("Invalid request origin", 403);
  }

  try {
    if (!await checkAuthRateLimit(req)) return error("Too many authentication attempts", 429);
  } catch {
    return error("Authentication temporarily unavailable", 503);
  }

  const bodyResult = await readJsonWithLimit<unknown>(req);
  if (!bodyResult.ok) return error(bodyResult.error, bodyResult.status);
  const parsed = requestSchema.safeParse(bodyResult.data);
  if (!parsed.success) return error("Invalid authentication request", 400);
  const body = parsed.data;

  if (body.action === "logout") {
    const sid = getSessionFromRequest(req)?.sid;
    let serverRevoked = !sid;
    if (sid) { try { serverRevoked = await revokeSession(sid); } catch { serverRevoked = false; } }
    const response = NextResponse.json({ success: true, serverRevoked });
    response.headers.set("Set-Cookie", createClearSessionCookie(req));
    return response;
  }

  if (body.action === "register") {
    if (!validBootstrapToken(body.bootstrapToken) || !hasAuthSecret()) return error("Registration unavailable", 403);
    try {
      const bootstrapped = await bootstrapDatabase();
      if (!bootstrapped.success) return error("Authentication temporarily unavailable", 503);
      const user = await queryClient.begin(async (transaction) => {
        await transaction`LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE`;
        const [existing] = await transaction`SELECT EXISTS (SELECT 1 FROM app_users) AS present`;
        if (existing?.present) return null;
        const passwordHash = await hashPassword(body.password);
        const id = `usr-${crypto.randomUUID()}`;
        const name = body.name ?? body.email.split("@")[0];
        await transaction`
          INSERT INTO app_users (id, email, password_hash, name, auth_provider)
          VALUES (${id}, ${body.email}, ${passwordHash}, ${name}, 'local')
        `;
        return { id, email: body.email, name, provider: "local", createdAt: Date.now() } satisfies SessionUser;
      });
      if (!user) return error("Registration unavailable", 403);
      return await setSession(req, user);
    } catch {
      return error("Registration failed", 500);
    }
  }

  try {
    const bootstrapped = await bootstrapDatabase();
    if (!bootstrapped.success) return error("Authentication temporarily unavailable", 503);
    const [dbUser] = await queryClient`
      SELECT id, email, password_hash, name, auth_provider
      FROM app_users
      WHERE LOWER(email) = ${body.email}
      LIMIT 1
    `;
    if (dbUser?.auth_provider === "local" && typeof dbUser.password_hash === "string" &&
        await verifyPassword(body.password, dbUser.password_hash)) {
      const user: SessionUser = {
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name || dbUser.email.split("@")[0],
        provider: "local",
        createdAt: Date.now(),
      };
      return await setSession(req, user);
    }
    return error("Invalid email or password", 401);
  } catch {
    return error("Authentication temporarily unavailable", 503);
  }
}
