import type { ResetWindow } from "../catalog/schema";

export interface QuotaCalculation {
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  status: "healthy" | "warning" | "critical" | "exhausted" | "unknown";
  nextResetAt: Date | null;
  resetCountdown: string;
  projectedOverage: boolean;
  isValid: boolean;
}

/**
 * Calculates next reset date based on the supported window shapes
 */
export function getNextResetDate(window: ResetWindow, now = new Date()): Date | null {
  const current = new Date(now.getTime());

  switch (window.kind) {
    case "daily": {
      // Next day 00:00:00 UTC
      return new Date(Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth(),
        current.getUTCDate() + 1,
        0, 0, 0, 0
      ));
    }
    case "calendar_month": {
      // 1st of next month 00:00:00 UTC
      return new Date(Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth() + 1,
        1,
        0, 0, 0, 0
      ));
    }
    case "billing_cycle": {
      // Default to 1st of next calendar month unless customized anchor day is known
      return new Date(Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth() + 1,
        1,
        0, 0, 0, 0
      ));
    }
    case "rolling": {
      // Continuous sliding window: usage slides off continuously based on window.days
      // Represents the rolling window expiration for the current moment
      return new Date(current.getTime() + window.days * 24 * 60 * 60 * 1000);
    }
    case "session_duration":
    case "none":
    default:
      return null;
  }
}

/**
 * Returns a human-friendly countdown string (e.g. "4d 12h", "5h 22m", "42m")
 */
export function formatCountdown(target: Date | null, now = new Date()): string {
  if (!target) return "Continuous / No reset";

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "Resetting now";

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  const remainingMinutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }
  if (totalHours > 0) {
    return `${totalHours}h ${remainingMinutes}m`;
  }
  return `${remainingMinutes}m`;
}

/**
 * Evaluates usage against limit and window.
 * Strictly guards against NaN, non-finite, and negative inputs by returning 'unknown' status.
 */
export function evaluateQuota(
  limit: number,
  used: number,
  window: ResetWindow,
  now = new Date()
): QuotaCalculation {
  // Input validation: reject NaN, Infinity, -Infinity, and negative values
  if (
    !Number.isFinite(limit) ||
    !Number.isFinite(used) ||
    Number.isNaN(limit) ||
    Number.isNaN(used) ||
    limit < 0 ||
    used < 0
  ) {
    return {
      used: Number.isFinite(used) && used >= 0 ? used : 0,
      limit: Number.isFinite(limit) && limit >= 0 ? limit : 0,
      remaining: 0,
      percentUsed: 0,
      status: "unknown",
      nextResetAt: null,
      resetCountdown: "Invalid / Missing Data",
      projectedOverage: false,
      isValid: false,
    };
  }

  const remaining = Math.max(0, limit - used);
  const percentUsed = limit > 0 ? (used / limit) * 100 : 0;

  let status: QuotaCalculation["status"] = "healthy";
  if (percentUsed >= 100) {
    status = "exhausted";
  } else if (percentUsed >= 90) {
    status = "critical";
  } else if (percentUsed >= 75) {
    status = "warning";
  }

  const nextResetAt = getNextResetDate(window, now);
  const resetCountdown = window.kind === "rolling"
    ? `Rolling ${window.days}d window`
    : formatCountdown(nextResetAt, now);

  // Burn-rate projection for month windows
  let projectedOverage = false;
  if (window.kind === "calendar_month" && nextResetAt) {
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const elapsedMs = now.getTime() - startOfMonth.getTime();
    const totalMsInMonth = nextResetAt.getTime() - startOfMonth.getTime();

    if (elapsedMs > 0) {
      const burnRatePerMs = used / elapsedMs;
      const projectedEndUsage = burnRatePerMs * totalMsInMonth;
      projectedOverage = projectedEndUsage > limit && percentUsed < 100;
    }
  }

  return {
    used,
    limit,
    remaining,
    percentUsed: Math.min(100, Math.round(percentUsed * 10) / 10),
    status,
    nextResetAt,
    resetCountdown,
    projectedOverage,
    isValid: true,
  };
}
