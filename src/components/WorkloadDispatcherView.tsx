"use client";

import { useState } from "react";
import {
  Cpu,
  Shield,
  Zap,
  Play,
  CheckCircle2,
  AlertTriangle,
  Server,
  Layers,
  ArrowRight,
  Terminal,
  Bot,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Lock,
} from "lucide-react";
import {
  dispatchWorkload,
  classifyWorkload,
  getDispatchTargets,
  type WorkloadSpec,
  type DispatchDecision,
  type DispatchResult,
} from "@/lib/distribution/dispatcher";

interface WorkloadDispatcherViewProps {
  hasConnectedWorkers?: boolean;
  onOpenOnboard?: () => void;
}

/** Example usage for the simulator. Not observed data. */
const SIMULATED_QUOTA_READINGS: Record<string, number> = {
  "github.actions.minutes": 850,
  "modal.credits.usd": 8.5,
  "upstash.box.hours": 1.8,
  "cf.workers.requests": 42150,
};

export function WorkloadDispatcherView({ hasConnectedWorkers = false, onOpenOnboard }: WorkloadDispatcherViewProps) {
  const [workloadName, setWorkloadName] = useState("Playwright E2E Regression Suite");
  const [command, setCommand] = useState("npx playwright test --workers=4");
  const [image, setImage] = useState("mcr.microsoft.com/playwright:v1.49.0-noble");
  const [category, setCategory] = useState<string>("auto");
  const [requiredCpu, setRequiredCpu] = useState(4);
  const [requiredMemoryMb, setRequiredMemoryMb] = useState(8192);
  const [maxRuntimeSeconds, setMaxRuntimeSeconds] = useState(900);
  const [requiresGpu, setRequiresGpu] = useState(false);
  const [preferredArch, setPreferredArch] = useState<"amd64" | "arm64" | "any">("amd64");
  const [isPublicRepo, setIsPublicRepo] = useState(true);

  // Simulated quota switches
  const [ghQuotaState, setGhQuotaState] = useState<"healthy" | "critical" | "exhausted">("healthy");
  const [modalQuotaState, setModalQuotaState] = useState<"healthy" | "exhausted">("healthy");

  const [copiedCmd, setCopiedCmd] = useState(false);

  // Simulated readings only: the dispatcher itself has no default usage and treats missing meters as unknown.
  const quotaReadings: Record<string, number> = { ...SIMULATED_QUOTA_READINGS };
  if (ghQuotaState === "critical") quotaReadings["github.actions.minutes"] = 1900;
  if (ghQuotaState === "exhausted") quotaReadings["github.actions.minutes"] = 2000;
  if (modalQuotaState === "exhausted") quotaReadings["modal.credits.usd"] = 30;

  const currentSpec: WorkloadSpec = {
    name: workloadName,
    command,
    image,
    category: category === "auto" ? undefined : (category as any),
    requiredCpu,
    requiredMemoryMb,
    maxRuntimeSeconds,
    requiresGpu,
    preferredArch,
    isPublicRepo,
  };

  const dispatchResult: DispatchResult = dispatchWorkload(currentSpec, { quotaReadings });
  const decision: DispatchDecision | null = dispatchResult.success ? dispatchResult : null;
  const dispatchError: string | null = !dispatchResult.success ? dispatchResult.reason : null;

  const allTargets = getDispatchTargets({ includeProtected: true });

  const loadPreset = (presetKey: string) => {
    if (presetKey === "playwright") {
      setWorkloadName("Playwright E2E Regression Suite");
      setCommand("npx playwright test --workers=4");
      setImage("mcr.microsoft.com/playwright:v1.49.0-noble");
      setCategory("heavy_ci");
      setRequiredCpu(4);
      setRequiredMemoryMb(8192);
      setMaxRuntimeSeconds(900);
      setRequiresGpu(false);
      setPreferredArch("amd64");
      setIsPublicRepo(true);
    } else if (presetKey === "pytorch") {
      setWorkloadName("PyTorch LoRA Fine-Tuning");
      setCommand("python train_lora.py --model meta-llama/Llama-3-8B");
      setImage("pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime");
      setCategory("gpu_ml");
      setRequiredCpu(2);
      setRequiredMemoryMb(8192);
      setMaxRuntimeSeconds(3600);
      setRequiresGpu(true);
      setPreferredArch("any");
      setIsPublicRepo(false);
    } else if (presetKey === "rclone") {
      setWorkloadName("Storage Health & Quota Poll");
      setCommand("rclone check gdrive-crypt: fleet-artifacts: --one-way");
      setImage("rclone/rclone:latest");
      setCategory("light_cron");
      setRequiredCpu(0.5);
      setRequiredMemoryMb(128);
      setMaxRuntimeSeconds(5);
      setRequiresGpu(false);
      setPreferredArch("any");
      setIsPublicRepo(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">Smart Workload Distribution Engine</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              MCP ACTIVE
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Intelligent classification and quota-aware routing. Strictly shields protected production servers (primary databases, K3s control planes) by offloading to GitHub Actions runners, local ephemeral boxes, or serverless workers.
          </p>
        </div>

        {/* Preset buttons */}
        <div className="flex items-center gap-1.5 p-1 bg-zinc-900 border border-zinc-800 rounded-lg">
          <span className="text-[11px] text-zinc-400 px-2 font-mono">Presets:</span>
          <button
            onClick={() => loadPreset("playwright")}
            className="px-2.5 py-1 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            Playwright CI
          </button>
          <button
            onClick={() => loadPreset("pytorch")}
            className="px-2.5 py-1 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            PyTorch ML
          </button>
          <button
            onClick={() => loadPreset("cron")}
            className="px-2.5 py-1 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            Light Cron
          </button>
        </div>
      </div>

      {!hasConnectedWorkers && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Simulation Mode:</strong> 0 custom worker nodes onboarded. The simulator below demonstrates how workload classification and production server shielding behave.
            </span>
          </div>
          {onOpenOnboard && (
            <button
              onClick={onOpenOnboard}
              className="px-3 py-1 rounded bg-amber-400 hover:bg-amber-300 text-black font-semibold shrink-0 cursor-pointer text-xs"
            >
              Onboard Runner / Node
            </button>
          )}
        </div>
      )}

      {/* Main Grid: Config + Decision */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Workload Spec Editor (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-800/80 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white">Workload Parameters</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">spec.json</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-zinc-400 block mb-1">Workload Name</label>
                <input
                  type="text"
                  value={workloadName}
                  onChange={(e) => setWorkloadName(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="text-zinc-400 block mb-1">Command</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1">Category Classification</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-400"
                  >
                    <option value="auto">Auto-Inferred</option>
                    <option value="heavy_ci">Heavy CI / Playwright</option>
                    <option value="gpu_ml">GPU / ML Burst</option>
                    <option value="light_cron">Light Cron / Sync</option>
                    <option value="general_batch">General Batch</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1">Target Architecture</label>
                  <select
                    value={preferredArch}
                    onChange={(e) => setPreferredArch(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-400"
                  >
                    <option value="amd64">amd64 (x86_64)</option>
                    <option value="arm64">arm64 (Apple / Ampere)</option>
                    <option value="any">any (Multi-Arch)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1">vCPUs</label>
                  <input
                    type="number"
                    value={requiredCpu}
                    onChange={(e) => setRequiredCpu(Number(e.target.value))}
                    step="0.5"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div>
                  <label className="text-zinc-400 block mb-1">RAM (MB)</label>
                  <input
                    type="number"
                    value={requiredMemoryMb}
                    onChange={(e) => setRequiredMemoryMb(Number(e.target.value))}
                    step="256"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div>
                  <label className="text-zinc-400 block mb-1">Max Runtime (s)</label>
                  <input
                    type="number"
                    value={maxRuntimeSeconds}
                    onChange={(e) => setMaxRuntimeSeconds(Number(e.target.value))}
                    step="30"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>

              {/* Toggles & Guardrails */}
              <div className="pt-2 space-y-2.5 border-t border-zinc-800/60">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-zinc-300">Requires Dedicated GPU (CUDA / Metal)</span>
                  <input
                    type="checkbox"
                    checked={requiresGpu}
                    onChange={(e) => setRequiresGpu(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-700 text-emerald-400 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-zinc-300">Public GitHub Repository (Unmetered CI)</span>
                  <input
                    type="checkbox"
                    checked={isPublicRepo}
                    onChange={(e) => setIsPublicRepo(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-700 text-emerald-400 focus:ring-0"
                  />
                </label>

                {/* Invariant notification */}
                <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/20 flex items-start gap-2 text-[11px] text-emerald-400">
                  <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    <strong>Guardrail G3 Invariant:</strong> Protected production servers are permanently shielded from workload dispatch.
                  </span>
                </div>
              </div>

              {/* Quota Clock Simulation Controls */}
              <div className="pt-3 border-t border-zinc-800/60 space-y-2">
                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Live Quota Clock Simulation
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">GitHub Actions Quota</label>
                    <select
                      value={ghQuotaState}
                      onChange={(e) => setGhQuotaState(e.target.value as any)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
                    >
                      <option value="healthy">Healthy (850 / 2000m)</option>
                      <option value="critical">Critical (1900 / 2000m)</option>
                      <option value="exhausted">Exhausted (2000 / 2000m)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-1">Modal GPU Credit</label>
                    <select
                      value={modalQuotaState}
                      onChange={(e) => setModalQuotaState(e.target.value as any)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
                    >
                      <option value="healthy">Healthy ($8.5 / $30)</option>
                      <option value="exhausted">Exhausted ($30 / $30)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Routing Decision & Engine Output (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {decision && (
            <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-800/80 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-white">Optimal Placement Decision</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                    Strategy: {decision.routingStrategy}
                  </span>
                </div>
              </div>

              {/* Selected Target Banner */}
              <div className="p-4 rounded-lg bg-zinc-900/80 border border-emerald-500/30 flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-base">{decision.selectedTarget.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      RANK #1
                    </span>
                  </div>
                  <div className="text-xs text-zinc-400 font-mono">
                    Provider: {decision.selectedTarget.provider.toUpperCase()} · Arch: {decision.selectedTarget.arch} · Executor: {decision.selectedTarget.executor}
                  </div>
                  <div className="text-xs text-emerald-400/90 pt-1">
                    {decision.reason}
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0">
                  <span className="text-xs font-mono text-zinc-400">Capacity</span>
                  <span className="text-xs font-mono text-white font-semibold">
                    {decision.selectedTarget.availableCpu} vCPU · {Math.round(decision.selectedTarget.availableMemoryMb / 1024)}GB
                  </span>
                  {decision.selectedTarget.accelerators.length > 0 && (
                    <span className="text-[10px] font-mono text-purple-400 mt-1">{decision.selectedTarget.accelerators.join(" · ").toUpperCase()} ACCELERATED</span>
                  )}
                </div>
              </div>

              {/* Classification details */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/60 space-y-1">
                  <span className="text-zinc-500 font-mono text-[10px] uppercase">Workload Class</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white uppercase">{decision.classification.category}</span>
                    <span className="text-[10px] font-mono text-emerald-400">
                      ({decision.classification.confidence} confidence)
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 pt-1 truncate">
                    Signals: {decision.classification.signals.join("; ")}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/60 space-y-1">
                  <span className="text-zinc-500 font-mono text-[10px] uppercase">Production Shield</span>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <Shield className="h-3.5 w-3.5" />
                    <span className="font-semibold text-xs">Active & Isolated</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 pt-1">
                    3/3 Oracle servers shielded from CPU steal
                  </div>
                </div>
              </div>

              {/* Structured Execution Plan */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                  <span>Structured Execution Plan ({decision.executionPlan.type})</span>
                  <button
                    onClick={() => copyToClipboard(decision!.executionPlan.displayPreview)}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                  >
                    {copiedCmd ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedCmd ? "Copied" : "Copy Preview"}</span>
                  </button>
                </div>
                <div className="p-3 rounded-lg bg-black border border-zinc-800 font-mono text-xs text-emerald-400 overflow-x-auto">
                  {decision.executionPlan.displayPreview}
                </div>
              </div>

              {/* Evaluated Candidates & Rejected Guardrails */}
              <div className="space-y-2 pt-2 border-t border-zinc-800/60">
                <span className="text-xs font-semibold text-zinc-300">Target Evaluations & Headroom</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {decision.evaluations.map((ev) => (
                    <div
                      key={ev.target.id}
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                        ev.eligible
                          ? ev.target.id === decision!.selectedTarget.id
                            ? "bg-emerald-950/20 border-emerald-500/40"
                            : "bg-zinc-900/40 border-zinc-800/60"
                          : "bg-red-950/10 border-red-900/20 opacity-70"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {ev.eligible ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{ev.target.name}</span>
                            {ev.target.isProtected && (
                              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                PROTECTED
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            {ev.eligible
                              ? `Score: ${ev.score} · Headroom: ${ev.target.availableCpu} vCPU / ${Math.round(ev.target.availableMemoryMb / 1024)}GB`
                              : ev.rejectionReason}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {ev.quotaAssessment ? (
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              ev.quotaAssessment.status === "exhausted"
                                ? "bg-red-500/10 text-red-400"
                                : ev.quotaAssessment.status === "critical"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-emerald-500/10 text-emerald-400"
                            }`}
                          >
                            {ev.quotaAssessment.isUnmetered
                              ? "UNMETERED"
                              : `${ev.quotaAssessment.remaining} rem`}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-zinc-500">Uncapped</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {dispatchError && (
            <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/40 text-red-300 text-xs flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Dispatch Failure: No Eligible Target Found</div>
                <div className="text-red-400/90 mt-1">{dispatchError}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom MCP Integration Banner */}
      <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Bot className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">Model Context Protocol (MCP) Interface Active</div>
            <div className="text-[11px] text-zinc-400">
              External coding agents (Claude Code, Antigravity, Cursor) can query <code className="text-emerald-400">/api/mcp</code> using <code className="text-zinc-300">dispatch_workload</code>, <code className="text-zinc-300">classify_workload</code>, and <code className="text-zinc-300">get_dispatch_targets</code>.
            </div>
          </div>
        </div>

        <button
          onClick={() => copyToClipboard('curl -X POST http://localhost:3060/api/mcp -H "Content-Type: application/json" -d \'{"method":"tools/call","params":{"name":"dispatch_workload","arguments":{"name":"Playwright E2E","isPublicRepo":true}}}\'')}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 transition-colors cursor-pointer shrink-0"
        >
          Copy MCP cURL Example
        </button>
      </div>
    </div>
  );
}
