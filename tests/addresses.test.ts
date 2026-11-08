import { describe, expect, it } from "vitest";
import { addressKind, ambiguousHostKeys, hostKey } from "@/lib/capacity/addresses";
import { measurementFreshness } from "@/lib/capacity/host";

describe("host addresses", () => {
  it("treats every spelling of a machine name as one key", () => {
    expect(hostKey("polar-night-owl")).toBe(hostKey("Polar_Night Owl"));
  });
  it("classifies IPv4 literals and ignores names", () => {
    expect(addressKind("100.101.50.7")).toBe("tailscale");
    expect(addressKind("10.0.0.190")).toBe("private");
    expect(addressKind("172.20.1.1")).toBe("private");
    expect(addressKind("192.168.1.9")).toBe("private");
    expect(addressKind("203.0.113.25")).toBe("public");
    expect(addressKind("172.32.0.1")).toBe("public");
    expect(addressKind("atlas")).toBeNull();
    expect(addressKind("999.1.1.1")).toBeNull();
  });
  it("flags a key shared by two different names, but not the same name repeated", () => {
    expect([...ambiguousHostKeys(["web-1", "web1", "borealis", "Borealis", "atlas"])]).toEqual(["web1"]);
    expect(ambiguousHostKeys([]).size).toBe(0);
  });
  it("calls a reading fresh for an hour, stale for a day, then expired", () => {
    const now = new Date("2026-11-07T12:00:00Z"), ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    expect(measurementFreshness(ago(59), now)).toBe("fresh");
    expect(measurementFreshness(ago(61), now)).toBe("stale");
    expect(measurementFreshness(ago(25 * 60), now)).toBe("expired");
    expect(measurementFreshness(new Date())).toBe("fresh");
  });
});
