"use client";

import { X, Clock, AlertTriangle, CheckCircle2, ShieldCheck, ExternalLink, Activity } from "lucide-react";
import type { QuotaMeterDefinition, ProviderPolicy } from "@/lib/catalog/schema";
import type { QuotaCalculation } from "@/lib/quota/engine";

interface Props {
  meter: (QuotaMeterDefinition & QuotaCalculation & { providerName: string; policy: ProviderPolicy }) | null;
  onClose: () => void;
}

export function QuotaDetailModal({ meter, onClose }: Props) {
  if (!meter) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-[#0c1222] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                  {meter.providerName}
                </span>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {meter.isValid ? `${meter.observe.method} observation` : "Usage unavailable"}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mt-1">{meter.name}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm">
          {/* Main Stats Banner */}
          <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center">
            <div>
              <div className="text-xs text-slate-400">Used</div>
              <div className="text-lg font-bold text-white mt-0.5">{meter.isValid ? meter.used.toLocaleString() : "Unknown"}</div>
            </div>
            <div className="border-x border-slate-800">
              <div className="text-xs text-slate-400">Limit</div>
              <div className="text-lg font-bold text-white mt-0.5">{meter.limit.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Headroom Left</div>
              <div className="text-lg font-bold text-cyan-400 mt-0.5">{meter.isValid ? meter.remaining.toLocaleString() : "Unknown"}</div>
            </div>
          </div>

          {/* Progress & Reset Countdown */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-300">
              <span>Consumption Progress</span>
              <span className="font-mono">{meter.isValid ? `${meter.percentUsed}%` : "Unknown"}</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  meter.status === "critical" || meter.status === "exhausted"
                    ? "bg-rose-500"
                    : meter.status === "warning"
                    ? "bg-amber-500"
                    : "bg-blue-500"
                }`}
                style={{ width: `${meter.percentUsed}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <span>Window: {meter.window.kind.replace("_", " ")}</span>
              <span className="text-slate-200 font-medium flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                <span>Next Reset: {meter.resetCountdown}</span>
              </span>
            </div>
          </div>

          {/* Telemetry Endpoint & Observability */}
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Telemetry Source:</span>
              <span className="font-mono text-slate-300">{meter.observe.endpoint || "Derived / Heartbeats"}</span>
            </div>
            {meter.observe.tokenScope && (
              <div className="flex justify-between">
                <span className="text-slate-400">Required Token Scope:</span>
                <span className="font-mono text-emerald-400">{meter.observe.tokenScope}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">Overage Behavior:</span>
              <span className="capitalize font-medium text-amber-300">{meter.onExceed}</span>
            </div>
          </div>

          {/* Provider Terms & Policy Clause */}
          {meter.policy.clause && (
            <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-900/40 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-blue-300 font-semibold">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4" /> Official Provider Terms
                </span>
                {meter.policy.clauseUrl && (
                  <a
                    href={meter.policy.clauseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-1"
                  >
                    View Source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-slate-300 italic">"{meter.policy.clause}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
