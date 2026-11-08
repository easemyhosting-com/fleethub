import type { Diagnostic } from "@/lib/connectors/diagnostics";

/** Native disclosure keeps repair advice reachable by keyboard without a modal or extra request. */
export function CollectionDiagnostics({ items }: { items: Diagnostic[] }) {
  if (!items.length) return null;
  return <details className="min-w-0 border-t border-zinc-800 pt-3 text-sm text-zinc-300">
    <summary className="cursor-pointer rounded py-1 font-medium text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Diagnostics and recovery</summary>
    <ul className="mt-3 space-y-4">{items.slice(0, 3).map(item => <li key={`${item.source}:${item.code}`} className="min-w-0 break-words space-y-1">
      <p className="font-medium text-zinc-100">{item.summary}</p>
      <p className="max-w-prose leading-relaxed">{item.repair}</p>
      <p className="text-zinc-400">Source: {item.source === "inventory_collection" ? "Inventory collection" : "Connector scan"} · {item.observedAt ? <time dateTime={item.observedAt}>{new Date(item.observedAt).toLocaleString()}</time> : "Observation time unknown"}</p>
    </li>)}</ul>
  </details>;
}
