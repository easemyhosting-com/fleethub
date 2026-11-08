import { describe, expect, it } from "vitest";
import { pairingPolicy, scopeAllowed } from "../src/lib/pairing/policy";
describe("pairing policy", () => {
 it("defaults to enabled with QR sharing and operator devices allowed", () => {
  expect(pairingPolicy({})).toEqual({ enabled: true, qr: true, maxScope: "operator" });
  expect(pairingPolicy({ FLEETHUB_DEVICE_PAIRING: "", FLEETHUB_PAIRING_QR: "", FLEETHUB_PAIRING_MAX_SCOPE: "" })).toEqual({ enabled: true, qr: true, maxScope: "operator" });
 });
 it("can turn off pairing, QR/link sharing and operator devices independently", () => {
  for (const value of ["off", "FALSE", " 0 ", "no", "disabled"]) expect(pairingPolicy({ FLEETHUB_DEVICE_PAIRING: value }).enabled).toBe(false);
  expect(pairingPolicy({ FLEETHUB_PAIRING_QR: "disabled" })).toEqual({ enabled: true, qr: false, maxScope: "operator" });
  expect(pairingPolicy({ FLEETHUB_PAIRING_MAX_SCOPE: " Read " }).maxScope).toBe("read");
  expect(pairingPolicy({ FLEETHUB_DEVICE_PAIRING: "typo" }).enabled).toBe(true);
 });
 it("never allows a scope above the maximum", () => {
  expect(scopeAllowed({ enabled: true, qr: true, maxScope: "read" }, "operator")).toBe(false); expect(scopeAllowed({ enabled: true, qr: true, maxScope: "read" }, "read")).toBe(true);
  expect(scopeAllowed({ enabled: true, qr: true, maxScope: "operator" }, "operator")).toBe(true);
 });
});
