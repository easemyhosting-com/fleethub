import type { ProbeResult } from "@/lib/inventory/probe";
import { defaultProfile, type BackupClass, type Lifecycle, type Role } from "@/lib/fleet/vocabulary";
import { describeProbe, describeScan, type ScanState } from "./scan-feedback";

/** Asks the server what a credential can read, before anything is saved. */
export async function testCredential(providerId: string, config: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch("/api/providers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, config }) });
    const data = (await response.json().catch(() => null)) as ProbeResult | { error?: string } | null;
    if (!data) return { ok: false, message: "Test failed" };
    if (!("ok" in data)) return { ok: false, message: data.error || "Test failed" };
    return { ok: data.ok, message: describeProbe(data) };
  } catch { return { ok: false, message: "Could not reach FleetHub" }; }
}

/** Follows an account's first scan and reports each step until it finishes (or the time runs out). */
export async function followFirstScan(accountId: string, report: (outcome: { ok: boolean; message: string }) => void, tries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(`/api/fleet?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
      const snapshot = response.ok ? ((await response.json()) as { accounts?: Array<{ collection?: ScanState }> }) : null;
      const step = describeScan(snapshot?.accounts?.[0]?.collection);
      report({ ok: step.ok, message: step.message });
      if (step.done) return;
    } catch { /* keep trying */ }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  report({ ok: true, message: "Connected. The first scan is taking longer than expected; it keeps running in the background." });
}

export type RegistrationProfile = { role: Role; lifecycle: Lifecycle; backupClass: BackupClass };
export const defaultRegistrationProfile: RegistrationProfile = { role: defaultProfile.role, lifecycle: defaultProfile.lifecycle, backupClass: defaultProfile.backupClass };

/** True when the owner changed anything in the Advanced section, so the default flow makes no extra requests. */
export function hasProfileChoices(profile: RegistrationProfile): boolean {
  return profile.role !== defaultRegistrationProfile.role || profile.lifecycle !== defaultRegistrationProfile.lifecycle || profile.backupClass !== defaultRegistrationProfile.backupClass;
}

/**
 * Applies the registration-time role, lifecycle and backup class to every resource the account's first scan found.
 * Never sends autoStop, so protected resources can never be moved to approve or auto from here (the server also refuses it).
 */
export async function applyRegistrationProfile(accountId: string, profile: RegistrationProfile): Promise<{ applied: number; failed: number }> {
  if (!hasProfileChoices(profile)) return { applied: 0, failed: 0 };
  let ids: string[] = [];
  try {
    const response = await fetch(`/api/fleet?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" });
    const snapshot = response.ok ? ((await response.json()) as { resources?: Array<{ id?: unknown; accountId?: unknown }> }) : null;
    ids = (snapshot?.resources ?? []).filter(item => typeof item.id === "string" && (item.accountId === undefined || item.accountId === accountId)).map(item => item.id as string);
  } catch { return { applied: 0, failed: 0 }; }
  let applied = 0;
  let failed = 0;
  for (const resourceId of ids) {
    try {
      const response = await fetch("/api/resources/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, profile: { role: profile.role, lifecycle: profile.lifecycle, backupClass: profile.backupClass } }) });
      if (response.ok) applied++; else failed++;
    } catch { failed++; }
  }
  return { applied, failed };
}
