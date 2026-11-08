"use client";

import { describeNotice, expiryNotices } from "@/lib/rotation/expiry";
import type { FleetAccount } from "@/lib/inventory/model";

/** Shown on every tab while a credential is expired or about to expire, so it cannot be missed. */
export function ExpiryBanner({ accounts, onReview }: { accounts: FleetAccount[]; onReview: () => void }) {
  const notices = expiryNotices(accounts, new Date());
  if (notices.length === 0) return null;
  const urgent = notices.some(notice => notice.level !== "warning");
  return (
    <div role="alert" className={`mb-4 rounded-xl border p-4 text-sm ${urgent ? "border-rose-500/40 bg-rose-500/10 text-rose-100" : "border-amber-500/40 bg-amber-500/10 text-amber-100"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">{notices.length === 1 ? "A credential needs attention" : `${notices.length} credentials need attention`}</p>
        <button type="button" onClick={onReview} className="rounded border border-current px-2 py-1 text-xs">Review accounts</button>
      </div>
      <ul className="mt-2 space-y-1">{notices.map(notice => <li key={notice.accountId}>{describeNotice(notice)}</li>)}</ul>
    </div>
  );
}
