"use client";

import { FleetAccountFacts } from "./FleetAccountFacts";
import type { FleetAccount } from "@/lib/inventory/model";
import { selectIdentityAccounts, selectIdentityGraph, type FleetMatches } from "@/lib/identity/fleet-selection";
import { filterToParams, type FleetFilter } from "@/lib/fleet/filters";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Server,
  HardDrive,
  Database,
  Cpu,
  Lock,
  Bot,
  Zap,
  Search,
  Filter,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  User,
  Mail,
  Phone,
  Eye,
  EyeOff,
  Building2,
  ListTree,
  Network,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Key,
  X,
  ExternalLink,
} from "lucide-react";
import type {
  IdentityWithAccounts,
  IdentityGraphResponse,
  GraphNode,
  GraphEdge,
  ProviderAccountDetail,
  IdentityContact,
  LinkedResource,
  LinkedQuotaMeter,
} from "@/lib/identity/types";
import { maskPhoneNumber } from "@/lib/identity/types";
import { IdentityTiersView } from "./IdentityTiersView";

interface IdentityAccountsViewProps {
  onRefreshParent?: () => void;
  filter?: FleetFilter;
  matches?: FleetMatches;
  fleetAccounts?: FleetAccount[];
  onSelectResource?: (id: string) => boolean;
}

