"use client";

import { applyRegistrationProfile, defaultRegistrationProfile, followFirstScan, testCredential } from "@/lib/providers/client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Search,
  Shield,
  Server,
  Database,
  Cloud,
  Cpu,
  Lock,
  Bot,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Plus,
  Sparkles,
  Globe,
} from "lucide-react";

import { backupClasses, lifecycleLabels, lifecycles, roleLabels, roles, type BackupClass, type Lifecycle, type Role } from "@/lib/fleet/vocabulary";
import { OciConfigImport } from "./OciConfigImport";
import { supportedInventoryProviders, type FleetAccount } from "@/lib/inventory/model";
import { buildFetchPrompt } from "@/lib/providers/prompts";

interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "number" | "textarea";
  description: string;
  placeholder?: string;
  defaultValue?: string | number;
  options?: Array<{ label: string; value: string }>;
  required: boolean;
  secret?: boolean;
}

interface ProviderCatalogItem {
  id: string;
  name: string;
  description: string;
  tier: string;
  capabilities: string[];
  configFields: ConfigField[];
  connectedAccountsCount: number;
}

interface ProviderOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialProviderId?: string | null;
  initialOwnerEmail: string;
  existingAccount?: FleetAccount | null;
}

const CATEGORIES = [
  { id: "all", label: "All Providers" },
  { id: "network", label: "Network & Mesh", icon: Globe },
  { id: "compute", label: "Compute & VM", icon: Server },
  { id: "database", label: "Database & Cache", icon: Database },
  { id: "serverless", label: "Edge & Serverless", icon: Zap },
  { id: "storage", label: "Storage", icon: Cloud },
  { id: "llm", label: "AI & Gateways", icon: Bot },
];

