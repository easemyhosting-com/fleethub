import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { getAllowedOrigins, isAllowedOrigin, isSecureRequest } from "../src/lib/auth/session";
const tailnet = "https://fleet.tailnet.ts.net:8443";
const req = (origin?: string) => new Request(`${tailnet}/api/auth`, { method: "POST", headers: origin ? { origin } : {} });
beforeEach(() => { vi.stubEnv("FLEETHUB_APP_URL", tailnet); });
afterEach(() => vi.unstubAllEnvs());
describe("additional allowed origins", () => {
 it("defaults to the canonical origin only", () => {
  expect(getAllowedOrigins(req())).toEqual([tailnet]); expect(isAllowedOrigin(req(tailnet))).toBe(true); expect(isAllowedOrigin(req("http://localhost:3060"))).toBe(false); expect(isAllowedOrigin(req())).toBe(false);
 });
 it("adds exact https or loopback-http origins and ignores everything else", () => {
  vi.stubEnv("FLEETHUB_ALLOWED_ORIGINS", ` http://localhost:3060/ , https://other.example , http://192.168.1.5:3060 , http://localhost:3060/path , https://user:pw@evil.example , ftp://localhost , not a url , ${tailnet} `);
  expect(getAllowedOrigins(req())).toEqual([tailnet, "http://localhost:3060", "https://other.example"]);
  expect(isAllowedOrigin(req("http://localhost:3060"))).toBe(true); expect(isAllowedOrigin(req("http://localhost:3061"))).toBe(false); expect(isAllowedOrigin(req("http://192.168.1.5:3060"))).toBe(false); expect(isAllowedOrigin(req("https://evil.example"))).toBe(false);
 });
 it("sets Secure cookies by the origin that made the request", () => {
  vi.stubEnv("FLEETHUB_ALLOWED_ORIGINS", "http://localhost:3060");
  expect(isSecureRequest(req(tailnet))).toBe(true); expect(isSecureRequest(req("http://localhost:3060"))).toBe(false);
  expect(isSecureRequest(req("https://evil.example"))).toBe(true); expect(isSecureRequest(req())).toBe(true);
 });
});
