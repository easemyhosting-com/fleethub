import { describe, expect, it } from "vitest";
import nextConfig, { contentSecurityPolicy, securityHeaders } from "../next.config";
describe("baseline security headers", () => {
 it("applies framing, sniffing, referrer and transport protections to every route", async () => {
  const rules = await nextConfig.headers!();
  expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders }]);
  const map = new Map(securityHeaders.map(header => [header.key, header.value]));
  expect(map.get("X-Frame-Options")).toBe("DENY"); expect(map.get("X-Content-Type-Options")).toBe("nosniff"); expect(map.get("Referrer-Policy")).toBe("no-referrer");
  expect(map.get("Content-Security-Policy")).toContain("frame-ancestors 'none'"); expect(map.get("Strict-Transport-Security")).toMatch(/max-age=\d+/);
  expect(nextConfig.poweredByHeader).toBe(false);
 });
});

it("restricts every fetchable resource to this origin, allowing eval only in development", () => {
  const directives = (policy: string) => new Map(policy.split("; ").map(entry => { const [name, ...values] = entry.split(" "); return [name, values]; }));
  const production = directives(contentSecurityPolicy(false));
  expect(production.get("default-src")).toEqual(["'self'"]);
  expect(production.get("connect-src")).toEqual(["'self'"]);
  expect(production.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
  expect(production.get("object-src")).toEqual(["'none'"]);
  expect(production.get("frame-ancestors")).toEqual(["'none'"]);
  expect(contentSecurityPolicy(false)).not.toContain("unsafe-eval");
  expect(directives(contentSecurityPolicy(true)).get("script-src")).toContain("'unsafe-eval'");
});
