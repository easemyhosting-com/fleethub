import { describe, expect, it } from "vitest";
import { buildPairLink, connectionResult, formatRemaining, parsePairHash } from "../src/lib/pairing/link";
describe("pairing link helpers", () => {
 it("puts the code in the URL fragment so servers and logs never see it, and reads it back", () => {
  const link = buildPairLink("https://fleet.example:8443/", "ABCD-EFGH-JKLM");
  expect(link).toBe("https://fleet.example:8443/pair#code=ABCD-EFGH-JKLM"); expect(new URL(link).search).toBe("");
  expect(parsePairHash(new URL(link).hash)).toBe("ABCD-EFGH-JKLM"); expect(parsePairHash("#code=abcd-efgh-jklm")).toBe("ABCD-EFGH-JKLM");
 });
 it("ignores malformed or missing codes", () => {
  for (const hash of ["", "#", "#code=", "#code=short", "#code=ABCD-EFGH-JKL0", "#other=ABCD-EFGH-JKLM", "#code=ABCD-EFGH-JKLM-X"]) expect(parsePairHash(hash)).toBeNull();
 });
 it("formats the time left and stops at expiry", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  expect(formatRemaining("2026-01-01T00:04:05Z", now)).toBe("4:05"); expect(formatRemaining("2026-01-01T00:00:00.500Z", now)).toBe("0:01");
  expect(formatRemaining("2026-01-01T00:00:00Z", now)).toBeNull(); expect(formatRemaining("not a date", now)).toBeNull();
 });
 it("reports waiting, connected and ended states for the code the operator created", () => {
  const item = (status: "pending" | "used" | "expired" | "cancelled") => ({ id: "pair-1", status, label: "My phone", scope: "read" as const });
  expect(connectionResult(null, [item("used")])).toEqual({ kind: "none" }); expect(connectionResult("pair-9", [item("used")])).toEqual({ kind: "none" });
  expect(connectionResult("pair-1", [item("pending")])).toEqual({ kind: "waiting" });
  expect(connectionResult("pair-1", [item("used")])).toEqual({ kind: "connected", label: "My phone", scope: "read" });
  expect(connectionResult("pair-1", [item("expired")])).toEqual({ kind: "ended", reason: "expired" }); expect(connectionResult("pair-1", [item("cancelled")])).toEqual({ kind: "ended", reason: "cancelled" });
 });
});
