"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { capabilityReportSchema, describeCapabilities, type CapabilityReport } from "@/lib/cliproxy/capability-report";

const checkTimeoutMs = 20_000;
const toneClass = { ok: "text-emerald-300", warn: "text-amber-300", muted: "text-zinc-400" } as const;

/** Read-only gateway check. Runs only on request because it calls the gateway with both server-side keys. */
export function CliProxyCapabilities({ disabled }: { disabled: boolean }) {
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      // Bounds the request and the body read; the route's own gateway probes have shorter timeouts.
      const response = await fetch("/api/onboarding/cliproxy-capabilities", { cache: "no-store", signal: AbortSignal.timeout(checkTimeoutMs) });
      const text = await response.text();
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { /* A non-JSON body is reported below. */ }
      if (!response.ok) {
        const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "Gateway capabilities are unavailable.";
        throw new Error(message);
      }
      const parsed = capabilityReportSchema.safeParse(body);
      if (!parsed.success) throw new Error("The capability report has an unexpected format.");
      setReport(parsed.data);
    } catch (cause) {
      setReport(null);
      const timedOut = cause instanceof DOMException && (cause.name === "TimeoutError" || cause.name === "AbortError");
      setError(timedOut ? "The capability check took too long. Check that the gateway is reachable, then try again." : cause instanceof Error ? cause.message : "Gateway capabilities are unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="cliproxy-capabilities-title" className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 id="cliproxy-capabilities-title" className="font-medium text-zinc-100">Gateway capabilities</h4>
          <p className="mt-1 text-xs text-zinc-400">Reads which keys work and how many upstream accounts the gateway holds. Changes nothing.</p>
        </div>
        <button type="button" onClick={check} disabled={disabled || loading} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
          {loading ? <><LoaderCircle className="animate-spin" size={14} aria-hidden="true" /> Checking…</> : report ? "Check again" : "Check capabilities"}
        </button>
      </div>
      <div aria-live="polite">
        {error ? <p role="alert" className="mt-3 text-sm text-amber-300">{error}</p> : null}
        {report ? <>
          <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[9rem_1fr]">
            {describeCapabilities(report).map(line => <div key={line.label} className="contents"><dt className="text-xs text-zinc-400">{line.label}</dt><dd className={`text-sm ${toneClass[line.tone]}`}>{line.value}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-zinc-400">Checked <time dateTime={report.checkedAt}>{new Date(report.checkedAt).toLocaleString()}</time>. Server version {report.serverVersion ?? "not detected"}; upstream availability is as the gateway reports it, not tested.</p>
        </> : null}
      </div>
    </section>
  );
}
