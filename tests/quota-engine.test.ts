import { describe, it, expect } from "vitest";
import { getNextResetDate, formatCountdown, evaluateQuota } from "../src/lib/quota/engine";

describe("Quota Math Engine", () => {
  const baseTime = new Date("2026-10-24T12:00:00Z");

  it("calculates next reset date for daily UTC window", () => {
    const next = getNextResetDate({ kind: "daily", tz: "UTC" }, baseTime);
    expect(next?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });

  it("calculates next reset date for calendar_month window", () => {
    const next = getNextResetDate({ kind: "calendar_month", tz: "UTC" }, baseTime);
    expect(next?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("calculates next reset date for billing_cycle window", () => {
    const next = getNextResetDate({ kind: "billing_cycle", anchor: "account" }, baseTime);
    expect(next?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("calculates next reset date for rolling window", () => {
    const next = getNextResetDate({ kind: "rolling", days: 7 }, baseTime);
    expect(next?.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });

  it("returns null for none or session_duration window", () => {
    expect(getNextResetDate({ kind: "none" }, baseTime)).toBeNull();
    expect(getNextResetDate({ kind: "session_duration", maxHours: 4 }, baseTime)).toBeNull();
    // @ts-expect-error test unknown window kind
    expect(getNextResetDate({ kind: "unknown" }, baseTime)).toBeNull();
  });

  it("formats human-readable countdowns correctly across day, hour, minute and expired ranges", () => {
    expect(formatCountdown(null)).toBe("Continuous / No reset");

    const expired = new Date("2026-10-24T11:59:00Z");
    expect(formatCountdown(expired, baseTime)).toBe("Resetting now");

    const in3Days = new Date("2026-10-27T14:30:00Z");
    expect(formatCountdown(in3Days, baseTime)).toBe("3d 2h");

    const in4Hours = new Date("2026-10-24T16:15:00Z");
    expect(formatCountdown(in4Hours, baseTime)).toBe("4h 15m");

    const in20Minutes = new Date("2026-10-24T12:20:00Z");
    expect(formatCountdown(in20Minutes, baseTime)).toBe("20m");
  });

  it("evaluates healthy, warning, critical, and exhausted quota states", () => {
    const window = { kind: "daily", tz: "UTC" } as const;

    const healthy = evaluateQuota(1000, 200, window, baseTime);
    expect(healthy.status).toBe("healthy");
    expect(healthy.remaining).toBe(800);
    expect(healthy.percentUsed).toBe(20);

    const warning = evaluateQuota(1000, 750, window, baseTime);
    expect(warning.status).toBe("warning");
    expect(warning.percentUsed).toBe(75);

    const critical = evaluateQuota(1000, 920, window, baseTime);
    expect(critical.status).toBe("critical");
    expect(critical.percentUsed).toBe(92);

    const exhausted = evaluateQuota(1000, 1050, window, baseTime);
    expect(exhausted.status).toBe("exhausted");
    expect(exhausted.remaining).toBe(0);
    expect(exhausted.percentUsed).toBe(100);
  });

  it("handles zero limits and burn-rate overage projection for calendar_month", () => {
    const monthWindow = { kind: "calendar_month", tz: "UTC" } as const;

    // Zero limit edge case
    const zeroLimit = evaluateQuota(0, 0, monthWindow, baseTime);
    expect(zeroLimit.percentUsed).toBe(0);
    expect(zeroLimit.status).toBe("healthy");

    // Over-limit exhausted check
    const overLimit = evaluateQuota(100, 100, monthWindow, baseTime);
    expect(overLimit.status).toBe("exhausted");

    // Mid-month high burn rate that projects overage
    // BaseTime is 24 days into October. If used is 850 / 1000, burn rate will exceed 1000 by Oct 31
    const projected = evaluateQuota(1000, 850, monthWindow, baseTime);
    expect(projected.projectedOverage).toBe(true);

    // Mid-month low burn rate that does not project overage
    const lowBurn = evaluateQuota(1000, 100, monthWindow, baseTime);
    expect(lowBurn.projectedOverage).toBe(false);

    // Exact start of month edge case (elapsedMs === 0)
    const startOfMonth = new Date(Date.UTC(2026, 9, 1, 0, 0, 0));
    const atStart = evaluateQuota(1000, 50, monthWindow, startOfMonth);
    expect(atStart.projectedOverage).toBe(false);
  });

  it("safely handles NaN, negative, and non-finite inputs with unknown status", () => {
    const window = { kind: "daily", tz: "UTC" } as const;

    const nanCheck = evaluateQuota(1000, NaN, window, baseTime);
    expect(nanCheck.status).toBe("unknown");
    expect(nanCheck.isValid).toBe(false);
    expect(nanCheck.percentUsed).toBe(0);

    const negCheck = evaluateQuota(-500, 100, window, baseTime);
    expect(negCheck.status).toBe("unknown");
    expect(negCheck.isValid).toBe(false);

    const infCheck = evaluateQuota(Infinity, 100, window, baseTime);
    expect(infCheck.status).toBe("unknown");
    expect(infCheck.isValid).toBe(false);
  });
});
