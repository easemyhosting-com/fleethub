"use client";

import { useEffect, useState } from "react";
import { parsePairHash } from "@/lib/pairing/link";

export default function PairDevicePage() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromLink, setFromLink] = useState(false);
  const [paired, setPaired] = useState<{ label: string; scope: string } | null>(null);

  useEffect(() => {
    const linked = parsePairHash(window.location.hash);
    if (linked) { setCode(linked); setFromLink(true); window.history.replaceState(null, "", window.location.pathname); }
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/devices/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, ...(label.trim() ? { label: label.trim() } : {}) }) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) { setPaired({ label: String(body?.label ?? "this device"), scope: body?.scope === "operator" ? "operator" : "read-only" }); setTimeout(() => window.location.assign("/"), 1500); return; }
      setMessage(typeof body?.error === "string" ? body.error : "Pairing failed.");
    } catch { setMessage("Could not reach FleetHub."); } finally { setBusy(false); }
  };

  if (paired) return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-[#090a0f] p-6 text-zinc-100"><div role="status" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6"><p className="text-lg font-semibold text-emerald-300">✓ Paired</p><p className="mt-2 text-sm text-zinc-300">“{paired.label}” is now connected as {paired.scope}. Opening FleetHub…</p></div></main>;

  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-[#090a0f] p-6 text-zinc-100">
    <h1 className="text-xl font-semibold text-white">Pair this device</h1>
    <p className="mt-2 text-sm leading-6 text-zinc-400">{fromLink ? "Your pairing code was filled in from the link. Check the device name and tap Pair device." : <>On a device where you are signed in to FleetHub, open <strong>Devices &amp; sessions</strong> and create a pairing code. Scan its QR code, or enter the code here. It works once and expires in minutes.</>}</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-xs text-zinc-300">Pairing code<input required autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} placeholder="ABCD-EFGH-JKLM" className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 p-3 font-mono text-base tracking-wider" /></label>
      <label className="block text-xs text-zinc-300">Device name (optional)<input maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="My iPhone" className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 p-3 text-base" /></label>
      <button type="submit" disabled={busy || code.trim().length < 8} className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">Pair device</button>
    </form>
    {message ? <p role="alert" className="mt-4 text-sm text-amber-300">{message}</p> : null}
  </main>;
}
