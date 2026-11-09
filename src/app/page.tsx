"use client";

import { Activity, useState, useEffect, useMemo, useRef } from "react";
import { Smartphone, Server, Clock, Shield, Search, ExternalLink, Bot, Zap, Plus, Wifi, RefreshCw, Lock, Menu, X, Compass } from "lucide-react";
import { FleetOverviewHub } from "@/components/FleetOverviewHub";
import { IdentityAccountsView } from "@/components/IdentityAccountsView";
import { ProviderOnboardingModal } from "@/components/ProviderOnboardingModal";
import { BulkImportModal } from "@/components/BulkImportModal";
import { ExpiryBanner } from "@/components/ExpiryBanner";
import { AuthModal } from "@/components/AuthModal";
import { SetupWizard } from "@/components/SetupWizard";
import { GuidedTour } from "@/components/GuidedTour";
import { AgentAccessPanel } from "@/components/AgentAccessPanel";
import { DevicesPanel } from "@/components/DevicesPanel";
import { CapacityLimitsPanel } from "@/components/CapacityLimitsPanel";
import { FleetFilterBar } from "@/components/FleetFilterBar";
import { useIdentities } from "@/components/IdentityPicker";
import { filterFleetProblems } from "@/lib/fleet/problem-search";
import { applyBilling, hasPaidResources } from "@/lib/fleet/billing";
import { hasFilter, filterSnapshot, filterToParams, parseFilter, type FleetFilter } from "@/lib/fleet/filters";
import { FleetResourceDetails } from "@/components/FleetResourceDetails";
import { FleetMapPanel } from "@/components/FleetMapPanel";
import { ProjectsView } from "@/components/ProjectsView";
import { markTourDone, shouldAutoStartTour, type TourAction } from "@/lib/tour/steps";
import { z } from "zod";
import { fleetSnapshotSchema, retainSnapshotAfterReadFailure, type FleetSnapshot, type FleetAccount } from "@/lib/inventory/model";

type MainTab = "resources" | "clock" | "dispatcher" | "identity" | "mesh" | "infisical" | "aiGateway" | "agents" | "devices" | "limits" | "map" | "projects";

