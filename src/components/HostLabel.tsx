import { useId } from "react";
import type { HostAddress } from "@/lib/capacity/host";

const kindLabel: Record<HostAddress["kind"], string> = { tailscale: "Tailscale", private: "Private network", public: "Public" };

/** A machine shown by name. Hover or keyboard focus lists every address FleetHub knows for it; the name links to its page. */
export function HostLabel({ name, addresses, href, className = "" }: { name: string; addresses: HostAddress[]; href?: string; className?: string }) {
  const label = <span className="break-words">{name}</span>, tooltipId = useId();
  return <span className={`group relative inline-flex min-w-0 items-center ${className}`}>
    {href ? <a href={href} aria-describedby={tooltipId} className="font-semibold text-emerald-200 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{label}</a> : <span tabIndex={0} aria-describedby={tooltipId} className="font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{label}</span>}
    <span id={tooltipId} role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-max max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-[11px] text-zinc-200 shadow-xl group-focus-within:visible group-hover:visible">
      {addresses.length ? <ul className="space-y-1">{addresses.map(item => <li key={item.address} className="flex justify-between gap-3"><code>{item.address}</code><span className="text-zinc-400">{kindLabel[item.kind]}</span></li>)}</ul> : <span className="text-zinc-400">No addresses known yet. Connect a metrics source or probe over Tailscale.</span>}
    </span>
  </span>;
}