export function ProviderOnboardingModal({
  isOpen,
  onClose,
  onSuccess,
  initialProviderId,
  initialOwnerEmail,
  existingAccount,
}: ProviderOnboardingModalProps) {
  const [providers, setProviders] = useState<ProviderCatalogItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState<ProviderCatalogItem | null>(null);
  const [ociMode, setOciMode] = useState<"manual" | "upload">("manual");

  // Form state
  const [inventoryOnly, setInventoryOnly] = useState(true);
  const [setupReady, setSetupReady] = useState(false);
  // With a verified secret store the credential fields are the normal path; inventory-only is the fallback.
  useEffect(() => { if (setupReady) setInventoryOnly(false); }, [setupReady]);
  const [accountLabel, setAccountLabel] = useState("");
  const [ownerEmail, setOwnerEmail] = useState(initialOwnerEmail);
  const [isProtected, setIsProtected] = useState(true);
  const [role, setRole] = useState<Role>(defaultRegistrationProfile.role);
  const [lifecycle, setLifecycle] = useState<Lifecycle>(defaultRegistrationProfile.lifecycle);
  const [backupClass, setBackupClass] = useState<BackupClass>(defaultRegistrationProfile.backupClass);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [scanReady, setScanReady] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const promptText = selectedProvider ? buildFetchPrompt(selectedProvider.id, { accountLabel, region: typeof formValues.region === "string" ? formValues.region : undefined, knownKinds: [] }) : "";

  // Fetch supported providers from API and reset selection on modal open
  useEffect(() => {
    if (!isOpen) {
      setSelectedProvider(null);
      setSearchQuery("");
      setErrorMessage(null);
      setSuccessMessage(null);
      setScanReady(false);
      return;
    }

    setOwnerEmail(initialOwnerEmail);
    fetch("/api/onboarding").then(response => response.ok ? response.json() : null).then(data => setSetupReady(data?.ready === true)).catch(() => setSetupReady(false));
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data) => {
        if (data.providers) {
          setProviders(data.providers.filter((provider: ProviderCatalogItem) => !["tailscale", "infisical", "cliproxyapi"].includes(provider.id)));
          if (initialProviderId) {
            const match = data.providers.find((p: any) => p.id === initialProviderId);
            if (match) {
              handleSelectProvider(match);
            }
          } else {
            setSelectedProvider(null);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load providers catalog:", err);
      });
  }, [isOpen, initialProviderId, initialOwnerEmail, existingAccount]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  // Reset form when choosing a provider
  const handleSelectProvider = (provider: ProviderCatalogItem) => {
    setSelectedProvider(provider);
    setInventoryOnly(!existingAccount);
    setAccountLabel(existingAccount?.label ?? `${provider.name} Account`);
    setOwnerEmail(existingAccount?.ownerEmail ?? initialOwnerEmail);
    setErrorMessage(null);
    setSuccessMessage(null);
    setScanReady(false);
    setPromptCopied(false);

    // Populate default values
    const defaults: Record<string, any> = {};
    for (const f of provider.configFields || []) {
      if (f.defaultValue !== undefined) {
        defaults[f.key] = f.defaultValue;
      }
    }
    setFormValues(defaults);
  };

  const handleBack = () => {
    setSelectedProvider(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Filter providers by category & search query
  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      const matchesSearch =
        searchQuery === "" ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === "all" || p.capabilities.includes(selectedCategory);

      return matchesSearch && matchesCategory;
    });
  }, [providers, searchQuery, selectedCategory]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (!inventoryOnly && !setupReady) throw new Error("Complete Setup connections before storing credentials.");
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProvider.id,
          ...(existingAccount ? { accountId: existingAccount.id } : {}),
          label: accountLabel,
          ownerEmail,
          role,
          isProtected,
          config: {
            ...(inventoryOnly ? Object.fromEntries((selectedProvider.configFields || []).filter(field => field.type === "select").map(field => [field.key, formValues[field.key]])) : formValues),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to onboard provider");
      }

      const finish = (keepOpen = false) => { if (!keepOpen) setTimeout(() => { onSuccess(); onClose(); handleBack(); }, 1500); else onSuccess(); };
      const accountId = typeof data.account?.id === "string" ? data.account.id : null;
      if (!inventoryOnly && accountId) {
        setSuccessMessage("Credentials saved. Waiting for the first scan…");
        setIsSubmitting(false);
        await followFirstScan(accountId, step => { setSuccessMessage(step.ok ? step.message : null); setErrorMessage(step.ok ? null : step.message); if (step.ok && step.message.startsWith("First scan done:")) setScanReady(true); });
        const labelled = await applyRegistrationProfile(accountId, { role, lifecycle, backupClass });
        if (labelled.failed) setErrorMessage(`${labelled.failed} resource${labelled.failed === 1 ? "" : "s"} could not be labelled. Set them from the resource drawer.`);
        finish(true);
        return;
      }
      setSuccessMessage(inventoryOnly ? "Inventory account registered. Add resources manually or store credentials later." : typeof data.message === "string" ? data.message : "Account settings saved. Check collection status.");
      finish();
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="relative w-full max-w-3xl bg-[#0b0f17] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-zinc-100 flex flex-col max-h-[90vh] outline-none">
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {selectedProvider ? (
              <button
                type="button"
                disabled={Boolean(existingAccount)}
                onClick={handleBack}
                aria-label="Back to provider selection"
                className="shrink-0 p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 transition-colors"
                title="Back to provider selection"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Sparkles className="h-5 w-5" />
              </div>
            )}
            <div>
              <h3 id="onboarding-title" className="min-w-0 text-base sm:text-lg font-bold text-white flex items-center gap-2">
                {selectedProvider ? `Configure ${selectedProvider.name}` : "Connect Fleet Provider"}
              </h3>
              <p className="text-xs text-zinc-400">
                {selectedProvider
                  ? "Save public account details or store credentials in your verified Infisical scope."
                  : "Onboard your cloud infrastructure, compute nodes, serverless workers, and secret vaults."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close onboarding"
            className="shrink-0 p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {!selectedProvider ? (
            /* STEP 1: Provider Selection & Search */
            <>
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3.5 top-3 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  aria-label="Search providers"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search providers (e.g. Oracle, Cloudflare, Infisical, Upstash, GitHub...)"
                  className="w-full bg-zinc-900/90 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Category Pills */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    aria-pressed={selectedCategory === cat.id}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
                      selectedCategory === cat.id
                        ? "bg-white text-black font-semibold before:h-3 before:w-0.5 before:rounded-full before:bg-sky-500"
                        : "bg-zinc-900/80 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
                    }`}
                  >
                    {cat.icon && <cat.icon className="h-3 w-3" />}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>

              <p className="rounded-xl border border-zinc-800 p-3 text-xs text-zinc-400">Inventory registration is available now. Use Setup connections to verify the prerequisites for vault-backed credentials.</p>

              {/* Provider Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                {filteredProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => handleSelectProvider(provider)}
                    className="group w-full text-left p-4 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/60 border border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer flex flex-col justify-between focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm text-white group-hover:text-blue-400 transition-colors">
                          {provider.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {supportedInventoryProviders.some(id => id === provider.id) ? "Automatic inventory" : "Manual inventory"}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed mb-3">
                        {provider.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-[11px] text-zinc-500">
                      <div className="flex items-center gap-1.5">
                        {provider.capabilities.map((c) => (
                          <span
                            key={c}
                            className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 capitalize text-[10px]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                      <span className="text-blue-400 font-medium flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                        Configure <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {filteredProviders.length === 0 && (
                <div className="text-center py-12 text-zinc-500">
                  <p className="text-sm">No providers match your search.</p>
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedCategory("all");
                    }}
                    className="mt-2 text-xs text-blue-400 hover:underline cursor-pointer"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </>
          ) : (
            /* STEP 2: Configuration Form for Selected Provider */
            selectedProvider.id === "oracle" && !existingAccount && ociMode === "upload" ? (
              <div className="space-y-5">
                {selectedProvider.id === "oracle" && !existingAccount && (
                <div role="tablist" aria-label="How to add the OCI account" className="flex gap-2 text-xs">
                  {([["manual", "Fill in the details"], ["upload", "Upload OCI config"]] as const).map(([id, name]) => (
                    <button key={id} type="button" role="tab" aria-selected={ociMode === id} onClick={() => setOciMode(id)} className={`rounded-lg border px-3 py-1.5 ${ociMode === id ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 text-zinc-300"}`}>{name}</button>
                  ))}
                </div>
              )}
                <OciConfigImport ownerEmail={ownerEmail} onFinished={allConnected => { if (allConnected) setTimeout(() => { onSuccess(); onClose(); handleBack(); }, 1500); }} />
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {selectedProvider.id === "oracle" && !existingAccount && (
                <div role="tablist" aria-label="How to add the OCI account" className="flex gap-2 text-xs">
                  {([["manual", "Fill in the details"], ["upload", "Upload OCI config"]] as const).map(([id, name]) => (
                    <button key={id} type="button" role="tab" aria-selected={ociMode === id} onClick={() => setOciMode(id)} className={`rounded-lg border px-3 py-1.5 ${ociMode === id ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 text-zinc-300"}`}>{name}</button>
                  ))}
                </div>
              )}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}

              {scanReady && selectedProvider && (
                <details className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
                  <summary className="cursor-pointer font-semibold text-zinc-200">Fetch everything with an agent</summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-zinc-400">Copy this read-only prompt into an agent with your provider CLI or MCP configured.</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{promptText}</pre>
                    <button type="button" onClick={async () => { await navigator.clipboard.writeText(promptText); setPromptCopied(true); }} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">{promptCopied ? "Copied" : "Copy"}</button>
                  </div>
                </details>
              )}

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-300">
                <label className="flex items-center gap-2"><input type="checkbox" checked={inventoryOnly} disabled={Boolean(existingAccount)} onChange={event => setInventoryOnly(event.target.checked)} />Register inventory only</label>
                <p className="mt-2 text-zinc-400">{inventoryOnly ? "Save an unverified account without credentials. No resources or usage are invented." : "Credentials are written to the verified Infisical scope. Discovery remains pending."}</p>
                {!setupReady && <p className="mt-2 text-amber-300">Verify a secret store (Infisical or the built-in store) in Setup connections to enable credential storage.</p>}
              </div>
              {/* Common Account Identity Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                    Account Label <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={accountLabel} disabled={Boolean(existingAccount)}
                    onChange={(e) => setAccountLabel(e.target.value)}
                    placeholder="e.g. Production OCI Tenancy"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">Unique descriptive name for this account.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                    Owner Email <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={ownerEmail} disabled={Boolean(existingAccount)}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 text-base sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">Contact for quota alerts & security boundary.</p>
                </div>
              </div>

              {/* Protection & Role Policy */}
              <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span id="shielding-label" className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5 text-amber-400" />
                      Production Shielding (Guardrail G3)
                    </span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Shielding unconditionally prevents automated or untrusted batch workloads from running on this account.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer" aria-labelledby="shielding-label">
                    <input
                      type="checkbox"
                      checked={isProtected}
                      onChange={(e) => setIsProtected(e.target.checked)}
                      className="sr-only peer focus-visible:outline-none"
                    />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-sky-500 peer-focus-visible:outline-offset-2 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
                  </label>
                </div>
              </div>

              {/* Defaults applied to resources discovered for this account */}
              <details className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-4 text-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md font-bold text-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
                  <span>Labels applied to discovered resources</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-zinc-400">
                    <span>{roleLabels[role]} · {lifecycleLabels[lifecycle]} · {backupClass.replace(/_/g, " ")}</span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-90" />
                  </span>
                </summary>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block text-sm text-zinc-300">Role
                    <select value={role} onChange={e => setRole(e.target.value as Role)} className="mt-1 min-h-11 w-full rounded-lg bg-zinc-950 border border-zinc-700 px-2 text-base text-zinc-100 sm:text-sm">
                      {roles.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-zinc-300">Lifecycle
                    <select value={lifecycle} onChange={e => setLifecycle(e.target.value as Lifecycle)} className="mt-1 min-h-11 w-full rounded-lg bg-zinc-950 border border-zinc-700 px-2 text-base text-zinc-100 sm:text-sm">
                      {lifecycles.map(value => <option key={value} value={value}>{lifecycleLabels[value]}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm text-zinc-300">Backup class
                    <select value={backupClass} onChange={e => setBackupClass(e.target.value as BackupClass)} className="mt-1 min-h-11 w-full rounded-lg bg-zinc-950 border border-zinc-700 px-2 text-base text-zinc-100 sm:text-sm">
                      {backupClasses.map(value => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-xs text-zinc-400">Defaults for resources discovered in the first scan. You can change any resource later in its drawer. Protected resources never get approve or auto stop from here.</p>
              </details>

              {/* Provider-Specific Config Fields */}
              <div className="space-y-4 pt-2 border-t border-zinc-800/80">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-400">
                  {selectedProvider.name} Credentials & Settings
                </h4>

                {selectedProvider.configFields?.filter(field => !inventoryOnly || field.type === "select").map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center justify-between">
                      <span>
                        {field.label} {field.required && <span className="text-rose-400">*</span>}
                      </span>
                      {field.secret && (
                        <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" /> Vault setup required
                        </span>
                      )}
                    </label>

                    {field.type === "select" ? (
                      <div className="space-y-2">
                        <select
                          value={formValues[field.key] ?? field.defaultValue ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            const updated = { ...formValues, [field.key]: val };
                            if (field.key === "deploymentMode") {
                              if (val === "bundled") {
                                if (selectedProvider.id === "cliproxyapi") {
                                  updated.endpointUrl = "http://127.0.0.1:8317";
                                  updated.managementUrl = "http://127.0.0.1:8317/management.html";
                                } else if (selectedProvider.id === "infisical") {
                                  updated.baseUrl = "http://127.0.0.1:8088";
                                }
                              } else if (val === "existing") {
                                if (selectedProvider.id === "infisical") {
                                  updated.baseUrl = "https://app.infisical.com";
                                }
                              }
                            }
                            setFormValues(updated);
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
                        >
                          {field.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {field.key === "deploymentMode" && formValues[field.key] === "bundled" && (
                          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300 flex items-center justify-between">
                            <span>Bundled Docker Engine: Managed via compose.yml stack.</span>
                            <code className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-blue-400 font-mono">
                              docker compose up -d {selectedProvider.id === "cliproxyapi" ? "cli-proxy-api" : "infisical"}
                            </code>
                          </div>
                        )}
                        {field.key === "deploymentMode" && formValues[field.key] === "existing" && (
                          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400">
                            Connecting Existing Instance: Enter the remote host, cluster DNS, or Tailscale address of your running service below.
                          </div>
                        )}
                      </div>
                    ) : field.type === "textarea" ? (
                      <textarea
                        rows={3}
                        required={field.required}
                        value={formValues[field.key] || ""}
                        onChange={(e) =>
                          setFormValues({ ...formValues, [field.key]: e.target.value })
                        }
                        placeholder={field.placeholder}
                        className="w-full font-mono bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                      />
                    ) : (
                      <input
                        type={field.type}
                        required={field.required}
                        value={formValues[field.key] || ""}
                        onChange={(e) =>
                          setFormValues({ ...formValues, [field.key]: e.target.value })
                        }
                        placeholder={field.placeholder}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-base sm:text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                      />
                    )}
                    <p className="text-[11px] text-zinc-500 mt-1">{field.description}</p>
                  </div>
                ))}
              </div>

              {!inventoryOnly && <p className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-4 text-xs text-zinc-300">Credentials are saved only to the Infisical project and path verified in Setup connections. FleetHub stores a reference and keeps this account pending discovery.</p>}

              {/* Form Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Back
                </button>

                {!inventoryOnly && selectedProvider && ["cloudflare", "upstash", "supabase", "neon", "oracle"].includes(selectedProvider.id) && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={async () => {
                      setIsSubmitting(true); setErrorMessage(null); setSuccessMessage("Testing the credentials…");
                      const outcome = await testCredential(selectedProvider.id, formValues);
                      setIsSubmitting(false);
                      if (outcome.ok) setSuccessMessage(outcome.message); else { setSuccessMessage(null); setErrorMessage(outcome.message); }
                    }}
                    className="px-4 py-2 rounded-xl border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                  >
                    Test connection
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-white text-black hover:bg-zinc-200 disabled:opacity-50 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all shadow-lg"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving account...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      <span>{inventoryOnly ? "Register inventory account" : "Save credentials to vault"}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
            )
          )}
        </div>
      </div>
    </div>
  );
}
