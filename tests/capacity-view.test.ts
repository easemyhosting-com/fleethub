import { describe, expect, it } from "vitest";
import { barPercentage, formatCores, formatGiB, statusLabel, validCpuAsk, validMemoryAsk } from "@/lib/capacity/view";
import type { HostStatus } from "@/lib/capacity/host";

describe("capacity view helpers", () => {
  it("formats CPU and memory values", () => {
    expect(formatCores(1630)).toBe("1.63 cores");
    expect(formatCores(1000)).toBe("1 core");
    expect(formatGiB(3482)).toBe("3.4 GiB");
  });

  it("labels every host status in words", () => {
    expect(((["ok", "tight", "over", "no_data", "unknown_size"] as HostStatus[]).map(statusLabel))).toEqual(["OK", "Tight", "Over-requested", "No data", "Size unknown"]);
  });

  it("clamps bar percentages and handles unknown totals", () => {
    expect(barPercentage(150, 100)).toBe(100);
    expect(barPercentage(-5, 100)).toBe(0);
    expect(barPercentage(5, null)).toBe(0);
  });

  it("validates expected CPU and memory ask formats", () => {
    expect(validCpuAsk("500m")).toBe(true);
    expect(validCpuAsk("1")).toBe(true);
    expect(validCpuAsk("oops")).toBe(false);
    expect(validMemoryAsk("256Mi")).toBe(true);
    expect(validMemoryAsk("1Gi")).toBe(true);
    expect(validMemoryAsk("-1Gi")).toBe(false);
  });
});
