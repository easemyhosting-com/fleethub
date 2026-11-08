"use client";

import { useState } from "react";
import {
  Activity,
  Clock,
  ArrowDown,
  ArrowUp,
  Gauge,
  Zap,
  DollarSign,
  TrendingUp,
  Link as LinkIcon,
} from "lucide-react";

export function FreeLlmAnalyticsView() {
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "30d" | "90d">("90d");
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(3); // Default hover on 2026-10-22

  const timeData = [
    { date: "2026-09-22", success: 14, failures: 0, tokens: "420K" },
    { date: "2026-10-01", success: 52, failures: 1, tokens: "1.1M" },
    { date: "2026-10-21", success: 118, failures: 4, tokens: "2.1M" },
    { date: "2026-10-22", success: 27, failures: 1, tokens: "2.4M" },
    { date: "2026-10-23", success: 22, failures: 0, tokens: "2.7M" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Request volume, latency, token usage, and failures.
          </p>
        </div>

        {/* Time range switcher */}
        <div className="flex items-center p-1 bg-[#121215] border border-zinc-800 rounded-lg">
          {(["24h", "7d", "30d", "90d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                timeRange === r
                  ? "bg-white text-black shadow-sm font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* 8 Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Requests */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">REQUESTS</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <Activity className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">206</div>
        </div>

        {/* Success Rate */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">SUCCESS RATE</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <Clock className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">93.7%</div>
        </div>

        {/* Input Tokens */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">INPUT TOKENS</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <ArrowDown className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">2.7M</div>
        </div>

        {/* Output Tokens */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">OUTPUT TOKENS</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <ArrowUp className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">34.7K</div>
        </div>

        {/* Avg Latency */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">AVG LATENCY</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <Gauge className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">5130 ms</div>
        </div>

        {/* P95 Latency */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">P95 LATENCY</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <Clock className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">22064 ms</div>
        </div>

        {/* Avg TTFT */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">AVG TTFT</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <Zap className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">8495 ms</div>
        </div>

        {/* Est. Savings */}
        <div className="obsidian-card p-5 space-y-3">
          <div className="flex items-center justify-between text-zinc-500 text-xs">
            <span className="font-semibold tracking-wider">EST. SAVINGS</span>
            <div className="p-1 rounded bg-zinc-800/60 text-zinc-400">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="text-3xl font-bold text-white tracking-tight">$0.51</div>
        </div>
      </div>

      {/* Chart 1: Requests over time */}
      <div className="obsidian-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-white">Requests over time</h3>
        </div>

        {/* SVG Spline Chart */}
        <div className="relative h-64 w-full bg-[#0c0c0e] border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between overflow-hidden">
          {/* Subtle grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none opacity-20">
            <div className="border-b border-dashed border-zinc-700 w-full" />
            <div className="border-b border-dashed border-zinc-700 w-full" />
            <div className="border-b border-dashed border-zinc-700 w-full" />
            <div className="border-b border-dashed border-zinc-700 w-full" />
          </div>

          {/* SVG Curves */}
          <svg className="absolute inset-0 h-full w-full p-4 overflow-visible" preserveAspectRatio="none" viewBox="0 0 500 150">
            {/* Success Curve (white line) */}
            <path
              d="M 20 130 Q 150 120 250 20 T 480 125"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
            />
            {/* Failures Curve (red line) */}
            <path
              d="M 20 145 Q 150 140 250 135 T 480 145"
              fill="none"
              stroke="#ef4444"
              strokeWidth="1.8"
            />

            {/* Highlighted point at 2026-10-22 */}
            <line x1="380" y1="0" x2="380" y2="150" stroke="#52525b" strokeDasharray="3 3" strokeWidth="1" />
            <circle cx="380" cy="98" r="4" fill="#ffffff" stroke="#09090b" strokeWidth="2" />
            <circle cx="380" cy="142" r="4" fill="#ef4444" stroke="#09090b" strokeWidth="2" />
          </svg>

          {/* Tooltip Card Overlay */}
          <div
            className="absolute top-8 right-32 bg-[#18181b] border border-zinc-700 rounded-lg p-2.5 shadow-xl text-[11px] font-mono pointer-events-none z-10 space-y-1"
          >
            <div className="text-zinc-400 font-sans border-b border-zinc-750 pb-1 font-medium">2026-10-22</div>
            <div className="text-red-400">Failures : 1</div>
            <div className="text-zinc-200">Success : 27</div>
          </div>

          {/* X Axis Labels */}
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 pt-52 relative z-0">
            <span>2026-09-22</span>
            <span>2026-10-01</span>
            <span>2026-10-21</span>
            <span>2026-10-22</span>
            <span>2026-10-23</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 text-xs text-zinc-400 pt-1">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-6 bg-red-500 rounded-full" />
            <span>Failures</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-6 bg-white rounded-full" />
            <span>Success</span>
          </div>
        </div>
      </div>

      {/* Chart 2: Tokens over time */}
      <div className="obsidian-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-zinc-400" />
          <h3 className="text-sm font-semibold text-white">Tokens over time</h3>
        </div>

        <div className="relative h-56 w-full bg-[#0c0c0e] border border-zinc-800/80 rounded-xl p-4 flex flex-col justify-between overflow-hidden">
          {/* SVG Glowing Curve */}
          <svg className="absolute inset-0 h-full w-full p-4 overflow-visible" preserveAspectRatio="none" viewBox="0 0 500 120">
            <defs>
              <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path
              d="M 20 110 Q 150 100 250 60 T 480 15 L 480 120 L 20 120 Z"
              fill="url(#tokenGradient)"
            />
            <path
              d="M 20 110 Q 150 100 250 60 T 480 15"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2.5"
            />
          </svg>

          {/* Y Axis scale markers */}
          <div className="absolute left-4 top-4 bottom-8 flex flex-col justify-between text-[10px] font-mono text-zinc-600 pointer-events-none">
            <span>2.7M</span>
            <span>1.8M</span>
            <span>900K</span>
            <span>0</span>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 pt-44 pl-10 relative z-0">
            <span>2026-09-22</span>
            <span>2026-10-01</span>
            <span>2026-10-21</span>
            <span>2026-10-22</span>
            <span>2026-10-23</span>
          </div>
        </div>
      </div>
    </div>
  );
}
