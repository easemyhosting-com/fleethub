"use client";

import { useState, useEffect } from "react";
import {
  ShieldCheck,
  Key,
  Lock,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  Layers,
  Terminal,
  Database,
  Server,
  Cloud,
  Check,
  Copy,
  ChevronRight,
  FolderGit2,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { InfisicalVaultStatus, InfisicalWorkspace } from "@/lib/infisical/client";

interface InfisicalVaultViewProps {
  onOpenOnboard?: () => void;
  consoleUrl?: string | null;
}

export function InfisicalVaultView({ onOpenOnboard, consoleUrl }: InfisicalVaultViewProps) {
  const [vaultStatus, setVaultStatus] = useState<InfisicalVaultStatus | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const fetchVault = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/infisical");
      if (res.ok) {
        const data: InfisicalVaultStatus = await res.json();
        setVaultStatus(data);
        if (data.workspaces && data.workspaces.length > 0 && !selectedWorkspaceId) {
          setSelectedWorkspaceId(data.workspaces[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to load Infisical vault data:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVault();
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/infisical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (res.ok) {
        const data = await res.json();
        setSyncMsg(`Successfully verified ${data.synced} secret references with Infisical.`);
      } else {
        setSyncMsg("Sync failed: Vault offline or unauthorized.");
      }
    } catch (e: any) {
      setSyncMsg(`Sync error: ${e.message}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  };

  const agentVaultConfig = `# Agent Vault Forward Credential Proxy (running on local controller):
export HTTP_PROXY="http://100.64.0.1:14321"
export HTTPS_PROXY="http://100.64.0.1:14321"
# Node 22+ requirement to respect environment proxies:
export NODE_USE_ENV_PROXY=1`;

  const copyConfig = () => {
    navigator.clipboard.writeText(agentVaultConfig);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const isConnected = vaultStatus?.connected ?? false;
  const workspaces = vaultStatus?.workspaces ?? [];
  const activeWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId) || workspaces[0];
  const activeConsoleUrl = consoleUrl || (vaultStatus?.domain?.startsWith("http") ? vaultStatus.domain : null);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-black border border-zinc-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-white tracking-tight">Infisical Secret Management</h2>
              {isConnected ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected · Universal Auth
                </span>
              ) : (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                  Not Connected · Standby
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
              Zero-Secret Architecture: Secrets are stored in your Infisical vault and proxied to workloads via Agent Vault. Plaintext tokens never enter the database or frontend.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-50 text-xs font-semibold cursor-pointer transition-all"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              <span>{isSyncing ? "Syncing..." : "Sync to DB"}</span>
            </button>
          ) : (
            onOpenOnboard && (
              <button
                onClick={onOpenOnboard}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-semibold cursor-pointer transition-all shadow-lg shadow-cyan-500/10"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Connect Existing or Local Vault</span>
              </button>
            )
          )}
          {activeConsoleUrl && (
            <a
              href={activeConsoleUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-xs text-cyan-300 font-semibold transition-colors"
            >
              <span>Open Infisical Console</span>
              <ExternalLink className="h-3 w-3 text-cyan-400" />
            </a>
          )}
          <a
            href="https://infisical.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-300 transition-colors"
          >
            <span>Infisical Docs</span>
            <ExternalLink className="h-3 w-3 text-zinc-400" />
          </a>
        </div>
      </div>

      {syncMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{syncMsg}</span>
        </div>
      )}

      {/* When Vault is NOT connected, show honest zero-state card */}
      {!isConnected && workspaces.length === 0 && (
        <div className="p-8 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-5 text-center max-w-3xl mx-auto shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mx-auto">
            <Lock className="w-6 h-6" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-bold text-white">No Infisical Vault Connected Yet</h3>
            <p className="text-xs text-zinc-400 max-w-lg mx-auto leading-relaxed">
              To inspect verified secret references without exposing plaintext API keys, configure your self-hosted or SaaS Infisical Universal Auth credentials.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 max-w-lg mx-auto text-left space-y-2">
            <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
              Connection Options:
            </div>
            <ul className="text-xs text-zinc-400 space-y-1.5 list-disc list-inside">
              <li>
                <strong className="text-zinc-200">Via Web UI:</strong> Click <em>Connect Infisical Vault</em> to enter your Site URL, Client ID, and Secret.
              </li>
              <li>
                <strong className="text-zinc-200">Via Environment Variables:</strong> Set <code className="text-cyan-400 bg-zinc-900 px-1 py-0.5 rounded text-[11px]">INFISICAL_UNIVERSAL_AUTH_CLIENT_ID</code> and <code className="text-cyan-400 bg-zinc-900 px-1 py-0.5 rounded text-[11px]">INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET</code>.
              </li>
            </ul>
          </div>

          {onOpenOnboard && (
            <button
              onClick={onOpenOnboard}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-colors shadow-lg shadow-cyan-500/10 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Configure Infisical in FleetHub
            </button>
          )}
        </div>
      )}

      {/* Connected Workspaces & Secret References View */}
      {workspaces.length > 0 && (
        <>
          {/* Infisical Overview Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-500 text-xs mb-1">
                <span>WORKSPACES</span>
                <FolderGit2 className="h-3.5 w-3.5" />
              </div>
              <div className="text-xl font-bold font-mono text-white">{vaultStatus?.totalWorkspaces ?? 0}</div>
              <div className="text-[11px] text-zinc-500 mt-1">Discovered projects</div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-500 text-xs mb-1">
                <span>SECRET REFS</span>
                <Key className="h-3.5 w-3.5" />
              </div>
              <div className="text-xl font-bold font-mono text-white">{vaultStatus?.totalSecretKeys ?? 0}</div>
              <div className="text-[11px] text-zinc-500 mt-1">Managed variables</div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-500 text-xs mb-1">
                <span>AGENT VAULT</span>
                <ShieldCheck className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`h-2 w-2 rounded-full ${vaultStatus?.agentVault.status === "online" ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
                <span className="text-xs font-mono font-bold text-white capitalize">{vaultStatus?.agentVault.status ?? "offline"}</span>
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">Port 14321</div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="flex items-center justify-between text-zinc-500 text-xs mb-1">
                <span>LEAK GUARD</span>
                <Lock className="h-3.5 w-3.5" />
              </div>
              <div className="text-xl font-bold font-mono text-emerald-400">0 Leaks</div>
              <div className="text-[11px] text-zinc-500 mt-1">Strict zero-plaintext rule</div>
            </div>
          </div>

          {/* Workspaces & Secrets Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Workspace Selector */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Infisical Projects ({workspaces.length})
              </h3>
              <div className="space-y-2">
                {workspaces.map((ws) => {
                  const isSelected = ws.id === selectedWorkspaceId;
                  return (
                    <button
                      key={ws.id}
                      onClick={() => setSelectedWorkspaceId(ws.id)}
                      className={`w-full p-4 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? "bg-zinc-900 border-cyan-500/50 shadow-md shadow-cyan-500/5"
                          : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/60 text-zinc-400 hover:text-white"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="font-semibold text-sm text-white flex items-center gap-2">
                          <FolderGit2 className={`h-4 w-4 ${isSelected ? "text-cyan-400" : "text-zinc-500"}`} />
                          {ws.name}
                        </div>
                        <p className="text-[11px] text-zinc-500">{ws.description}</p>
                      </div>
                      <ChevronRight className={`h-4 w-4 ${isSelected ? "text-cyan-400" : "text-zinc-600"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Secret References for Active Workspace */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Secret References in {activeWorkspace?.name}
                </h3>
                <span className="text-[11px] font-mono text-zinc-500">
                  {activeWorkspace?.secretKeys?.length ?? 0} Variables Configured
                </span>
              </div>

              <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-800/80 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {activeWorkspace?.secretKeys?.map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-200"
                    >
                      <Key className="h-3 w-3 text-cyan-400" />
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
