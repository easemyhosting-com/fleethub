import { NextResponse, type NextRequest } from "next/server";
import { verifyApiAccess, createUnauthorizedResponse } from "./lib/auth/guard";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if ((path === "/api/auth" && (request.method === "GET" || request.method === "POST")) ||
      (path === "/api/auth/google" && request.method === "GET") ||
      (path === "/api/auth/callback/google" && request.method === "GET") ||
      (path === "/api/devices/pair" && request.method === "POST") ||
      ((path === "/api/hooks/needs" || path === "/api/hooks/usage" || path === "/api/hooks/gitops" || path === "/api/hooks/rescan") && request.method === "POST")) {
    // These handlers perform their own validation and rate limiting (hooks authenticate with a per-project key).
    return NextResponse.next();
  }
  const result = await verifyApiAccess(request, { allowObservationKey: request.method === "POST" && request.nextUrl.pathname === "/api/observations", skipRateLimit: true, requireWrite: request.nextUrl.pathname === "/api/mcp" ? false : undefined });
  return result.authorized ? NextResponse.next() : createUnauthorizedResponse(result);
}

export const middleware = proxy;
export const config = { matcher: ["/api/:path*"] };
