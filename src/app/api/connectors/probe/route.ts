import { NextResponse } from "next/server";
import { z } from "zod";
import { createUnauthorizedResponse, isOperator, readJsonWithLimit, verifyApiAccess } from "@/lib/auth/guard";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { queryClient } from "@/lib/db/client";
import { ambiguousHostKeys, hostKey } from "@/lib/capacity/addresses";
import { parseTailscaleInput, probeHosts, type TailscalePeer } from "@/lib/connectors/probe";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const input = z.strictObject({ text: z.string().max(20_000).default(""), includeKnown: z.boolean().default(true) });

/** Operator-only. TCP connect checks against a fixed port list on Tailscale (100.64.0.0/10) addresses only. Nothing is sent to the ports. */
export async function POST(req: Request) {
  const auth = await verifyApiAccess(req, { requireWrite: true });
  if (!auth.authorized) return createUnauthorizedResponse(auth);
  if (!isOperator(auth)) return NextResponse.json({ error: "Forbidden: only an operator can probe hosts." }, { status: 403, headers });
  const raw = await readJsonWithLimit<unknown>(req, 32 * 1024);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status, headers });
  const parsed = input.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "Provide text: one or more Tailscale addresses, or pasted `tailscale status` output." }, { status: 400, headers });
  const peers = new Map<string, TailscalePeer>(parseTailscaleInput(parsed.data.text).map(peer => [peer.ip, peer]));
  if (parsed.data.includeKnown) {
    try {
      if ((await bootstrapDatabase()).success) {
        const rows = await queryClient`SELECT name, tailscale_ip AS ip FROM network_gateways`;
        for (const row of rows) for (const peer of parseTailscaleInput(`${row.ip} ${row.name}`)) if (!peers.has(peer.ip)) peers.set(peer.ip, peer);
      }
    } catch { /* known hosts are a convenience; typed addresses still work */ }
  }
  if (peers.size === 0) return NextResponse.json({ error: "No Tailscale addresses found. They look like 100.x.y.z (100.64.0.0 to 100.127.255.255)." }, { status: 400, headers });
  const hosts = await probeHosts([...peers.values()]);
  try {
    // Remember an address only when its name points at one machine: not shared by two FleetHub resources (web-1, web1) or by two peers in this run.
    const names = (await queryClient`SELECT name FROM resources WHERE category = 'compute' AND retired_at IS NULL`).map(row => String(row.name));
    const ambiguous = ambiguousHostKeys(names);
    const peersPerKey = new Map<string, number>();
    for (const host of hosts) if (host.name) peersPerKey.set(hostKey(host.name), (peersPerKey.get(hostKey(host.name)) ?? 0) + 1);
    for (const host of hosts) if (host.name && !ambiguous.has(hostKey(host.name)) && peersPerKey.get(hostKey(host.name)) === 1) await queryClient`INSERT INTO host_addresses (host_key, address, kind, source) VALUES (${hostKey(host.name)}, ${host.ip}, 'tailscale', 'tailscale-probe') ON CONFLICT (host_key, address) DO UPDATE SET last_seen = NOW()`;
  } catch { /* remembering the address is optional */ }
  return NextResponse.json({ hosts, limit: 16 }, { headers });
}
