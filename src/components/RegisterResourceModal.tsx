"use client";

import { useState } from "react";
import { X, Check, ShieldCheck, Key, Server, HardDrive, Database, Zap, Layers } from "lucide-react";
import { MASTER_CATALOG } from "@/lib/catalog/providers";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRegister: (data: any) => void;
}

export function RegisterResourceModal({ isOpen, onClose, onRegister }: Props) {
  const [selectedProvider, setSelectedProvider] = useState<string>("cloudflare");
  const [resourceName, setResourceName] = useState("");
  const [category, setCategory] = useState<string>("compute");
  const [ownerEmail, setOwnerEmail] = useState("operator@fleethub.dev");
  const [infisicalPath, setInfisicalPath] = useState("/providers/cloudflare/main");
  const [tags, setTags] = useState<string>("arm64, fast");

  if (!isOpen) return null;

  const provider = MASTER_CATALOG.find((p) => p.id === selectedProvider) || MASTER_CATALOG[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRegister({
      name: resourceName || `${provider.name} Resource`,
      provider: provider.name,
      category,
      accountEmail: ownerEmail,
      infisicalPath,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#0c1222] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Register Fleet Resource</h3>
              <p className="text-xs text-slate-400">Add free or paid compute, storage, DB, or LLM keys to the registry.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Provider Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              1. Select Cloud / Service Provider
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {MASTER_CATALOG.map((p) => {
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProvider(p.id);
                      setInfisicalPath(`/providers/${p.id}/main`);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      isSelected
                        ? "bg-blue-600/15 border-blue-500 text-white shadow-md shadow-blue-500/10"
                        : "bg-slate-900/60 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    <span className="font-semibold text-xs leading-tight">{p.name}</span>
                    <span className="text-[10px] text-slate-500 mt-1 capitalize">{p.tier.replace("_", " ")}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Resource Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Resource Name / Label
              </label>
              <input
                type="text"
                placeholder="e.g. global-redis-cache"
                value={resourceName}
                onChange={(e) => setResourceName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="compute">Compute (VM / Runner / Ephemeral)</option>
                <option value="storage">Storage (R2 / S3 / Drive)</option>
                <option value="database">Database (Redis / Postgres / SQLite)</option>
                <option value="serverless">Serverless / Workers</option>
                <option value="llm">LLM API Key / Router</option>
              </select>
            </div>
          </div>

          {/* Owner Identity & Infisical Secrets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Owner Identity (Email)
              </label>
              <select
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="operator@fleethub.dev">operator@fleethub.dev (Primary)</option>
                <option value="sandbox@fleethub.dev">sandbox@fleethub.dev (Sandbox)</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">Isolates credentials & blast radius per identity.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Infisical Secret Pointer</span>
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3" /> Zero-Secret
                </span>
              </label>
              <div className="relative">
                <Key className="h-4 w-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  value={infisicalPath}
                  onChange={(e) => setInfisicalPath(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-cyan-400 focus:outline-none focus:border-blue-500"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Pointer only. No secret values ever reach FleetDeck.</p>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Tags (comma separated)
            </label>
            <input
              type="text"
              placeholder="arm64, protected, ephemeral, fast"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Provider Policy Box */}
          <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
            <span className="font-semibold text-slate-300">Policy Check: </span>
            <span className="text-slate-400">{provider.policy.clause || "Standard provider fair use applies."}</span>
          </div>

          {/* Submit Buttons */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20 transition-all flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              <span>Confirm & Register</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
