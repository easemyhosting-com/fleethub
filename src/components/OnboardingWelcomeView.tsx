"use client";

import { Bot, Globe, Lock, Server, Shield } from "lucide-react";

interface OnboardingWelcomeViewProps {
  onOpenOnboarding: (providerId?: string) => void;
  onRefreshData?: () => void;
  onOpenAuth?: () => void;
}

const setupSteps = [
  {
    id: "tailscale",
    number: "2",
    title: "Tailscale mesh",
    description: "Connect and verify the FleetHub host on your tailnet.",
    icon: Globe,
    color: "text-indigo-400 border-indigo-500/30 bg-indigo-500/10",
  },
  {
    id: "infisical",
    number: "3",
    title: "Infisical vault",
    description: "Connect your vault and verify a temporary secret can be written, read, and removed.",
    icon: Lock,
    color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  },
  {
    id: "cliproxy",
    number: "4",
    title: "CLIProxyAPI gateway",
    description: "Connect the gateway and verify its model and management endpoints.",
    icon: Bot,
    color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  },
] as const;

export function OnboardingWelcomeView({ onOpenOnboarding, onOpenAuth }: OnboardingWelcomeViewProps) {
  return (
    <div className="mx-auto max-w-6xl space-y-8 py-4">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-8 shadow-2xl sm:p-10">
        <div className="pointer-events-none absolute -right-12 -top-12 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative z-10 max-w-3xl space-y-4">
          <p className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 font-mono text-xs font-medium text-emerald-400">FRESH DEPLOYMENT</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Welcome to <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">FleetHub</span></h1>
          <p className="text-sm leading-relaxed text-zinc-300 sm:text-base">Sign in as an operator, then verify your network, vault, and AI gateway. Provider connections become available after setup is complete.</p>
          <div className="flex flex-wrap gap-3 pt-3">
            {onOpenAuth ? <button type="button" onClick={onOpenAuth} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-black hover:bg-emerald-400"><Shield className="h-4 w-4" />1. Operator sign-in</button> : null}
            {setupSteps.map((step) => {
              const Icon = step.icon;
              return <button key={step.id} type="button" onClick={() => onOpenOnboarding(step.id)} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-semibold hover:bg-zinc-800 ${step.color}`}><Icon className="h-4 w-4" />{step.number}. {step.title}</button>;
            })}
          </div>
        </div>
      </div>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5" aria-labelledby="setup-journey-title">
        <div><h2 id="setup-journey-title" className="text-sm font-bold text-white">Setup journey</h2><p className="mt-1 text-xs text-zinc-400">Complete each verification in order. Credentials are configured on the FleetHub server.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
            <span className="text-[10px] font-mono font-bold text-emerald-300">STEP 1 · ACCESS</span>
            <Shield className="mt-3 h-5 w-5 text-emerald-400" />
            <h3 className="mt-2 text-sm font-semibold text-white">Operator sign-in</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">Authenticate before changing setup or connecting providers.</p>
            {onOpenAuth ? <button type="button" onClick={onOpenAuth} className="mt-3 text-xs font-semibold text-emerald-300 hover:underline">Open sign-in →</button> : null}
          </div>
          {setupSteps.map((step) => {
            const Icon = step.icon;
            return <button key={step.id} type="button" onClick={() => onOpenOnboarding(step.id)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left hover:border-zinc-600"><span className="text-[10px] font-mono font-bold text-zinc-400">STEP {step.number} · VERIFY</span><Icon className={`mt-3 h-5 w-5 ${step.color.split(" ")[0]}`} /><h3 className="mt-2 text-sm font-semibold text-white">{step.title}</h3><p className="mt-1 text-xs leading-relaxed text-zinc-400">{step.description}</p><span className="mt-3 inline-block text-xs font-semibold text-cyan-300">Open setup →</span></button>;
          })}
          <button type="button" onClick={() => onOpenOnboarding()} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-left hover:border-zinc-600"><span className="text-[10px] font-mono font-bold text-zinc-400">STEP 5 · PROVIDERS</span><Server className="mt-3 h-5 w-5 text-emerald-400" /><h3 className="mt-2 text-sm font-semibold text-white">Connect providers</h3><p className="mt-1 text-xs leading-relaxed text-zinc-400">Add cloud and model accounts after infrastructure verification.</p><span className="mt-3 inline-block text-xs font-semibold text-emerald-300">View providers →</span></button>
        </div>
      </section>
    </div>
  );
}
