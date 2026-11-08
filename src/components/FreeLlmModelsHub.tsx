"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Search,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  Bot,
  Sparkles,
  GripVertical,
  HelpCircle,
  Eye,
  Wrench,
  CheckCircle2,
} from "lucide-react";

interface ModelItem {
  id: number;
  modelId: string;
  displayName: string;
  platform: string;
  platformLabel: string;
  rank: number;
  score: string;
  reliability: number;
  speed: number;
  intelligence: number;
  contextWindow?: number;
  contextFormatted: string;
  monthlyBudget: string;
  enabled: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
}

interface FreeLlmModelsHubProps {
  initialModels?: ModelItem[];
}

export function FreeLlmModelsHub({ initialModels = [] }: FreeLlmModelsHubProps) {
  const [models, setModels] = useState<ModelItem[]>(initialModels);
  const [selectedStrategy, setSelectedStrategy] = useState("smartest");
  const [selectedCategory, setSelectedCategory] = useState("chat");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterVision, setFilterVision] = useState(false);
  const [filterTools, setFilterTools] = useState(false);
  const [filterContext, setFilterContext] = useState<"any" | "32k" | "128k" | "1m">("any");
  const [showAllBudgets, setShowAllBudgets] = useState(false);

  // Sync models when data loads
  useEffect(() => {
    if (initialModels && initialModels.length > 0) {
      setModels(initialModels);
    } else {
      fetch("/api/freellmapi")
        .then((r) => r.json())
        .then((d) => {
          if (d.models) setModels(d.models);
        })
        .catch((e) => console.error("Error loading models:", e));
    }
  }, [initialModels]);

  // Toggle model enabled status
  const toggleModel = (id: number) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m))
    );
  };

  // Strategy weighting labels
  const strategyWeights: Record<string, string> = {
    smartest: "reliability 35% · speed 10% · intelligence 55%",
    fastest: "reliability 20% · speed 70% · intelligence 10%",
    most_reliable: "reliability 70% · speed 10% · intelligence 20%",
    balanced: "reliability 33% · speed 33% · intelligence 34%",
    manual: "drag & drop custom hierarchy",
    custom: "reliability 40% · speed 30% · intelligence 30%",
  };

  // Provider colors
  const providerColors: Record<string, string> = {
    google: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    groq: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    cloudflare: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    cerebras: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    mistral: "text-red-400 bg-red-500/10 border-red-500/20",
    openrouter: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    nvidia: "text-green-400 bg-green-500/10 border-green-500/20",
    ollama: "text-zinc-300 bg-zinc-800 border-zinc-700",
  };

  // Budget models summary list
  const budgetList = [
    { name: "Gemini 2.5 Flash", tokens: "27.0M", color: "#3b82f6" },
    { name: "Codestral", tokens: "100.0M", color: "#06b6d4" },
    { name: "Gemini 2.5 Flash-Lite", tokens: "27.0M", color: "#60a5fa" },
    { name: "Llama 3.3 70B fp8-fast (CF)", tokens: "360.0M", color: "#f97316" },
    { name: "Nemotron 3 Super 120B (free)", tokens: "0", color: "#a855f7" },
    { name: "GPT-OSS 120B (Groq)", tokens: "36.0M", color: "#ef4444" },
    { name: "GPT-OSS 120B (CF)", tokens: "360.0M", color: "#eab308" },
    { name: "GLM-4.7 Flash (CF)", tokens: "360.0M", color: "#f59e0b" },
    { name: "Llama 4 Scout (CF)", tokens: "360.0M", color: "#fb923c" },
    { name: "GPT-OSS 20B (Groq)", tokens: "36.0M", color: "#dc2626" },
    { name: "Qwen3 30B-A3B fp8 (CF)", tokens: "360.0M", color: "#d97706" },
    { name: "DeepSeek R1 Distill Qwen 32B (CF)", tokens: "40.0M", color: "#c084fc" },
    { name: "Gemma 4 31B (free)", tokens: "0", color: "#ec4899" },
    { name: "Gemma 4 26B-A4B (free)", tokens: "0", color: "#f472b6" },
    { name: "Nemotron 3 Nano 30B Reasoning (free)", tokens: "0", color: "#818cf8" },
    { name: "Granite 4.0 H Micro (CF)", tokens: "80.0M", color: "#f97316" },
    { name: "GPT-OSS 120B (Ollama)", tokens: "20.0M", color: "#a1a1aa" },
    { name: "Gemma 4 31B (Ollama)", tokens: "30.0M", color: "#71717a" },
  ];

  // Filtered models
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = m.displayName.toLowerCase().includes(q);
        const matchModelId = m.modelId.toLowerCase().includes(q);
        const matchPlatform = m.platform.toLowerCase().includes(q);
        if (!matchName && !matchModelId && !matchPlatform) return false;
      }
      if (filterVision && !m.supportsVision) return false;
      if (filterTools && !m.supportsTools) return false;
      if (filterContext === "32k" && (!m.contextWindow || m.contextWindow < 32768)) return false;
      if (filterContext === "128k" && (!m.contextWindow || m.contextWindow < 131072)) return false;
      if (filterContext === "1m" && (!m.contextWindow || m.contextWindow < 1000000)) return false;
      return true;
    });
  }, [models, searchQuery, filterVision, filterTools, filterContext]);

  return (
    <div className="space-y-6">
      {/* Title & Category Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Models</h1>
          <p className="text-xs text-zinc-400 mt-1 max-w-2xl">
            Pick a routing strategy. In Manual mode you drag to set the order; the other strategies route by live score across reliability, speed and intelligence.
          </p>
        </div>

        {/* Category Pills */}
        <div className="flex items-center p-1 bg-[#121215] border border-zinc-800 rounded-lg">
          {[
            { id: "chat", label: "Chat models" },
            { id: "embeddings", label: "Embeddings" },
            { id: "image", label: "Image" },
            { id: "audio", label: "Audio" },
            { id: "fusion", label: "Fusion" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                selectedCategory === cat.id
                  ? "bg-white text-black shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Monthly Token Budget Card */}
      <div className="obsidian-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white">Monthly token budget</span>
          <span className="text-xs text-zinc-400">
            <span className="font-semibold text-zinc-200">6.4B</span> remaining · 99.95% of 6.4B · <span className="font-semibold text-zinc-200">2.7M</span> used
          </span>
        </div>

        {/* Segmented color progress bar */}
        <div className="w-full h-2 rounded-full overflow-hidden bg-zinc-800 flex gap-0.5">
          <div style={{ width: "24%", backgroundColor: "#3b82f6" }} className="h-full" title="Google Gemini 2.5" />
          <div style={{ width: "18%", backgroundColor: "#06b6d4" }} className="h-full" title="Codestral Mistral" />
          <div style={{ width: "28%", backgroundColor: "#f97316" }} className="h-full" title="Cloudflare Workers AI" />
          <div style={{ width: "12%", backgroundColor: "#ef4444" }} className="h-full" title="Groq Cloud" />
          <div style={{ width: "10%", backgroundColor: "#a855f7" }} className="h-full" title="OpenRouter" />
          <div style={{ width: "8%", backgroundColor: "#22c55e" }} className="h-full" title="Cerebras" />
        </div>

        {/* Models token list */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 pt-1 text-xs">
          {(showAllBudgets ? budgetList : budgetList.slice(0, 9)).map((b, idx) => (
            <div key={idx} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2 truncate">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                <span className="text-zinc-300 truncate">{b.name}</span>
              </div>
              <span className="font-mono text-zinc-400 shrink-0 ml-2">{b.tokens}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => setShowAllBudgets(!showAllBudgets)}
          className="flex items-center justify-center gap-1 w-full text-xs text-zinc-400 hover:text-white pt-2 border-t border-zinc-800/80 cursor-pointer transition-colors"
        >
          <span>{showAllBudgets ? "Show less" : "Show all 95 models"}</span>
          {showAllBudgets ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Routing Strategy Card */}
      <div className="obsidian-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-white">Routing strategy</h2>
          <span className="text-xs text-zinc-500 font-mono">
            {strategyWeights[selectedStrategy]}
          </span>
        </div>

        {/* Strategy Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "manual", label: "Manual" },
            { id: "balanced", label: "Balanced" },
            { id: "smartest", label: "Smartest" },
            { id: "fastest", label: "Fastest" },
            { id: "most_reliable", label: "Most reliable" },
            { id: "custom", label: "Custom" },
          ].map((strat) => (
            <button
              key={strat.id}
              onClick={() => setSelectedStrategy(strat.id)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all cursor-pointer ${
                selectedStrategy === strat.id
                  ? "bg-white text-black shadow-sm"
                  : "bg-[#141418] border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
              }`}
            >
              {strat.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400 pt-1">
          <p>Scores update from live traffic. The order below is how requests are routed right now.</p>
          <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-400 hover:text-zinc-300">
            <input type="checkbox" className="rounded bg-zinc-800 border-zinc-700 text-white focus:ring-0" />
            <span>Explore unmeasured models</span>
            <HelpCircle className="h-3 w-3 text-zinc-500" />
          </label>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search models or providers..."
            className="w-full bg-[#121215] border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFilterVision(!filterVision)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              filterVision ? "bg-white text-black" : "bg-[#141418] border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Vision</span>
          </button>

          <button
            onClick={() => setFilterTools(!filterTools)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              filterTools ? "bg-white text-black" : "bg-[#141418] border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            <Wrench className="h-3.5 w-3.5" />
            <span>Tools</span>
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1 hidden sm:block" />

          {(["any", "32k", "128k", "1m"] as const).map((ctx) => (
            <button
              key={ctx}
              onClick={() => setFilterContext(ctx)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                filterContext === ctx
                  ? "bg-white text-black"
                  : "bg-[#141418] border border-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {ctx === "any" ? "Any context" : ctx === "32k" ? "32K+" : ctx === "128k" ? "128K+" : "1M+"}
            </button>
          ))}
        </div>
      </div>

      {/* Models Table with Live Meters */}
      <div className="obsidian-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0e0e11] border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="py-3 px-3 w-10 text-center font-normal">#</th>
                <th className="py-3 px-4 font-normal">Model</th>
                <th className="py-3 px-4 w-36 font-normal">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span>Reliability</span>
                  </span>
                </th>
                <th className="py-3 px-4 w-36 font-normal">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-400" />
                    <span>Speed</span>
                  </span>
                </th>
                <th className="py-3 px-4 w-36 font-normal">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-purple-400" />
                    <span>Intelligence</span>
                  </span>
                </th>
                <th className="py-3 px-3 w-20 font-normal">Guardrails</th>
                <th className="py-3 px-4 w-20 text-right font-normal">Score</th>
                <th className="py-3 px-4 w-16 text-center font-normal">On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredModels.slice(0, 40).map((m, idx) => {
                const colorClass = providerColors[m.platform] || "text-zinc-400 bg-zinc-800 border-zinc-700";
                return (
                  <tr
                    key={m.id}
                    className="hover:bg-zinc-900/40 transition-colors group"
                  >
                    {/* Rank / Handle */}
                    <td className="py-3 px-3 text-center text-zinc-500 font-mono">
                      <div className="flex items-center justify-center gap-1">
                        <GripVertical className="h-3.5 w-3.5 text-zinc-700 group-hover:text-zinc-400 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span>{idx + 1}</span>
                      </div>
                    </td>

                    {/* Model Info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center flex-wrap gap-2">
                        <span className="font-semibold text-white tracking-tight">{m.displayName}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${colorClass}`}>
                          {m.platform}
                        </span>
                        {m.monthlyBudget && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                            {m.monthlyBudget}
                          </span>
                        )}
                        {m.contextFormatted && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                            {m.contextFormatted}
                          </span>
                        )}
                        {m.supportsVision && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/40 text-cyan-300">
                            Vision
                          </span>
                        )}
                        {m.supportsTools && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-950/40 border border-violet-800/40 text-violet-300">
                            Tools
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Reliability Meter */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${m.reliability}%` }}
                          />
                        </div>
                        <span className="font-mono text-zinc-300 w-6 text-right">{m.reliability}</span>
                      </div>
                    </td>

                    {/* Speed Meter */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${m.speed}%` }}
                          />
                        </div>
                        <span className="font-mono text-zinc-300 w-6 text-right">{m.speed}</span>
                      </div>
                    </td>

                    {/* Intelligence Meter */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div
                            className="h-full bg-purple-500 rounded-full"
                            style={{ width: `${m.intelligence}%` }}
                          />
                        </div>
                        <span className="font-mono text-zinc-300 w-6 text-right">{m.intelligence}</span>
                      </div>
                    </td>

                    {/* Guardrails */}
                    <td className="py-3 px-3 text-zinc-500 text-center font-mono">—</td>

                    {/* Score */}
                    <td className="py-3 px-4 text-right font-mono font-bold text-white">
                      {m.score}
                    </td>

                    {/* Switch Toggle */}
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => toggleModel(m.id)}
                        className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer inline-flex items-center ${
                          m.enabled ? "bg-white" : "bg-zinc-800"
                        }`}
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-full transition-transform transform ${
                            m.enabled ? "translate-x-4 bg-black" : "translate-x-1 bg-zinc-500"
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
