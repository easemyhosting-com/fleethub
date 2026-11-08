import { connect } from "node:net";
import type { ConnectorKind } from "./clients";

import { isTailscaleIp } from "@/lib/capacity/addresses";
export { isTailscaleIp };

export interface TailscalePeer { ip: string; name: string | null }

/** Reads the output of `tailscale status` (any whitespace layout) or a plain list of addresses, several per line allowed. Only Tailscale addresses survive. */
export function parseTailscaleInput(text: string): TailscalePeer[] {
  const seen = new Map<string, TailscalePeer>();
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/[\s,;]+/).filter(Boolean);
    tokens.forEach((ip, index) => {
      if (!isTailscaleIp(ip)) return;
      const next = tokens[index + 1];
      const name = next && !isTailscaleIp(next) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(next) ? next : null;
      if (!seen.has(ip) || (name && !seen.get(ip)!.name)) seen.set(ip, { ip, name });
    });
  }
  return [...seen.values()];
}

export interface ProbeTarget { port: number; kind: ConnectorKind; scheme: "http" | "https"; label: string; note: string }
/** Fixed list, never caller-supplied: each is the standard port of a source FleetHub can read. */
export const probeTargets: ProbeTarget[] = [
  { port: 6443, kind: "kubernetes", scheme: "https", label: "Kubernetes API", note: "Needs the read-only service account token and cluster CA. The API certificate must list this address or you will get a TLS error." },
  { port: 2375, kind: "docker", scheme: "http", label: "Docker socket proxy", note: "Read-only socket proxy over the private network. Enable allowHttp." },
  { port: 2376, kind: "docker", scheme: "https", label: "Docker socket proxy (TLS)", note: "Docker endpoint with TLS." },
  { port: 9090, kind: "prometheus", scheme: "http", label: "Prometheus", note: "Adds measured usage next to declared requests. Enable allowHttp." },
];

export interface ProbeSuggestion { kind: ConnectorKind; port: number; label: string; url: string; allowHttp: boolean; note: string }
export interface HostProbe { ip: string; name: string | null; open: number[]; suggestions: ProbeSuggestion[]; otherWays: string[] }

export type Connector = (ip: string, port: number, timeoutMs: number) => Promise<boolean>;
export const tcpOpen: Connector = (ip, port, timeoutMs) => new Promise(resolve => {
  const socket = connect({ host: ip, port });
  const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
  socket.setTimeout(timeoutMs, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});

export function suggestionsFor(ip: string, open: number[]): ProbeSuggestion[] {
  return probeTargets.filter(target => open.includes(target.port)).map(target => ({ kind: target.kind, port: target.port, label: target.label, url: `${target.scheme}://${ip}:${target.port}`, allowHttp: target.scheme === "http", note: target.note }));
}

/** What to do when no live endpoint answered, or in addition to one. Every way is read-only. */
export function otherWays(open: number[]): string[] {
  const ways = ["GitOps repo: if this host is declared there (Flux clusters or servers/<host>/<stack>/docker-compose.yml), run discovery. No network access to the host is needed.", "Project hooks: a project can push its needs and usage with its own key, with no connection from FleetHub to the host."];
  if (!open.some(port => port === 2375 || port === 2376)) ways.push("Docker host: run the read-only socket proxy compose (docs/assets/docker-socket-proxy.compose.yml) bound to this Tailscale address.");
  if (!open.includes(9090)) ways.push("Prometheus or Grafana Cloud: connect any Prometheus-compatible URL to read measured CPU and memory.");
  if (!open.includes(6443)) ways.push("Kubernetes: expose the API over Tailscale and add the address to the API server certificate (k3s: --tls-san).");
  return ways;
}

const maxHosts = 16;
export async function probeHosts(peers: TailscalePeer[], options: { connector?: Connector; timeoutMs?: number } = {}): Promise<HostProbe[]> {
  const connector = options.connector ?? tcpOpen, timeoutMs = options.timeoutMs ?? 1500;
  const chosen = peers.filter(peer => isTailscaleIp(peer.ip)).slice(0, maxHosts);
  return Promise.all(chosen.map(async peer => {
    const results = await Promise.all(probeTargets.map(async target => (await connector(peer.ip, target.port, timeoutMs)) ? target.port : null));
    const open = results.filter((port): port is number => port !== null);
    return { ip: peer.ip, name: peer.name, open, suggestions: suggestionsFor(peer.ip, open), otherWays: otherWays(open) };
  }));
}
