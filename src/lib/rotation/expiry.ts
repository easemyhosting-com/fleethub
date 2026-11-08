export type ExpiryLevel = "expired" | "critical" | "warning";
export interface ExpiryNotice { accountId: string; label: string; kind: string; level: ExpiryLevel; expiresAt: string; daysLeft: number }

const day = 86_400_000;
export const warnDays = 14;
export const criticalDays = 3;

/** Accounts whose credential has expired or will within two weeks, most urgent first. */
export function expiryNotices(accounts: ReadonlyArray<{ id: string; label: string; kind: string; credentialExpiresAt?: string | null; archived?: boolean }>, now: Date): ExpiryNotice[] {
  const notices: ExpiryNotice[] = [];
  for (const account of accounts) {
    if (!account.credentialExpiresAt || account.archived) continue;
    const at = Date.parse(account.credentialExpiresAt);
    if (Number.isNaN(at)) continue;
    const daysLeft = Math.floor((at - now.getTime()) / day);
    const level: ExpiryLevel | null = at <= now.getTime() ? "expired" : daysLeft < criticalDays ? "critical" : daysLeft < warnDays ? "warning" : null;
    if (level) notices.push({ accountId: account.id, label: account.label, kind: account.kind, level, expiresAt: account.credentialExpiresAt, daysLeft });
  }
  return notices.sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

export function describeNotice(notice: ExpiryNotice): string {
  const when = new Date(notice.expiresAt).toLocaleDateString();
  if (notice.level === "expired") return `${notice.label}: credential expired on ${when}. Replace it to resume collection.`;
  return `${notice.label}: credential expires on ${when} (${notice.daysLeft <= 0 ? "less than a day" : `${notice.daysLeft} day${notice.daysLeft === 1 ? "" : "s"}`} left).`;
}
