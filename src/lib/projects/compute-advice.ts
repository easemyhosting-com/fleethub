import { fit, type HostCapacity } from "@/lib/capacity/host";
import { evaluateFreshness } from "@/lib/capacity/arithmetic";
import type { NeedInput } from "./schemas";

export interface ComputeAdvice {
  verdict: "fits" | "unverified" | "mismatch";
  basis: "declared_and_observed" | "declared_only" | "unknown";
  reasons: string[];
  measuredAt: string | null;
}
const architecture = (value: string | null | undefined) => {
  const normalized = value?.toLowerCase();
  return normalized === "aarch64" || normalized === "arm64" ? "arm64"
    : normalized === "x86_64" || normalized === "amd64" ? "amd64" : null;
};
const nonnegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

/**
 * The kernel reports less memory than the configured size (firmware and kernel reservations).
 * Accept a reported total from 85% to 101% of the configured size as the same host; anything else is a mismatch of evidence.
 */
export const reportedMemoryTolerance = { min: 0.85, max: 1.01 } as const;
export function reportedMemoryMatches(reportedMi: number | null | undefined, configuredMi: number): boolean {
  return typeof reportedMi === "number" && Number.isFinite(reportedMi) && reportedMi > 0 && configuredMi > 0 &&
    reportedMi >= configuredMi * reportedMemoryTolerance.min && reportedMi <= configuredMi * reportedMemoryTolerance.max;
}

/** Constraints before ranking. Declared requests and observed load overlap; never sum them. */
export function adviseCompute(capacity: HostCapacity | undefined, spec: NeedInput["spec"], now = new Date()): ComputeAdvice {
  const reasons: string[] = [];
  const result = (verdict: ComputeAdvice["verdict"], basis: ComputeAdvice["basis"] = "unknown"): ComputeAdvice => ({ verdict, basis, reasons, measuredAt: capacity?.measuredUsage?.measuredAt ?? null });
  if (!capacity) { reasons.push("Host capacity evidence unavailable"); return result("unverified"); }
  if (capacity.state !== "online") { reasons.push(`Host is ${capacity.state}`); return result("mismatch"); }
  let unknown = false;
  if (spec.arch) {
    const actual = architecture(capacity.arch);
    if (actual && actual !== spec.arch) { reasons.push("CPU architecture does not match"); return result("mismatch"); }
    if (!actual) { unknown = true; reasons.push("CPU architecture is unknown"); }
  }
  if (spec.region) {
    if (capacity.region && capacity.region.toLowerCase() !== spec.region.toLowerCase()) { reasons.push("Required region does not match"); return result("mismatch"); }
    if (!capacity.region) { unknown = true; reasons.push("Host region is unknown"); }
  }
  if (spec.cpu === undefined || spec.memoryGb === undefined || (spec.cpu === 0 && spec.memoryGb === 0)) {
    unknown = true; reasons.push("Provide CPU and RAM requirements before trusting fit");
  }
  if (spec.durationHours !== undefined || spec.alwaysOn) {
    unknown = true; reasons.push("Duration allowance and continuous availability are not verified");
  }
  if (spec.storageGb !== undefined) { unknown = true; reasons.push("Disk capacity is not evaluated by compute fit"); }
  const ask = { cpuMilli: Math.ceil((spec.cpu ?? 0) * 1000), memMi: Math.ceil((spec.memoryGb ?? 0) * 1024) };
  if (!Number.isSafeInteger(ask.cpuMilli) || ask.cpuMilli < 0 || !Number.isSafeInteger(ask.memMi) || ask.memMi < 0) {
    reasons.push("CPU or RAM requirement is invalid"); return result("unverified");
  }
  if (!nonnegative(capacity.totalCpuMilli) || !nonnegative(capacity.totalMemMi) ||
      capacity.freeCpuMilli === null || !Number.isFinite(capacity.freeCpuMilli) ||
      capacity.freeMemMi === null || !Number.isFinite(capacity.freeMemMi)) {
    const cpuShort = spec.cpu !== undefined && capacity.freeCpuMilli !== null && Number.isFinite(capacity.freeCpuMilli) && ask.cpuMilli > capacity.freeCpuMilli;
    const memShort = spec.memoryGb !== undefined && capacity.freeMemMi !== null && Number.isFinite(capacity.freeMemMi) && ask.memMi > capacity.freeMemMi;
    if (cpuShort || memShort) { reasons.push(`Known declared budget is short of ${cpuShort ? "CPU" : "RAM"}${cpuShort && memShort ? " and RAM" : ""}`); return result("mismatch", "declared_only"); }
    reasons.push("Host size or declared budget is unknown"); return result("unverified");
  }
  if (!nonnegative(capacity.reserve.cpuMilli) || !nonnegative(capacity.reserve.memMi) ||
      capacity.projects.some(project => !nonnegative(project.cpuRequestMilli) || !nonnegative(project.memRequestMi))) {
    reasons.push("Declared requests or reserve are invalid"); return result("unverified");
  }
  const declared = fit(capacity, ask);
  reasons.push(declared.reason);
  if (declared.fits === false) return result("mismatch", "declared_only");
  if (declared.fits === null || capacity.withoutRequests.length) {
    unknown = true;
    if (capacity.withoutRequests.length) reasons.push("Some registered workloads lack declared requests");
  }
  const usage = capacity.measuredUsage;
  if (!usage || usage.stale || evaluateFreshness(usage.measuredAt, now) !== "fresh" ||
      !nonnegative(usage.cpuBusyCores) || !nonnegative(usage.memUsedMi) ||
      usage.cpuCores === null || usage.cpuCores * 1000 !== capacity.totalCpuMilli ||
      !reportedMemoryMatches(usage.memTotalMi, capacity.totalMemMi)) {
    reasons.push("Fresh CPU and RAM load evidence is unavailable; declared fit is not measured headroom");
    return result("unverified", "declared_only");
  }
  // Both views include existing workloads, so test each independently instead of double subtraction.
  const cpuLeft = capacity.totalCpuMilli - (capacity.reserve.cpuMilli ?? 0) - usage.cpuBusyCores * 1000 - ask.cpuMilli;
  // Observed headroom uses the smaller, host-reported total.
  const memoryLeft = Math.min(capacity.totalMemMi, usage.memTotalMi as number) - capacity.reserve.memMi - usage.memUsedMi - ask.memMi;
  if (cpuLeft < 0 || memoryLeft < 0) { reasons.push("Recent observed load leaves insufficient CPU or RAM after the reserve"); return result("mismatch", "declared_and_observed"); }
  reasons.push("Recent observed CPU and RAM also leave room after the reserve; advice is not a reservation");
  return result(unknown ? "unverified" : "fits", "declared_and_observed");
}
