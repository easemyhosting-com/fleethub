"use client";

import { useState, type FormEvent } from "react";
import { aiConnectionSnapshot, aiProtocols, type AiCheckResult, type AiConnectionSnapshot } from "@/lib/ai/model";

const field = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-400";
const button = "rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-950 disabled:opacity-50";
const protocolLabels: Record<typeof aiProtocols[number], string> = {
  "openai-chat-completions": "OpenAI-compatible Chat Completions",
  "openai-responses": "OpenAI-compatible Responses",
  "anthropic-messages": "Anthropic-compatible Messages",
};
const reasons: Record<string, string> = {
  access_denied: "the endpoint rejected the key",
  unavailable: "the endpoint did not answer successfully",
  invalid_response: "the reply did not match this protocol",
  credential_unavailable: "the stored key could not be read",
};

function describe(check: AiCheckResult): string[] {
  const list = check.modelList.state === "failed"
    ? `Model list: failed, ${reasons[check.modelList.reason]}.`
    : `Model list: ${check.modelList.modelCount} models, ${check.modelList.state === "listed" ? "including" : "not including"} ${check.model}. A listed model is not proof that requests work.`;
  const inference = check.inference.state === "untested"
    ? "Inference: not tested. No billable request was sent."
    : check.inference.state === "supported" ? "Inference: one minimal request succeeded for this protocol." : `Inference: failed, ${reasons[check.inference.reason]}.`;
  return [list, inference, "Usage and quota: not available from an inference connection."];
}

export default function AiConnectionPage() {
  const [data, setData] = useState<AiConnectionSnapshot | null>(null);
  const [check, setCheck] = useState<AiCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const denied = (status: number) => status === 401 || status === 403;

  async function load() {
    const response = await fetch("/api/ai-connection", { cache: "no-store" });
    if (!response.ok) throw new Error(denied(response.status) ? "Sign in to FleetHub as an operator to manage the AI connection." : "AI connection settings unavailable. Try again.");
    setData(aiConnectionSnapshot.parse(await response.json()));
  }
  async function run(action: () => Promise<string>) {
    setBusy(true); setMessage("");
    try { setMessage(await action()); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Something went wrong."); }
    finally { setBusy(false); }
  }
  const refresh = () => run(async () => { setCheck(null); await load(); return ""; });
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const body = { endpoint: values.get("endpoint"), protocol: values.get("protocol"), model: values.get("model"), secretRefId: values.get("secretRefId") || null };
    void run(async () => {
      const response = await fetch("/api/ai-connection", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(denied(response.status) ? "Sign in as an operator before saving." : response.status === 404 ? "That secret reference no longer exists. Reload and choose another." : "Could not save. Check the endpoint URL and model name.");
      setCheck(null);
      try { await load(); } catch { return "Saved, but the settings could not refresh. Reload before changing them again."; }
      return "Saved. Nothing has been sent to the endpoint yet.";
    });
  }
  function test(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const consentToBillableProbe = new FormData(event.currentTarget).get("consent") === "on";
    void run(async () => {
      const response = await fetch("/api/ai-connection/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consentToBillableProbe }) });
      if (!response.ok) throw new Error(denied(response.status) ? "Sign in as an operator before checking." : response.status === 409 ? "Save a connection first." : "Check failed. Confirm the endpoint origin is in FLEETHUB_ONBOARDING_ALLOWED_ORIGINS and uses HTTPS outside this machine.");
      setCheck(await response.json() as AiCheckResult);
      return "";
    });
  }
  function disconnect() {
    void run(async () => {
      const response = await fetch("/api/ai-connection", { method: "DELETE" });
      if (!response.ok) throw new Error(denied(response.status) ? "Sign in as an operator before disconnecting." : "Could not disconnect. Try again.");
      setCheck(null);
      try { await load(); } catch { setData(null); }
      return "Disconnected. The stored key and the upstream account were not changed.";
    });
  }

  const current = data?.connection;
  return <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 text-zinc-100 sm:px-8">
    <header className="space-y-3"><a href="/" className="text-sm text-cyan-300 underline underline-offset-4">Back to FleetHub</a>
      <p className="pt-4 text-xs uppercase tracking-widest text-zinc-500">Optional / off by default</p><h1 className="text-3xl font-semibold tracking-tight">AI connection</h1>
      <p className="text-sm leading-6 text-zinc-400">FleetHub works fully without AI. You can point it at a model endpoint you already run or pay for: a direct API, an existing proxy or a local model server. FleetHub does not manage the service, route between models or read usage from it.</p>
      <p className="text-sm leading-6 text-zinc-400">No inventory is sent anywhere by saving this. Keys stay in the encrypted store; choose an existing secret reference, or none for a local server that needs no key.</p>
      <button onClick={() => void refresh()} disabled={busy} className={button}>{busy ? "Working…" : "Load settings"}</button>
    </header>
    <p role="status" aria-live="polite" className="text-sm text-cyan-200">{message}</p>
    {data && <>
      {data.limited && <p className="text-amber-300">Only the first 1,000 secret references are listed.</p>}
      <form onSubmit={save} key={current?.updatedAt ?? "new"}><fieldset disabled={busy} className="grid gap-4 rounded-xl border border-zinc-800 p-5">
        <legend className="px-2 text-base font-medium">{current ? "Connection" : "Connect an endpoint"}</legend>
        <label className="text-sm text-zinc-300">API base URL, including the version path<input name="endpoint" type="url" required maxLength={2048} defaultValue={current?.endpoint} placeholder="https://api.example.com/v1" className={field} /></label>
        <label className="text-sm text-zinc-300">Protocol<select name="protocol" className={field} defaultValue={current?.protocol ?? aiProtocols[0]}>{aiProtocols.map(id => <option key={id} value={id}>{protocolLabels[id]}</option>)}</select></label>
        <label className="text-sm text-zinc-300">Model name<input name="model" required maxLength={200} defaultValue={current?.model} className={field} /></label>
        <label className="text-sm text-zinc-300">Key<select name="secretRefId" className={field} defaultValue={current?.secretRefId ?? ""}><option value="">No key (local server)</option>{current?.secretRefId && !data.secretRefs.some(ref => ref.id === current.secretRefId) ? <option value={current.secretRefId}>Saved key (not in the listed references)</option> : null}{data.secretRefs.map(ref => <option key={ref.id} value={ref.id}>{ref.label}</option>)}</select></label>
        <div className="flex flex-wrap gap-3"><button className={button}>Save connection</button>{current && <button type="button" onClick={disconnect} className="text-sm text-zinc-400 underline">Disconnect</button>}</div>
      </fieldset></form>
      {current && <form onSubmit={test}><fieldset disabled={busy} className="space-y-4 rounded-xl border border-zinc-800 p-5">
        <legend className="px-2 text-base font-medium">Check</legend>
        <p className="text-sm leading-6 text-zinc-400">The check lists models, which is free on most servers. It proves only that the endpoint answers.</p>
        <label className="flex items-start gap-3 text-sm text-zinc-300"><input type="checkbox" name="consent" className="mt-1" />Also send one minimal request to {current.model}. This may be billed by the provider.</label>
        <button className={button}>Run check</button>
        {check && <ul className="space-y-1 text-sm text-zinc-300">{describe(check).map(line => <li key={line}>{line}</li>)}</ul>}
      </fieldset></form>}
    </>}
  </main>;
}