export default function FleetDeckPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("resources");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [fleetData, setFleetData] = useState<FleetSnapshot | null>(null);
  const [fleetStatus, setFleetStatus] = useState<"loading" | "signedout" | "unavailable" | "ready">("loading");
  const [fleetError, setFleetError] = useState("");
  const [initialSetupStep, setInitialSetupStep] = useState<"tailscale" | "infisical" | "cliproxy" | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const selectedResource = selectedResourceId ? fleetData?.resources.find(resource => resource.id === selectedResourceId) : undefined;
  const selectedResourceAccount = selectedResource?.accountId ? fleetData?.accounts.find(account => account.id === selectedResource.accountId) : undefined;
  const selectResource = (id: string) => {
    if (!fleetData?.resources.some(resource => resource.id === id)) return false;
    setSelectedResourceId(id);
    return true;
  };
  const isFleetView = activeTab === "resources" || activeTab === "map" || activeTab === "identity";
  const [filter, setFilterState] = useState<FleetFilter>({});
  const people = useIdentities();
  useEffect(() => { setFilterState(parseFilter(new URLSearchParams(window.location.search))); }, []);
  const setFilter = (next: FleetFilter) => {
    setFilterState(next);
    const params = filterToParams(next, new URLSearchParams(window.location.search));
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
  };
  const [showPaid, setShowPaid] = useState(true);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [attention, setAttention] = useState(false);
  const scoped = useMemo(() => fleetData ? filterSnapshot(fleetData, filter) : null, [fleetData, filter]);
  const billed = useMemo(() => scoped ? applyBilling(scoped, showPaid) : null, [scoped, showPaid]);
  const shown = useMemo(() => billed ? filterFleetProblems(billed, search, attention) : null, [billed, search, attention]);
  const isSearching = Boolean(search.trim() || attention);
  const identityMatches = useMemo(() => shown && (isSearching || billed !== scoped) ? {
    accounts: new Set(shown.accounts.map(account => account.id)),
    resources: new Set(shown.resources.map(resource => resource.id)),
  } : undefined, [shown, isSearching, billed, scoped]);
  const filterBar = isFleetView && fleetData ? <FleetFilterBar searchInputRef={searchInputRef} search={search} onSearch={setSearch} attention={attention} onAttention={setAttention} filter={filter} onChange={setFilter} paid={hasPaidResources(fleetData) ? { show: showPaid, onChange: setShowPaid } : undefined} identities={people} resultCount={shown?.accounts.length} providers={[...new Set(fleetData.accounts.map(account => account.kind))].sort()} /> : null;

  // Modals & Drawers state
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [credentialAccount, setCredentialAccount] = useState<FleetAccount | null>(null);
  const [initialProviderForModal, setInitialProviderForModal] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [setupLinks, setSetupLinks] = useState<{ infisical: string | null; cliproxy: string | null }>({ infisical: null, cliproxy: null });
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string; provider: string } | null>(null);

  const checkUserSession = async () => {
    try {
      const res = await fetch("/api/auth");
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user || null);
      }
    } catch {
      // Ignore
    }
  };

  const handleOpenOnboarding = (providerId?: string) => {
    setCredentialAccount(null);
    if (providerId && ["tailscale", "infisical", "cliproxy", "cliproxyapi"].includes(providerId)) {
      setInitialSetupStep(providerId === "cliproxyapi" || providerId === "cliproxy" ? "cliproxy" : providerId === "infisical" ? "infisical" : "tailscale");
      setIsSetupOpen(true);
      return;
    }
    setInitialProviderForModal(providerId || null);
    setIsOnboardingOpen(true);
  };

  const loadSetupLinks = async () => {
    try {
      const response = await fetch("/api/onboarding");
      if (!response.ok) { setSetupLinks({ infisical: null, cliproxy: null }); return; }
      const parsed = z.object({ steps: z.array(z.object({ id: z.string(), status: z.string(), config: z.object({ consoleUrl: z.url().optional() }).passthrough() })) }).safeParse(await response.json());
      if (!parsed.success) { setSetupLinks({ infisical: null, cliproxy: null }); return; }
      const link = (id: string) => {
        const step = parsed.data.steps.find(item => item.id === id && item.status === "verified");
        return step?.config.consoleUrl ?? null;
      };
      setSetupLinks({ infisical: link("infisical"), cliproxy: link("cliproxy") });
    } catch { setSetupLinks({ infisical: null, cliproxy: null }); }
  };

  const loadFleetData = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/fleet", { cache: "no-store" });
      if (res.status === 401) { setFleetData(null); setFleetStatus("signedout"); return; }
      if (!res.ok) throw new Error(res.status === 503 ? "Stored inventory is unavailable. Try again after the database is ready." : `Inventory request failed (${res.status}).`);
      const parsed = fleetSnapshotSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Inventory response has an unexpected format.");
      setFleetData(parsed.data);
      setFleetStatus("ready");
      setFleetError("");
    } catch (cause) {
      setFleetData(previous => previous ? retainSnapshotAfterReadFailure(previous) : null);
      setFleetStatus(previous => previous === "ready" ? "ready" : "unavailable");
      setFleetError(cause instanceof Error ? cause.message : "Could not load inventory.");
    } finally { setIsRefreshing(false); }
  };

  const refreshAll = async () => { await Promise.all([loadFleetData(), loadSetupLinks()]); };

  useEffect(() => {
    if (shouldAutoStartTour(window.localStorage)) setIsTourOpen(true);
  }, []);

  const closeTour = () => { markTourDone(window.localStorage); setIsTourOpen(false); };
  const runTourAction = (action: TourAction) => {
    markTourDone(window.localStorage);
    setIsTourOpen(false);
    if (action === "auth") setIsAuthModalOpen(true);
    else if (action === "setup") { setInitialSetupStep(undefined); setIsSetupOpen(true); }
    else handleOpenOnboarding();
  };

  useEffect(() => {
    loadFleetData();
    checkUserSession();
    loadSetupLinks();
  }, []);

  useEffect(() => {
    if (!fleetData?.accounts.some(account => account.collection.state === "queued" || account.collection.state === "running")) return;
    const timer = setInterval(loadFleetData, 5000);
    return () => clearInterval(timer);
  }, [fleetData]);

  useEffect(() => {
    const timer = setInterval(loadSetupLinks, 60000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard shortcut: '/' or '⌘K' focuses search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const editable = e.target instanceof Element && Boolean(e.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=\"false\"]), [role=\"textbox\"]"));
      if (editable) return;
      // An open modal owns the keyboard; the shortcut must not move focus behind it.
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        const searchInput = searchInputRef.current;
        if (!searchInput) return;
        e.preventDefault();
        searchInput.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const registeredAccountsCount = fleetData?.accounts?.length ?? 0;

  const cliproxyManagementUrl = setupLinks.cliproxy;
  const infisicalConsoleUrl = setupLinks.infisical;

  const NAV_SECTIONS = [
    {
      group: "FLEET COMMAND",
      items: [
        { id: "map", label: "Fleet Map", icon: Compass, badge: null },
        { id: "projects", label: "Projects", icon: Server, badge: null },
        { id: "resources", label: "Fleet Resources", icon: Server, badge: fleetData?.resources.length ? `${fleetData.resources.length} registered` : null },
        { id: "clock", label: "Quota guidance", icon: Clock, badge: null },
        { id: "limits", label: "Limits & allowances", icon: Shield, badge: null },
      ],
    },
    {
      group: "WORKLOADS & MESH",
      items: [
        { id: "dispatcher", label: "Workload planning", icon: Zap, badge: null },
        { id: "mesh", label: "Tailscale setup", icon: Wifi, badge: null },
      ],
    },
    {
      group: "AI & CREDENTIALS",
      items: [
        { id: "aiGateway", label: "AI gateway", icon: Bot, badge: null },
        { id: "infisical", label: "Infisical setup", icon: Lock, badge: null },
        { id: "agents", label: "Agent access", icon: Bot, badge: null },
        { id: "devices", label: "Devices & sessions", icon: Smartphone, badge: null },
        { id: "identity", label: "Identities & Accounts", icon: Shield, badge: registeredAccountsCount > 0 ? `${registeredAccountsCount}` : null },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#090a0f] text-[#f4f4f5] flex font-sans antialiased selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* SIDEBAR NAVIGATION (Desktop) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col justify-between bg-[#0b0d13] border-r border-zinc-800/80 p-4 sticky top-0 h-screen z-30">
        <div className="space-y-6">
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center text-black font-extrabold shadow-lg shadow-emerald-500/20">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base tracking-tight">FleetHub</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  v1.0
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 font-mono">Stored inventory</p>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="space-y-5">
            {NAV_SECTIONS.map((section) => (
              <div key={section.group} className="space-y-1">
                <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-zinc-500 px-2.5 mb-1.5">
                  {section.group}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as MainTab)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                        isActive
                          ? "bg-zinc-800/90 text-white font-semibold shadow-sm border border-zinc-700/80"
                          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`h-4 w-4 ${isActive ? "text-emerald-400" : "text-zinc-400"}`} />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                            isActive
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : "bg-zinc-900 text-zinc-500"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="pt-4 border-t border-zinc-800/80 space-y-3">
          <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">Registered inventory</span>
              <span className="text-emerald-400 font-semibold">{registeredAccountsCount} Accounts</span>
            </div>
            <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
              <div
                className={`h-full ${registeredAccountsCount > 0 ? "bg-emerald-400" : "bg-zinc-700"}`}
                style={{ width: registeredAccountsCount > 0 ? "100%" : "8%" }}
              />
            </div>
          </div>

          <button onClick={() => setIsTourOpen(true)} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-900 text-xs font-medium cursor-pointer">
            <Compass className="h-3.5 w-3.5" />
            <span>Guided tour</span>
          </button>

          <button
            onClick={() => handleOpenOnboarding()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold transition-all shadow-lg hover:shadow-emerald-500/20 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Connect Provider</span>
          </button>
          <button
            onClick={() => setIsImportOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-200 text-xs font-semibold transition-all cursor-pointer"
          >
            <span>Paste several tokens</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="min-w-0 flex-1 flex flex-col min-h-screen">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 h-16 bg-[#090a0f]/90 backdrop-blur-md border-b border-zinc-800/80 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* Mobile Menu Toggle */}
            <button
              aria-label={isMobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={isMobileNavOpen}
              onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
              className="p-2 rounded-lg text-zinc-400 hover:text-white md:hidden cursor-pointer"
            >
              {isMobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight capitalize">

          {activeTab === "resources" && "Fleet inventory"}
                  {activeTab === "clock" && "Quota guidance"}
                  {activeTab === "dispatcher" && "Workload planning"}
                  {activeTab === "mesh" && "Tailscale setup"}
                  {activeTab === "aiGateway" && "AI gateway setup"}
                  {activeTab === "infisical" && "Infisical setup"}
                  {activeTab === "identity" && "Identities & Accounts"}
                  {activeTab === "agents" && "Agent access"}
                  {activeTab === "devices" && "Devices & sessions"}
                  {activeTab === "limits" && "Limits & allowances"}
                  {activeTab === "map" && "Fleet Map"}
                  {activeTab === "projects" && "Projects"}
                </h1>

              </div>
              <p className="text-[11px] text-zinc-400 hidden sm:block">

          {activeTab === "resources" && "Accounts and resources from the stored snapshot."}
                {activeTab === "clock" && "Usage and entitlement are not measured here."}
                {activeTab === "dispatcher" && "No workload execution from this page."}
                {activeTab === "mesh" && "Verify this host's Tailscale connection in setup."}
                {activeTab === "aiGateway" && "Open the verified gateway console for live details."}
                {activeTab === "infisical" && "Manage credentials in your verified vault console."}
                {activeTab === "identity" && "Hierarchical graph of accounts, contacts, and protection policies."}
                {activeTab === "agents" && "Read-only keys for coding agents and MCP clients."}
                {activeTab === "devices" && "Pair phones and revoke any signed-in session."}
                {activeTab === "limits" && "Free-tier figures and what you allow FleetHub to use."}
                {activeTab === "map" && "Every resource at a glance. Click a tile for details and labels."}
                {activeTab === "projects" && "What each project has, needs and uses."}
              </p>
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2.5">

            <div className="hidden xl:flex items-center gap-1.5 border-r border-zinc-800 pr-2 mr-1">
              {cliproxyManagementUrl ? (
                <a
                  href={cliproxyManagementUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-[11px] font-mono transition-colors"
                  title={`Open CLIProxy Web UI (${cliproxyManagementUrl})`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span>CLIProxy UI</span>
                  <ExternalLink className="h-3 w-3 text-amber-400" />
                </a>
              ) : (
                <button
                  onClick={() => { setInitialSetupStep("cliproxy"); setIsSetupOpen(true); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-amber-300 border border-zinc-800 text-[11px] font-mono transition-colors cursor-pointer"
                  title="Connect an existing CLIProxy or spin up local instance"
                >
                  <Plus className="h-3 w-3 text-amber-400" />
                  <span>Connect CLIProxy</span>
                </button>
              )}

              {infisicalConsoleUrl ? (
                <a
                  href={infisicalConsoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 text-[11px] font-mono transition-colors"
                  title={`Open Infisical Vault Console (${infisicalConsoleUrl})`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span>Infisical Vault</span>
                  <ExternalLink className="h-3 w-3 text-cyan-400" />
                </a>
              ) : (
                <button
                  onClick={() => { setInitialSetupStep("infisical"); setIsSetupOpen(true); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-cyan-300 border border-zinc-800 text-[11px] font-mono transition-colors cursor-pointer"
                  title="Connect an existing Infisical Vault (Cloud/Self-Hosted) or spin up local instance"
                >
                  <Plus className="h-3 w-3 text-cyan-400" />
                  <span>Connect Infisical</span>
                </button>
              )}
            </div>

            <button
              onClick={() => handleOpenOnboarding()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Connect Provider</span>
            </button>
            {/* User Session / Access Gate */}
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                currentUser
                  ? "bg-zinc-900 border-zinc-700 text-zinc-200 hover:border-emerald-500/40"
                  : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-white"
              }`}
              title={currentUser ? `Signed in as ${currentUser.email}` : "Configure Email & Password or Google OAuth"}
            >
              <Shield className={`h-3.5 w-3.5 ${currentUser ? "text-emerald-400" : "text-zinc-400"}`} />
              <span className="hidden sm:inline">
                {currentUser ? currentUser.email.split("@")[0] : "Access & Auth"}
              </span>
            </button>

            <button
              onClick={refreshAll}
              disabled={isRefreshing}
              className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Fleet State"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {/* Mobile Dropdown Nav Menu */}
        {isMobileNavOpen && (
          <div className="md:hidden bg-[#0b0d13] border-b border-zinc-800 p-4 space-y-2">
            {NAV_SECTIONS.flatMap((s) => s.items).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as MainTab);
                    setIsMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium ${
                    isActive ? "bg-zinc-800 text-white font-semibold" : "text-zinc-400 hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && <span className="text-[10px] font-mono text-zinc-500">{item.badge}</span>}
                </button>
              );
            })}
            <button onClick={() => { setIsTourOpen(true); setIsMobileNavOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:bg-zinc-900"><Compass className="h-4 w-4" /><span>Guided tour</span></button>
          </div>
        )}

        {/* Dynamic View Container */}
        <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
          {filterBar}
          {fleetData && <ExpiryBanner accounts={fleetData.accounts} onReview={() => setActiveTab("resources")} />}
          {/* TAB 1: FLEET RESOURCES */}
          {fleetError && fleetData && <p role="alert" className="mb-4 rounded-xl border border-amber-900 p-4 text-sm text-amber-300">{fleetError} Showing the previous snapshot from {new Date(fleetData.timestamp).toLocaleString()}. Worker status has not been rechecked.</p>}
          {activeTab === "resources" && (fleetStatus === "loading" ? <div role="status" className="rounded-xl border border-zinc-800 p-8 text-zinc-300">Loading stored inventory…</div> : fleetStatus === "signedout" ? <div className="rounded-xl border border-zinc-800 p-8"><h2 className="text-lg font-semibold">Sign in to view inventory</h2><button onClick={() => setIsAuthModalOpen(true)} className="mt-4 rounded bg-emerald-500 px-4 py-2 text-sm text-black">Open Access & Auth</button></div> : fleetStatus === "unavailable" ? <div role="alert" className="rounded-xl border border-rose-900 p-8"><h2 className="text-lg font-semibold">Inventory unavailable</h2><p className="mt-2 text-sm text-rose-300">{fleetError}</p><button onClick={refreshAll} className="mt-4 rounded border border-zinc-700 px-4 py-2 text-sm">Retry</button></div> : shown ? <FleetOverviewHub onSelectResource={selectResource} onConnectCredentials={account => { setCredentialAccount(account); setInitialProviderForModal(account.kind); setIsOnboardingOpen(true); }} snapshot={shown} filtered={hasFilter(filter) || isSearching} onRefresh={refreshAll} isRefreshing={isRefreshing} onOpenOnboarding={handleOpenOnboarding} onOpenAuth={() => setIsAuthModalOpen(true)} /> : null)}

          {activeTab === "clock" && <StatusPanel title="Quota usage unavailable" text="FleetHub has no measured usage or verified account entitlements in this view. Check each provider console for current limits and billing." action="View accounts" onAction={() => setActiveTab("resources")} />}
          {activeTab === "dispatcher" && <StatusPanel title="Workload dispatch is not connected" text="No host execution targets are verified here. Use the host enrollment planning API to inspect a proposed placement before connecting a worker. This page does not run jobs." action="View inventory" onAction={() => setActiveTab("resources")} />}

          {/* TAB 4: IDENTITY & ACCOUNTS RELATIONSHIP GRAPH */}
          <Activity mode={activeTab === "identity" ? "visible" : "hidden"}>
            <IdentityAccountsView matches={identityMatches} fleetAccounts={fleetData?.accounts} onSelectResource={selectResource} onRefreshParent={loadFleetData} filter={filter} />
          </Activity>

          {activeTab === "agents" && <AgentAccessPanel />}
          {activeTab === "devices" && <DevicesPanel />}
          {activeTab === "limits" && <CapacityLimitsPanel />}
          {activeTab === "map" && (shown ? <FleetMapPanel fleet={shown} selectedId={selectedResourceId} onSelectResource={selectResource} /> : <div role="status" className="rounded-xl border border-zinc-800 p-8 text-zinc-300">{fleetStatus === "loading" ? "Loading stored inventory…" : "Inventory is unavailable."}</div>)}
          {activeTab === "projects" && <ProjectsView />}
          {activeTab === "mesh" && <StatusPanel title="Mesh status is not measured here" text="Set up or reverify this FleetHub host's Tailscale connection. Peer lists and node health need a separate verified source." action="Open Tailscale setup" onAction={() => handleOpenOnboarding("tailscale")} />}
          {activeTab === "infisical" && <StatusPanel title="Vault credentials stay in Infisical" text="FleetHub stores scoped credential references for registered accounts. Open the verified vault console to manage secret values." action="Open Infisical setup" onAction={() => handleOpenOnboarding("infisical")} externalUrl={infisicalConsoleUrl} externalLabel="Open verified vault console" />}
          {activeTab === "aiGateway" && <StatusPanel title="Gateway telemetry unavailable" text="This page has no verified live model list, key health, request totals, or quota measurements. Open the verified CLIProxyAPI console for current details." action="Open CLIProxyAPI setup" onAction={() => handleOpenOnboarding("cliproxyapi")} externalUrl={cliproxyManagementUrl} externalLabel="Open verified gateway console" />}
          {isFleetView && selectedResource && <FleetResourceDetails key={selectedResource.id} resource={selectedResource} account={selectedResourceAccount} onClose={() => setSelectedResourceId(null)} onSaved={loadFleetData} />}
        </main>
      </div>

      {/* Global Modals & Drawers */}
      <BulkImportModal isOpen={isImportOpen} ownerEmail={currentUser?.email ?? ""} onClose={() => setIsImportOpen(false)} onDone={refreshAll} />
      <ProviderOnboardingModal
        isOpen={isOnboardingOpen}
        existingAccount={credentialAccount}
        initialProviderId={initialProviderForModal}
        initialOwnerEmail={currentUser?.email ?? ""}
        onClose={() => {
          setIsOnboardingOpen(false);
          setInitialProviderForModal(null);
        }}
        onSuccess={() => {
          refreshAll();
          setIsOnboardingOpen(false);
          setInitialProviderForModal(null);
        }}
      />
      <button onClick={() => { setInitialSetupStep(undefined); setIsSetupOpen(true); }} className="fixed bottom-5 right-5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black shadow-lg">Setup connections</button>
      {isSetupOpen && <SetupWizard initialStep={initialSetupStep} onConnectProvider={() => { setIsSetupOpen(false); handleOpenOnboarding(); }} onClose={() => { setIsSetupOpen(false); refreshAll(); }} onReady={refreshAll} />}
      {isTourOpen && <GuidedTour onClose={closeTour} onAction={runTourAction} />}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSessionChange={() => { checkUserSession(); refreshAll(); }}
      />
    </div>
  );
}

function StatusPanel({ title, text, action, onAction, externalUrl, externalLabel }: { title: string; text: string; action: string; onAction: () => void; externalUrl?: string | null; externalLabel?: string }) {
  return <section className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 p-8"><h2 className="text-xl font-semibold text-white">{title}</h2><p className="mt-3 text-sm leading-6 text-zinc-400">{text}</p><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={onAction} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950">{action}</button>{externalUrl && <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200">{externalLabel}</a>}</div></section>;
}