export function IdentityAccountsView({ onRefreshParent, filter, matches, fleetAccounts, onSelectResource }: IdentityAccountsViewProps) {
  const filterQuery = filterToParams(filter ?? {}).toString();
  // Data state
  const [loadedIdentities, setIdentities] = useState<IdentityWithAccounts[]>([]);
  const [loadedGraph, setGraphData] = useState<IdentityGraphResponse | null>(null);
  const identities = useMemo(() => matches ? selectIdentityAccounts(loadedIdentities, matches) : loadedIdentities, [loadedIdentities, matches]);
  const graphData = useMemo(() => matches && loadedGraph ? selectIdentityGraph(loadedGraph, matches) : loadedGraph, [loadedGraph, matches]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [revealedPhones, setRevealedPhones] = useState<Set<string>>(new Set());

  // View mode: 'graph' or 'tree'
  const [viewMode, setViewMode] = useState<"tiers" | "graph" | "tree">("graph");
  const [vertical, setVertical] = useState(false);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [protectionFilter, setProtectionFilter] = useState("all");
  const [resourceFilter, setResourceFilter] = useState("all");

  // Selection state for Drawer
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<ProviderAccountDetail | null>(null);
  const fleetAccount = fleetAccounts?.find(account => account.id === selectedAccount?.id);

  // Expand / Collapse state for tree branches
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // Canvas Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  // Modal states for adding contact & linking account
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [isLinkAccountOpen, setIsLinkAccountOpen] = useState(false);
  const [targetIdentityId, setTargetIdentityId] = useState<string>("");

  const [refreshVersion, setRefreshVersion] = useState(0);
  const loadData = useCallback(() => setRefreshVersion(version => version + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/identities?${filterQuery}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Identity request failed");
      const json = await response.json();
      if (!controller.signal.aborted) setIdentities(json.identities || []);
    }).catch(error => {
      if (!controller.signal.aborted) console.error("Failed to load identities:", error);
    });
    return () => controller.abort();
  }, [refreshVersion, filterQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsRefreshing(true);
      try {
        const params = new URLSearchParams(filterQuery);
        params.set("graph", "true");
        if (searchQuery) params.set("search", searchQuery);
        if (healthFilter !== "all") params.set("health", healthFilter);
        if (protectionFilter !== "all") params.set("protection", protectionFilter);
        if (resourceFilter !== "all") params.set("category", resourceFilter);
        const response = await fetch(`/api/identities?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Graph request failed");
        const json = await response.json();
        if (!controller.signal.aborted) setGraphData(json.graph);
      } catch (error) {
        if (!controller.signal.aborted) console.error("Failed to load identities graph:", error);
      } finally {
        if (!controller.signal.aborted) {
          setIsRefreshing(false);
          setIsLoading(false);
        }
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, healthFilter, protectionFilter, resourceFilter, refreshVersion, filterQuery]);

  // Phone number reveal toggle
  const togglePhoneReveal = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRevealedPhones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Branch collapse toggle
  const toggleNodeCollapse = (nodeId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Pan & Zoom handlers
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, Number((z - 0.15).toFixed(2))));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 40, y: 40 });
  };
  const fitGraph = (selection?: string) => {
    const viewport = canvasRef.current;
    if (!viewport) return;
    const nodes = layout.nodesWithPos.filter(node => node.visible && (!selection || node.id === selection));
    if (!nodes.length) return;
    let left = Infinity, top = Infinity, right = 0, bottom = 0;
    for (const node of nodes) {
      left = Math.min(left, node.x);
      top = Math.min(top, node.y);
      right = Math.max(right, node.x + 288);
      bottom = Math.max(bottom, node.y + 160);
    }
    const scale = Math.min(1, (viewport.clientWidth - 40) / (right - left), (viewport.clientHeight - 80) / (bottom - top));
    setZoom(scale);
    setPan({ x: 20 - left * scale, y: 60 - top * scale });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with primary mouse button
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      setZoom(value => Math.min(2.2, Math.max(0.35, Number((value * factor).toFixed(2)))));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [viewMode, isLoading, graphData]);

  // Node selection for detail drawer
  const handleSelectNode = (node: GraphNode) => {
    if (node.type === "resource" && typeof node.data.resourceId === "string" && onSelectResource?.(node.data.resourceId)) {
      setSelectedNode(null);
      return;
    }
    setSelectedNode(node);
    if (node.type === "account") {
      const found = loadedIdentities
        .flatMap((i) => i.accounts)
        .find((a) => a.id === node.data.accountId);
      setSelectedAccount(found || null);
    } else if (node.type === "identity") {
      setSelectedAccount(null);
    }
  };

  // Calculate layout coordinates for hierarchical graph:
  // Column 0: Identities (x = 40)
  // Column 1: Providers (x = 340)
  // Column 2: Accounts (x = 640)
  // Column 3: Resources & Quotas (x = 940)
  const layout = useMemo(() => {
    if (!graphData) return { nodesWithPos: [], edgesWithPos: [], width: 1200, height: 800 };

    const nodesWithPos: Array<GraphNode & { x: number; y: number; visible: boolean }> = [];
    const idToPos = new Map<string, { x: number; y: number; visible: boolean }>();

    // Step 1: Identify collapsed ancestors
    const isAncestorCollapsed = (nodeId: string, parentId?: string): boolean => {
      if (!parentId) return false;
      if (collapsedNodes.has(parentId)) return true;
      const parentNode = graphData.nodes.find((n) => n.id === parentId);
      return parentNode ? isAncestorCollapsed(parentNode.id, parentNode.parentId) : false;
    };

    let currentY = 40;
    const NODE_GAP_Y = 110;
    const TIER_X = {
      identity: 40,
      email: 330,
      provider: 620,
      account: 910,
      resource: 1230,
      quota: 1230,
      secret_ref: 1230,
    };

    // Group nodes hierarchically by identity
    const identityNodes = graphData.nodes.filter((node) => node.type === "identity");
    const childrenByParent = new Map<string, GraphNode[]>();
    for (const node of graphData.nodes) {
      if (!node.parentId) continue;
      const children = childrenByParent.get(node.parentId);
      if (children) children.push(node);
      else childrenByParent.set(node.parentId, [node]);
    }

    for (const ident of identityNodes) {
      const identVisible = true;
      const identY = currentY;

      nodesWithPos.push({
        ...ident,
        x: TIER_X.identity,
        y: identY,
        visible: identVisible,
      });
      idToPos.set(ident.id, { x: TIER_X.identity, y: identY, visible: identVisible });

      const emailNodes = (childrenByParent.get(ident.id) ?? []).filter(node => node.type === "email");
      let providerStartY = identY;

      for (const mail of emailNodes) {
      const mailVisible = !collapsedNodes.has(ident.id);
      const mailY = providerStartY;
      nodesWithPos.push({ ...mail, x: TIER_X.email, y: mailY, visible: mailVisible });
      idToPos.set(mail.id, { x: TIER_X.email, y: mailY, visible: mailVisible });
      const providerNodes = (childrenByParent.get(mail.id) ?? []).filter(node => node.type === "provider");

      for (const prov of providerNodes) {
        const provVisible = mailVisible && !collapsedNodes.has(mail.id);
        const provY = providerStartY;

        nodesWithPos.push({
          ...prov,
          x: TIER_X.provider,
          y: provY,
          visible: provVisible,
        });
        idToPos.set(prov.id, { x: TIER_X.provider, y: provY, visible: provVisible });

        const accountNodes = (childrenByParent.get(prov.id) ?? []).filter(node => node.type === "account");

        let accountStartY = provY;

        for (const acc of accountNodes) {
          const accVisible = provVisible && !collapsedNodes.has(prov.id);
          const accY = accountStartY;

          nodesWithPos.push({
            ...acc,
            x: TIER_X.account,
            y: accY,
            visible: accVisible,
          });
          idToPos.set(acc.id, { x: TIER_X.account, y: accY, visible: accVisible });

          const descendantNodes = (childrenByParent.get(acc.id) ?? []).filter(
            node => node.type === "resource" || node.type === "quota" || node.type === "secret_ref"
          );

          let descStartY = accY;
          for (const desc of descendantNodes) {
            const descVisible = accVisible && !collapsedNodes.has(acc.id);
            nodesWithPos.push({
              ...desc,
              x: TIER_X[desc.type] || 970,
              y: descStartY,
              visible: descVisible,
            });
            idToPos.set(desc.id, { x: TIER_X[desc.type] || 970, y: descStartY, visible: descVisible });
            if (descVisible) descStartY += 80;
          }

          const accSpan = Math.max(NODE_GAP_Y, descStartY - accY);
          accountStartY += accSpan;
        }

        const provSpan = Math.max(NODE_GAP_Y, accountStartY - provY);
        providerStartY += provSpan;
      }
      providerStartY = Math.max(providerStartY, mailY + NODE_GAP_Y);
      }

      const identSpan = Math.max(NODE_GAP_Y + 40, providerStartY - identY);
      currentY += identSpan;
    }

    const maxY = Math.max(currentY + 100, 700);

    // Vertical layout: tiers become rows and siblings spread across the page.
    const levelOf: Record<string, number> = { identity: 0, email: 1, provider: 2, account: 3 };
    let vMaxX = 0;
    if (vertical) {
      for (const n of nodesWithPos) {
        n.x = 40 + n.y * 2.6;
        n.y = 40 + (levelOf[n.type] ?? 4) * 170;
        idToPos.set(n.id, { x: n.x, y: n.y, visible: n.visible });
        vMaxX = Math.max(vMaxX, n.x + 300);
      }
    }

    // Compute visible edges
    const edgesWithPos: Array<
      GraphEdge & { x1: number; y1: number; x2: number; y2: number; visible: boolean }
    > = [];

    for (const edge of graphData.edges) {
      const src = idToPos.get(edge.source);
      const tgt = idToPos.get(edge.target);
      if (src && tgt) {
        const visible = src.visible && tgt.visible;
        edgesWithPos.push({
          ...edge,
          x1: vertical ? src.x + 128 : src.x + 240, // right edge (or bottom centre when vertical) of source node box
          y1: vertical ? src.y + 90 : src.y + 45,
          x2: vertical ? tgt.x + 128 : tgt.x, // left edge (or top centre when vertical) of target node box
          y2: vertical ? tgt.y : tgt.y + 45,
          visible,
        });
      }
    }

    return {
      nodesWithPos,
      edgesWithPos,
      width: vertical ? Math.max(1400, vMaxX) : 1400,
      height: vertical ? 40 + 5 * 170 + 120 : maxY,
    };
  }, [graphData, collapsedNodes, vertical]);

  return (
    <div className="space-y-6">
      {/* Top Header & Summary Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60 p-5 rounded-xl border border-zinc-800/80 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-white flex flex-wrap items-center gap-2">
                Identity & Accounts Relationship Engine
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Authoritative Policy
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Audit provider accounts linked to each identity across Oracle, Cloudflare, NVIDIA, Google, and Upstash.
              </p>
            </div>
          </div>
        </div>

        {/* Summary Metric Counters */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-zinc-400">Identities:</span>
            <span className="font-semibold text-white">{graphData?.summary.totalIdentities ?? 0}</span>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-indigo-400" />
            <span className="text-zinc-400">Providers:</span>
            <span className="font-semibold text-white">{graphData?.summary.totalProviders ?? 0}</span>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/60 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-sky-400" />
            <span className="text-zinc-400">Accounts:</span>
            <span className="font-semibold text-white">{graphData?.summary.totalAccounts ?? 0}</span>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-medium">Protected:</span>
            <span className="font-semibold text-emerald-300">{graphData?.summary.protectedAccounts ?? 0}</span>
          </div>

          <button
            onClick={() => loadData()}
            disabled={isRefreshing}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh Identity Graph"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Control Bar: Search, Filters & View Toggle */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/60">
        {/* Search Input */}
        <div className="md:col-span-4 relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
          <input
            id="identity-search-input"
            aria-label="Search identity graph"
            type="search"
            placeholder="Search email, mobile, account ID, or label..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500/50"
          />
        </div>

        {/* Protection Filter */}
        <div className="md:col-span-2">
          <select
            value={protectionFilter}
            onChange={(e) => setProtectionFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="all">All Protection Status</option>
            <option value="protected">Protected Only</option>
            <option value="unprotected">Unprotected Only</option>
          </select>
        </div>

        {/* Health Filter */}
        <div className="md:col-span-2">
          <select
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="all">All Health</option>
            <option value="ok">Healthy (OK)</option>
            <option value="degraded">Degraded</option>
            <option value="error">Error</option>
          </select>
        </div>

        {/* View Toggle Button: Graph vs Tree */}
        <div className="md:col-span-4 flex items-center justify-start md:justify-end gap-1.5">
          <div className="inline-flex max-w-full flex-wrap rounded-lg bg-zinc-950 border border-zinc-800 p-0.5">
            {viewMode === "graph" && (
              <button onClick={() => setVertical(value => !value)} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-300 hover:text-white cursor-pointer" title="Rotate the graph between horizontal and vertical">
                <RotateCcw className="h-3.5 w-3.5" />
                <span>{vertical ? "Horizontal" : "Vertical"}</span>
              </button>
            )}
            <button
              onClick={() => setViewMode("tiers")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${viewMode === "tiers" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"}`}
              title="Person, email, provider, usage"
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Tiers</span>
            </button>
            <button
              onClick={() => setViewMode("graph")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                viewMode === "graph"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Interactive Visual Graph"
            >
              <Network className="h-3.5 w-3.5" />
              <span>Graph</span>
            </button>
            <button
              onClick={() => setViewMode("tree")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                viewMode === "tree"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title="Accessible Keyboard-Navigable Tree Alternative"
            >
              <ListTree className="h-3.5 w-3.5" />
              <span>Tree View</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "tiers" ? <IdentityTiersView identities={identities} /> : viewMode === "graph" ? (
        /* INTERACTIVE GRAPH CANVAS */
        <div className="relative w-full h-[680px] bg-zinc-950/80 rounded-xl border border-zinc-800 overflow-hidden select-none">
          {/* Canvas Floating Navigation & Zoom Controls */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 bg-zinc-900/90 backdrop-blur-md p-1.5 rounded-lg border border-zinc-800 shadow-xl">
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <div className="w-[1px] h-4 bg-zinc-700 mx-1" />
            <button
              onClick={() => fitGraph()}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Fit to View"
              aria-label="Fit graph to view"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            {selectedNode && <button
              type="button"
              onClick={() => fitGraph(selectedNode.id)}
              className="rounded px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >Fit selection</button>}
            <button
              onClick={handleResetZoom}
              className="p-1.5 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title="Reset Zoom (100%)"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <span className="text-[11px] font-mono text-zinc-400 px-2 py-0.5">
              {Math.round(zoom * 100)}%
            </span>
          </div>

          {/* Minimap Orientation Aid in Bottom-Right */}
          <div className="absolute bottom-4 right-4 z-20 w-48 h-32 bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-lg shadow-2xl p-2 hidden sm:block pointer-events-none">
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mb-1 border-b border-zinc-800/80 pb-1">
              <span>Graph Overview</span>
              <span>Minimap</span>
            </div>
            <div className="relative w-full h-[88px] bg-zinc-950/90 rounded border border-zinc-800/50 overflow-hidden">
              {/* Mini dots for nodes */}
              {layout.nodesWithPos.map((n) => (
                <div
                  key={`mini-${n.id}`}
                  className={`absolute rounded-full ${
                    n.type === "identity"
                      ? "bg-indigo-400 w-1.5 h-1.5"
                      : n.type === "provider"
                      ? "bg-sky-400 w-1.5 h-1.5"
                      : n.isProtected
                      ? "bg-emerald-400 w-1.5 h-1.5"
                      : "bg-zinc-500 w-1 h-1"
                  }`}
                  style={{
                    left: `${Math.min(94, Math.max(2, (n.x / layout.width) * 100))}%`,
                    top: `${Math.min(90, Math.max(4, (n.y / layout.height) * 100))}%`,
                  }}
                />
              ))}

              {/* Viewport indicator box */}
              <div
                className="absolute border border-emerald-400/60 bg-emerald-400/10 rounded-sm"
                style={{
                  left: `${Math.max(0, Math.min(80, (-pan.x / (layout.width * zoom)) * 100))}%`,
                  top: `${Math.max(0, Math.min(75, (-pan.y / (layout.height * zoom)) * 100))}%`,
                  width: `${Math.min(100, (600 / (layout.width * zoom)) * 100)}%`,
                  height: `${Math.min(100, (400 / (layout.height * zoom)) * 100)}%`,
                }}
              />
            </div>
          </div>

          {/* Draggable & Pannable Interactive Canvas Layer */}
          <div
            ref={canvasRef}
            tabIndex={0}
            role="region"
            aria-label="Identity graph. Use arrow keys to pan."
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return;
              const offsets = {
                ArrowLeft: { x: 80, y: 0 }, ArrowRight: { x: -80, y: 0 },
                ArrowUp: { x: 0, y: 80 }, ArrowDown: { x: 0, y: -80 },
              };
              const offset = Object.entries(offsets).find(([key]) => key === event.key)?.[1];
              if (!offset) return;
              event.preventDefault();
              setPan(current => ({ x: current.x + offset.x, y: current.y + offset.y }));
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`w-full h-full cursor-grab active:cursor-grabbing overflow-hidden ${
              isDragging ? "cursor-grabbing" : ""
            }`}
          >
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
                width: layout.width,
                height: layout.height,
                position: "relative",
                transition: isDragging ? "none" : "transform 0.08s ease-out",
              }}
            >
              {/* SVG Edges Layer */}
              <svg
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{ width: layout.width, height: layout.height }}
              >
                <defs>
                  <marker
                    id="arrow-green"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" opacity="0.6" />
                  </marker>
                  <marker
                    id="arrow-zinc"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 8 5 L 0 9 z" fill="#52525b" opacity="0.4" />
                  </marker>
                </defs>

                {layout.edgesWithPos
                  .filter((e) => e.visible)
                  .map((edge) => {
                    // Smooth bezier curve between tiers
                    const midX = (edge.x1 + edge.x2) / 2;
                    const midY = (edge.y1 + edge.y2) / 2;
                    const pathD = vertical
                      ? `M ${edge.x1} ${edge.y1} C ${edge.x1} ${midY}, ${edge.x2} ${midY}, ${edge.x2} ${edge.y2}`
                      : `M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`;

                    return (
                      <g key={edge.id}>
                        <path
                          d={pathD}
                          fill="none"
                          stroke="#27272a"
                          strokeWidth="2"
                          strokeDasharray="4 3"
                        />
                        <path
                          d={pathD}
                          fill="none"
                          stroke="#3f3f46"
                          strokeWidth="1.5"
                          opacity="0.8"
                        />
                      </g>
                    );
                  })}
              </svg>

              {/* Rendered Graph Nodes */}
              {layout.nodesWithPos
                .filter((n) => n.visible)
                .map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const isCollapsed = collapsedNodes.has(node.id);

                  if (node.type === "identity") {
                    const contacts = (node.data.contacts as IdentityContact[]) || [];
                    const emailContacts = contacts.filter((c) => c.kind === "email");
                    const phoneContact = contacts.find((c) => c.kind === "phone");

                    return (
                      <div
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className={`absolute w-72 p-4 rounded-xl border bg-zinc-900/95 backdrop-blur-md shadow-xl transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-400 ring-2 ring-emerald-400/20"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              <User className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div title={node.label} className="truncate text-sm font-semibold text-white tracking-tight">
                                {node.label}
                              </div>
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                Identity ID: {node.data.identityId as string}
                              </span>
                            </div>
                          </div>

                          {/* Branch Collapse Button */}
                          <button
                            onClick={(e) => toggleNodeCollapse(node.id, e)}
                            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                            title={isCollapsed ? "Expand Providers" : "Collapse Providers"}
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </div>

                        {/* Contacts Section */}
                        <div className="mt-3 space-y-1.5 text-xs border-t border-zinc-800/80 pt-2.5">
                          {emailContacts.map((c) => (
                            <div key={c.id} className="flex items-center justify-between text-zinc-300">
                              <div className="flex items-center gap-1.5 truncate">
                                <Mail className="h-3 w-3 text-zinc-500 shrink-0" />
                                <span className="truncate">{c.value}</span>
                              </div>
                              {c.isVerified ? (
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                                  verified
                                </span>
                              ) : (
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-950/60 text-amber-400 border border-amber-500/30">
                                  unverified
                                </span>
                              )}
                            </div>
                          ))}

                          {/* Mobile Phone Contact (Honest labeling; Masked with Reveal Control) */}
                          <div className="flex items-center justify-between text-zinc-300 pt-1">
                            <div className="flex items-center gap-1.5 truncate">
                              <Phone className="h-3 w-3 text-zinc-500 shrink-0" />
                              {phoneContact ? (
                                <span className="font-mono text-[11px]">
                                  {revealedPhones.has(node.id)
                                    ? phoneContact.value
                                    : maskPhoneNumber(phoneContact.value)}
                                </span>
                              ) : (
                                <span className="text-zinc-500 italic text-[11px]">No mobile on file</span>
                              )}
                            </div>

                            {phoneContact && (
                              <button
                                onClick={(e) => togglePhoneReveal(node.id, e)}
                                className="p-0.5 text-zinc-400 hover:text-white transition-colors"
                                title={revealedPhones.has(node.id) ? "Mask Phone Number" : "Reveal Phone Number"}
                              >
                                {revealedPhones.has(node.id) ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Collapsed Pill Indicator */}
                        {isCollapsed && (
                          <div className="mt-2.5 px-2 py-1 rounded bg-zinc-800 text-[11px] font-mono text-emerald-400 flex items-center justify-between">
                            <span>Branches Collapsed</span>
                            <span>{node.childCount} providers</span>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (node.type === "email") {
                    return (
                      <div key={node.id} onClick={() => handleSelectNode(node)} className="absolute w-64 p-3.5 rounded-xl border border-violet-500/40 bg-zinc-900/90 shadow-lg cursor-pointer" style={{ left: node.x, top: node.y }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="p-1.5 rounded-lg bg-violet-500/10 text-violet-300 border border-violet-500/20"><Mail className="h-4 w-4" /></div>
                            <div className="min-w-0"><div className="text-xs font-semibold text-white truncate">{node.label}</div><span className="text-[10px] text-zinc-400">{node.subLabel}</span></div>
                          </div>
                          <button onClick={(e) => toggleNodeCollapse(node.id, e)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white">{isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
                        </div>
                      </div>
                    );
                  }

                  if (node.type === "provider") {
                    return (
                      <div
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className={`absolute w-64 p-3.5 rounded-xl border bg-zinc-900/90 backdrop-blur-md shadow-lg transition-all cursor-pointer ${
                          isSelected
                            ? "border-sky-400 ring-2 ring-sky-400/20"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                              <Building2 className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-white truncate">{node.label}</div>
                              <span className="text-[10px] text-zinc-400">{node.subLabel}</span>
                            </div>
                          </div>

                          <button
                            onClick={(e) => toggleNodeCollapse(node.id, e)}
                            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5 text-sky-400" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        {isCollapsed && (
                          <div className="mt-2 px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-sky-400 flex items-center justify-between">
                            <span>Accounts Grouped</span>
                            <span>+{node.childCount}</span>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (node.type === "account") {
                    const isProtected = node.isProtected;

                    return (
                      <div
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className={`absolute w-72 p-3.5 rounded-xl border bg-zinc-900/95 backdrop-blur-md shadow-xl transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-400 ring-2 ring-emerald-400/20"
                            : isProtected
                            ? "border-emerald-900/50 hover:border-emerald-700/60"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-xs font-semibold text-white truncate max-w-[200px]">
                              {node.label}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-400 truncate">
                              login: {node.subLabel}
                            </div>
                          </div>

                          <button
                            onClick={(e) => toggleNodeCollapse(node.id, e)}
                            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono">
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            role: {node.role}
                          </span>

                          {/* Clear Visual Protected Badge */}
                          {isProtected ? (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 font-semibold shadow-sm shadow-emerald-500/20">
                              <ShieldCheck className="h-3 w-3" />
                              PROTECTED
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              Eligible Target
                            </span>
                          )}
                        </div>

                        {isCollapsed && (
                          <div className="mt-2 px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center justify-between">
                            <span>Resources & Quotas</span>
                            <span>+{node.childCount} items</span>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (node.type === "resource") {
                    return (
                      <button
                        type="button"
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className={`absolute w-64 p-2.5 rounded-lg border bg-zinc-900/90 text-left text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                          isSelected
                            ? "border-emerald-400 ring-1 ring-emerald-400"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <Server className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <span className="font-medium text-white truncate">{node.label}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between text-[10px] text-zinc-400">
                          <span>{node.subLabel}</span>
                          {node.isProtected && (
                            <span className="text-emerald-400 font-mono text-[9px]">shielded</span>
                          )}
                        </span>
                      </button>
                    );
                  }

                  if (node.type === "quota") {
                    return (
                      <div
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className={`absolute w-64 p-2.5 rounded-lg border bg-zinc-900/90 text-xs transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-400 ring-1 ring-emerald-400"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="font-medium text-white truncate">{node.label}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-400 truncate">
                          {node.subLabel}
                        </div>
                        {(() => {
                          const used = node.data.usedPct as number | null | undefined;
                          const bar = used == null ? "bg-zinc-700" : used >= 100 ? "bg-fuchsia-600" : used >= 90 ? "bg-red-500" : used >= 80 ? "bg-orange-500" : used >= 50 ? "bg-yellow-400" : used > 0 ? "bg-emerald-500" : "bg-zinc-600";
                          return <div className="mt-1.5 flex items-center gap-2" title="Usage"><div className="h-2 flex-1 overflow-hidden rounded bg-zinc-800"><div className={`h-full ${bar}`} style={{ width: `${used ?? 0}%` }} /></div><span className="text-[10px] text-zinc-400">{used == null ? "n/a" : `${used}%`}</span></div>;
                        })()}
                      </div>
                    );
                  }

                  if (node.type === "secret_ref") {
                    return (
                      <div
                        key={node.id}
                        onClick={() => handleSelectNode(node)}
                        className={`absolute w-64 p-2.5 rounded-lg border bg-zinc-900/90 text-xs transition-all cursor-pointer ${
                          isSelected
                            ? "border-emerald-400 ring-1 ring-emerald-400"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Key className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                          <span className="font-medium text-white truncate">{node.label}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-400 truncate">
                          {node.subLabel}
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
            </div>
          </div>
        </div>
      ) : (
        /* ACCESSIBLE TREE & INVENTORY VIEW ALTERNATIVE */
        <div
          role="tree"
          aria-label="Identity and Provider Accounts Inventory Hierarchy"
          className="space-y-4"
        >
          {identities.map((identity) => {
            const isIdentCollapsed = collapsedNodes.has(`node-ident-${identity.id}`);

            return (
              <div
                key={identity.id}
                role="treeitem"
                aria-expanded={!isIdentCollapsed}
                className="bg-zinc-900/60 rounded-xl border border-zinc-800/80 overflow-hidden"
              >
                {/* Identity Header Row */}
                <div
                  onClick={() => toggleNodeCollapse(`node-ident-${identity.id}`)}
                  className="p-4 flex items-center justify-between bg-zinc-900/90 cursor-pointer hover:bg-zinc-850 transition-colors border-b border-zinc-800/50"
                >
                  <div className="flex items-center gap-3">
                    <button className="text-zinc-400 hover:text-white">
                      {isIdentCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        {identity.displayName}
                        <span className="text-[10px] font-mono text-zinc-400">({identity.id})</span>
                      </div>
                      <div className="text-xs text-zinc-400 flex items-center gap-3 mt-0.5">
                        {identity.contacts.map((c) => (
                          <span key={c.id} className="flex items-center gap-1">
                            {c.kind === "email" ? <Mail className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
                            <span>
                              {c.kind === "phone"
                                ? revealedPhones.has(identity.id)
                                  ? c.value
                                  : maskPhoneNumber(c.value)
                                : c.value}
                            </span>
                            {c.isVerified && (
                              <span className="text-[9px] text-emerald-400">✓</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-300">
                      {identity.accounts.length} Accounts
                    </span>
                    <button
                      onClick={(e) => togglePhoneReveal(identity.id, e)}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px]"
                      title="Reveal/Mask Phone"
                    >
                      {revealedPhones.has(identity.id) ? "Mask Phone" : "Reveal Phone"}
                    </button>
                  </div>
                </div>

                {/* Expanded Accounts List */}
                {!isIdentCollapsed && (
                  <div className="p-4 space-y-3">
                    {identity.accounts.map((acc) => (
                      <div
                        key={acc.id}
                        onClick={() => {
                          setSelectedNode({
                            id: `node-acc-${acc.id}`,
                            type: "account",
                            label: acc.label,
                            subLabel: acc.loginEmail,
                            isProtected: acc.isProtected,
                            health: acc.health,
                            role: acc.role,
                            provider: acc.provider,
                            data: { ...acc },
                          });
                          setSelectedAccount(acc);
                        }}
                        className={`p-3.5 rounded-lg border bg-zinc-950/60 hover:bg-zinc-950 transition-colors cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                          acc.isProtected
                            ? "border-emerald-900/60 hover:border-emerald-700"
                            : "border-zinc-800 hover:border-zinc-700"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-md ${
                              acc.isProtected
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-white flex items-center gap-2">
                              {acc.label}
                              <span className="text-[10px] font-mono text-zinc-400 uppercase">
                                [{acc.provider}]
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400 font-mono">
                              login: {acc.loginEmail} • id: {acc.id}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 font-mono text-xs">
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            role: {acc.role}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                            {acc.resources.length} resources
                          </span>

                          {acc.isProtected ? (
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/40 font-semibold text-[11px]">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              PROTECTED
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 text-[11px]">
                              Eligible Target
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Slide-over Detail Drawer when Node is clicked */}
      {selectedNode && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl p-6 overflow-y-auto flex flex-col justify-between">
          <div className="space-y-6">
            {/* Drawer Header */}
            <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 border border-zinc-700">
                  {selectedNode.type} Node
                </span>
                <h3 className="text-base font-semibold text-white mt-2 tracking-tight">
                  {selectedNode.label}
                </h3>
                {selectedNode.subLabel && (
                  <p className="text-xs text-zinc-400 font-mono mt-0.5">{selectedNode.subLabel}</p>
                )}
              </div>

              <button
                onClick={() => setSelectedNode(null)}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Account Details */}
            {selectedNode.type === "account" && selectedAccount && (
              <div className="space-y-5 text-xs">
                {fleetAccount && <FleetAccountFacts account={fleetAccount} />}

                {/* Authoritative Protection Callout */}
                <div
                  className={`p-3.5 rounded-xl border flex items-center justify-between ${
                    selectedAccount.isProtected
                      ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                      : "bg-zinc-900 border-zinc-800 text-zinc-300"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {selectedAccount.isProtected ? (
                      <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                    ) : (
                      <ShieldAlert className="h-5 w-5 text-zinc-500 shrink-0" />
                    )}
                    <div>
                      <div className="font-semibold text-white">
                        {selectedAccount.isProtected
                          ? "Authoritative Protected Policy"
                          : "Placement Target"}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {selectedAccount.isProtected
                          ? "Shielded from automated workload dispatchers"
                          : "Eligible for batch job execution"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metadata Table */}
                <div className="space-y-2 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800/80">
                  <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider mb-2 font-mono">
                    Account Specifications
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/50">
                    <span className="text-zinc-400">Account ID:</span>
                    <span className="font-mono text-white">{selectedAccount.id}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/50">
                    <span className="text-zinc-400">Provider:</span>
                    <span className="font-mono text-white uppercase">{selectedAccount.provider}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/50">
                    <span className="text-zinc-400">Role:</span>
                    <span className="font-mono text-emerald-400">{selectedAccount.role}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-zinc-800/50">
                    <span className="text-zinc-400">Login Email:</span>
                    <span className="font-mono text-white">{selectedAccount.loginEmail}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-400">Owner Email:</span>
                    <span className="font-mono text-white">{selectedAccount.ownerEmail}</span>
                  </div>
                </div>

                {/* Safe Secret Reference Section (Infisical metadata only) */}
                <div className="bg-zinc-900/60 p-4 rounded-xl border border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono">
                      Safe Secret Reference
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                      Zero Secret Values Exposed
                    </span>
                  </div>

                  {selectedAccount.secretRef ? (
                    <div className="mt-2 space-y-1.5 font-mono text-[11px]">
                      <div className="text-white font-medium">{selectedAccount.secretRef.label}</div>
                      <div className="text-zinc-400">
                        Path: {selectedAccount.secretRef.path} ({selectedAccount.secretRef.environment})
                      </div>
                      <div className="text-zinc-400">
                        Status: <span className="text-emerald-400">{selectedAccount.secretRef.status}</span>
                      </div>
                      <div className="text-zinc-500 text-[10px]">
                        Last verified: {selectedAccount.secretRef.lastVerifiedAt || "Never"}
                      </div>
                    </div>
                  ) : (
                    <p className="text-zinc-500 text-xs italic">
                      No secret reference linked. Credentials stored securely in vault or local profile.
                    </p>
                  )}
                </div>

                {/* Linked Resources */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono">
                    Linked Resources ({selectedAccount.resources.length})
                  </div>
                  {selectedAccount.resources.length > 0 ? (
                    <div className="space-y-1.5">
                      {selectedAccount.resources.map((res) => (
                        <div
                          key={res.id}
                          className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between"
                        >
                          <div>
                            <div className="text-white font-medium truncate max-w-[220px]">
                              {res.name}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              {res.category} • {res.state}
                            </div>
                          </div>
                          {res.isProtected && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                              shielded
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-zinc-500 italic">No resources attached directly to this account.</p>
                  )}
                </div>

                {/* Linked Quota Meters */}
                {selectedAccount.quotaMeters.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono">
                      Quota Meters & Provenance
                    </div>
                    <div className="space-y-1.5">
                      {selectedAccount.quotaMeters.map((qm) => (
                        <div
                          key={qm.id}
                          className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]"
                        >
                          <div className="flex justify-between text-white font-medium">
                            <span>{qm.name}</span>
                            <span>
                              {qm.currentValue ?? qm.limitValue} / {qm.limitValue} {qm.unit}
                            </span>
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-400 mt-1 font-mono">
                            <span>Source: {qm.source}</span>
                            <span>Observed: {qm.observationTime?.slice(0, 10)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Identity Details */}
            {selectedNode.type === "identity" && (
              <div className="space-y-4 text-xs">
                <div className="bg-zinc-900/60 p-4 rounded-xl border border-zinc-800 space-y-3">
                  <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono">
                    Identity Contacts & Verification
                  </div>
                  <div className="space-y-2">
                    {((selectedNode.data.contacts as IdentityContact[]) || []).map((c) => (
                      <div
                        key={c.id}
                        className="p-2 rounded bg-zinc-950 border border-zinc-800/80 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-mono text-white text-[11px] flex items-center gap-1.5">
                            {c.kind === "email" ? (
                              <Mail className="h-3 w-3 text-zinc-400" />
                            ) : (
                              <Phone className="h-3 w-3 text-zinc-400" />
                            )}
                            <span>{c.kind === "phone" ? c.maskedValue || c.value : c.value}</span>
                          </div>
                          <div className="text-[10px] text-zinc-400">{c.label || "Contact"}</div>
                        </div>

                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            c.isVerified
                              ? "bg-emerald-950 text-emerald-400 border-emerald-500/30"
                              : "bg-amber-950 text-amber-400 border-amber-500/30"
                          }`}
                        >
                          {c.isVerified ? "verified" : "unverified"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-zinc-900/60 p-4 rounded-xl border border-zinc-800">
                  <div className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider font-mono mb-2">
                    Operator Notes
                  </div>
                  <p className="text-zinc-300 text-xs">
                    {(selectedNode.data.notes as string) || "No notes on file for this identity."}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-800">
            <button
              onClick={() => setSelectedNode(null)}
              className="w-full py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-xs transition-colors cursor-pointer"
            >
              Close Details
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
