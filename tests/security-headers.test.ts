import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../next.config";
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
