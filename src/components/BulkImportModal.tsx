"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { bulkLineHelp, parseBulkLines } from "@/lib/providers/bulk-import";

interface Props { isOpen: boolean; ownerEmail: string; onClose: () => void; onDone: () => void }
type Outcome = { ok: boolean; message: string };

async function register(body: unknown): Promise<Outcome> {
  try {
    const response = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data: unknown = await response.json().catch(() => ({}));
    const error = typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).error === "string" ? String((data as Record<string, unknown>).error) : null;
    return response.ok ? { ok: true, message: "Connected. Collection queued." } : { ok: false, message: error ?? "Registration failed" };
  } catch { return { ok: false, message: "Could not reach FleetHub" }; }
}

/** Connects several token-based accounts at once from pasted lines. OCI has its own upload inside the OCI form. */
export function BulkImportModal({ isOpen, ownerEmail, onClose, onDone }: Props) {
  const [paste, setPaste] = useState("");
  const [results, setResults] = useState<Record<number, Outcome>>({});
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseBulkLines(paste), [paste]);
  if (!isOpen) return null;
  const ready = rows.filter(row => row.problem === null);

  async function run() {
    setBusy(true); setResults({});
    let ok = 0;
    for (const row of ready) {
      const outcome = await register({ providerId: row.providerId, label: row.label, ownerEmail, role: "general", config: row.config });
      if (outcome.ok) ok += 1;
      setResults(current => ({ ...current, [row.line]: outcome }));
    }
    setBusy(false);
    if (ok > 0) onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Paste several accounts">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Paste several accounts</h2>
            <p className="mt-1 text-sm text-zinc-400">One account per line, comma or tab separated: provider, label, then the fields below. Credentials go straight to your secret store. For Oracle Cloud, use Connect Provider, then Oracle, then Upload OCI config.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-zinc-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <pre className="overflow-x-auto rounded bg-zinc-900 p-2 text-xs text-zinc-400">{bulkLineHelp().join("\n")}</pre>
          <textarea aria-label="Accounts to import" rows={6} spellCheck={false} autoComplete="off" value={paste} onChange={event => setPaste(event.target.value)} className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-200" />
          {rows.length > 0 && (
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {rows.map(row => (
                <li key={row.line} className="p-3">
                  <p className="text-zinc-100">{row.label || "(no label)"} <span className="text-xs text-zinc-500">{row.providerId} · line {row.line}</span></p>
                  {row.problem && <p className="text-xs text-amber-300">{row.problem}</p>}
                  {results[row.line] && <p role="status" className={`text-xs ${results[row.line].ok ? "text-emerald-300" : "text-rose-300"}`}>{results[row.line].message}</p>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" disabled={busy || ready.length === 0} onClick={() => void run()} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50">{busy ? "Connecting…" : `Connect ${ready.length} account${ready.length === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </div>
  );
}
