"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, X } from "lucide-react";
import { z } from "zod";

// Display order. Only a secret store (built-in or Infisical) is required; the other steps are independent and optional.
const stepIds = ["infisical", "builtin", "tailscale", "cliproxy"] as const;
const tierLabels: Partial<Record<(typeof stepIds)[number], string>> = { infisical: "Secret store · choose one backend", tailscale: "Private access · optional", cliproxy: "AI gateway · optional" };
type StepId = (typeof stepIds)[number];
type Mode = "existing" | "install";

const stepSchema = z.object({
  id: z.enum(stepIds),
  status: z.enum(["unconfigured", "configured", "verified", "failed", "stale"]),
  config: z.record(z.string(), z.unknown()),
  verifiedAt: z.string().nullable(),
  skipped: z.boolean().default(false),
  message: z.string(),
});
const stateSchema = z.object({ steps: z.array(stepSchema), ready: z.boolean() });
type OnboardingState = z.infer<typeof stateSchema>;

const definitions: Record<StepId, {
  title: string;
  purpose: string;
  docs: string;
  command: string;
  fields: { key: string; label: string; placeholder: string; fallback?: string }[];
  env: string;
  guide: string[];
  docLinks: { label: string; href: string }[];
}> = {
  builtin: {
    title: "Built-in secret store",
    purpose: "Keep provider credentials encrypted in FleetHub's own database. No extra service needed.",
    docs: "https://github.com/",
    command: "openssl rand -base64 48",
    fields: [],
    env: "FLEETHUB_SECRET_STORE_KEY",
    guide: [
      "Generate a long random key and put it in your private .env as FLEETHUB_SECRET_STORE_KEY, then restart FleetHub once. The key lives only in the environment, never in the database.",
      "Back the key up. Without it the stored credentials cannot be decrypted, and anyone with both the key and the database can read them.",
      "Click Save settings, then Verify connection. FleetHub writes, reads back and deletes a test value.",
    ],
    docLinks: [],
  },
  tailscale: {
    title: "Tailscale mesh",
    purpose: "Connect FleetHub to your private network.",
    docs: "https://tailscale.com/kb/1347/installation",
    command: "tailscale up",
    fields: [
      { key: "tailnet", label: "Tailnet", placeholder: "example.ts.net" },
      { key: "deviceId", label: "FleetHub host device ID", placeholder: "Tailscale device ID for this host" },
    ],
    env: "TAILSCALE_API_TOKEN",
    guide: [],
    docLinks: [{ label: "Tailscale API access tokens", href: "https://tailscale.com/kb/1101/api" }],
  },
  infisical: {
    title: "Infisical vault",
    purpose: "Connect the vault used for provider credentials.",
    docs: "https://infisical.com/docs/self-hosting/deployment-options/docker-compose",
    command: "docker compose --env-file .local-setup/.env --profile infisical up -d infisical",
    fields: [
      { key: "apiUrl", label: "API URL (reachable from FleetHub)", placeholder: "https://vault.example.com" },
      { key: "consoleUrl", label: "Console URL (your browser)", placeholder: "https://vault.example.com" },
      { key: "projectId", label: "Project ID", placeholder: "Project settings → Project ID" },
      { key: "environment", label: "Environment slug", placeholder: "dev", fallback: "dev" },
      { key: "secretPath", label: "Secret path", placeholder: "/accounts", fallback: "/accounts" },
      { key: "connectorSecretPath", label: "Connector secret path (optional)", placeholder: "Blank keeps connectors in the secret path" },
    ],
    env: "INFISICAL_UNIVERSAL_AUTH_CLIENT_ID and INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET",
    guide: [
      "Open your existing Infisical console, or finish the explicit local installation first. Reuse your existing login; create an operator account only for a new instance.",
      "Select or create a dedicated fleethub project, an environment such as dev or prod, and an /accounts folder. Note its Project ID and environment slug. Existing configured paths remain valid.",
      "Create a machine identity (Organization → Access Control → Machine Identities) with Universal Auth, then create a client secret. It is shown once.",
      "Add the identity to the project with permission to create, read and delete secrets in that environment and path, and in the connector path if you set one: verification writes and removes a temporary secret in each. Changing a path later keeps existing credentials readable from where they were saved.",
      "Put the Client ID and Client Secret in the runtime settings file (below), then fill in the fields and verify. Format: Project ID and environment use letters, digits, - and _ only (no spaces; the environment is the short slug such as dev, not its display name); URLs start with http:// or https://; the secret path starts with /.",
    ],
    docLinks: [{ label: "Machine identities", href: "https://infisical.com/docs/documentation/platform/identities/machine-identities" }, { label: "Universal Auth", href: "https://infisical.com/docs/documentation/platform/identities/universal-auth" }, { label: "Self-hosting with Docker Compose", href: "https://infisical.com/docs/self-hosting/deployment-options/docker-compose" }],
  },
  cliproxy: {
    title: "CLIProxyAPI gateway",
    purpose: "Connect the AI gateway that routes model requests.",
    docs: "https://github.com/router-for-me/CLIProxyAPI",
    command: "docker compose --env-file .local-setup/.env --profile cliproxy up -d --build cli-proxy-api",
    fields: [
      { key: "apiUrl", label: "API URL (reachable from FleetHub)", placeholder: "https://gateway.example.com" },
      { key: "consoleUrl", label: "Console URL (your browser)", placeholder: "https://gateway.example.com/management.html" },
    ],
    env: "CLIPROXY_API_KEY and CLIPROXY_MANAGEMENT_KEY",
    guide: [
      "For an existing gateway, obtain a dedicated inference key and its separate management credential from the operator. For a new local install, these are access.api-keys and management.secret-key in the private cliproxy-config.yaml.",
      "Put them in the runtime settings file as CLIPROXY_API_KEY and CLIPROXY_MANAGEMENT_KEY (below).",
      "Fill in the two URLs, save, and verify. CLIProxyAPI owns upstream logins, auth files and token refresh. Existing accounts remain there; connecting FleetHub does not require signing them in again. Connection verification does not measure upstream quota.",
    ],
    docLinks: [{ label: "CLIProxyAPI configuration", href: "https://help.router-for.me/configuration/options" }, { label: "Management Center", href: "https://help.router-for.me/management/webui" }, { label: "Docker Compose guide", href: "https://help.router-for.me/docker/docker-compose" }],
  },
};

function messageFromResponse(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") return value.error;
  if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") return value.message;
  return fallback;
}

async function requestState(signal?: AbortSignal): Promise<OnboardingState> {
  const response = await fetch("/api/onboarding", { signal });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(messageFromResponse(body, "Could not load setup status."));
  const parsed = stateSchema.safeParse(body);
  if (!parsed.success) throw new Error("Setup status has an unexpected format.");
  return parsed.data;
}

interface SetupWizardProps {
  onClose: () => void;
  onReady?: () => void;
  onConnectProvider?: () => void;
  initialStep?: StepId;
}

export function SetupWizard({ onClose, onReady, onConnectProvider, initialStep }: SetupWizardProps) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [selected, setSelected] = useState<StepId>(initialStep ?? "infisical");
  const initializedSelection = useRef(false);
  const [mode, setMode] = useState<Mode>("existing");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"load" | "save" | "verify" | "skip" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await requestState(signal);
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load setup status.");
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!state || initializedSelection.current) return;
    initializedSelection.current = true;
    // Reopen a working backend without redirecting users after Save or Verify.
    const verifiedBackend = state.steps.find(item => item.id === "infisical" && item.status === "verified")
      ?? state.steps.find(item => item.id === "builtin" && item.status === "verified");
    setSelected(initialStep ?? verifiedBackend?.id ?? "infisical");
  }, [initialStep, state]);

  const steps = state?.steps ?? [];
  const step = steps.find((item) => item.id === selected);
  const definition = definitions[selected];
  const selectedIndex = stepIds.indexOf(selected);
  const supportsLocalInstall = selected === "infisical" || selected === "cliproxy";
  const isDirty = definition.fields.some(({ key }) => Object.hasOwn(values, key) && values[key].trim() !== (typeof step?.config[key] === "string" ? step.config[key] : ""));
  const canAdvance = !isDirty;

  function chooseStep(id: StepId) {
    setSelected(id);
    setMode("existing");
    setValues({});
    setError(null);
    setNotice(null);
  }

  async function skipOptionalConnection() {
    if (selected !== "tailscale" && selected !== "cliproxy") return;
    setBusy("skip");
    setError(null);
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "skip", step: selected }) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFromResponse(body, "Could not save the skipped connection. Try again."));
      setState(stateSchema.parse(body));
      if (selected === "tailscale") {
        chooseStep("cliproxy");
        setNotice("Private access skipped. Its saved connection is unchanged.");
      } else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the skipped connection. Try again.");
    } finally { setBusy(null); }
  }

  function useLocalAddresses() {
    if (selected === "infisical") {
      setValues(current => ({ ...current, apiUrl: "http://infisical:8080", consoleUrl: "http://localhost:8088" }));
    } else if (selected === "cliproxy") {
      setValues(current => ({ ...current, apiUrl: "http://cli-proxy-api:8317", consoleUrl: "http://localhost:8317/management.html" }));
    }
    setNotice("Local Compose addresses filled in. Review and save them after starting the service yourself.");
  }

  function fieldValue(key: string): string {
    if (Object.hasOwn(values, key)) return values[key];
    const saved = step?.config[key];
    return typeof saved === "string" ? saved : "";
  }

  async function submit(action: "save" | "verify") {
    if (action === "verify" && isDirty) {
      setError("Save your changes before verifying this connection.");
      return;
    }
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const config = Object.fromEntries(definition.fields.map(({ key, fallback }) => [key, fieldValue(key).trim() || fallback || ""]));
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save" ? { action, step: selected, config } : { action, step: selected }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(messageFromResponse(body, `${action === "save" ? "Saving" : "Verification"} failed.`));
      const next = await refresh();
      setValues({});
      const updated = next.steps.find((item) => item.id === selected);
      if (action === "verify" && updated?.status !== "verified") {
        setError(updated?.message || "Connection could not be verified.");
      } else {
        setNotice(action === "save" ? "Settings saved. Verify the connection to continue." : "Connection verified.");
      }
      if (next.ready && !state?.ready) onReady?.();
    } catch (cause) {
      if (action === "verify") { try { await refresh(); } catch { /* Keep the original verification error. */ } }
      setError(cause instanceof Error ? cause.message : "The request failed. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="setup-title" className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800 p-6">
          <div><h2 id="setup-title" className="text-2xl font-semibold">Connect your infrastructure</h2><p className="mt-2 text-sm text-zinc-400">Choose one secret backend to store provider credentials. Private access and the AI gateway are optional.</p></div>
          <button type="button" onClick={onClose} aria-label="Close setup" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"><X size={20} /></button>
        </header>
        <div className="grid gap-0 md:grid-cols-[230px_1fr]">
          <nav aria-label="Setup steps" className="border-b border-zinc-800 p-4 md:border-b-0 md:border-r">
            {stepIds.map((id, index) => {
              const item = steps.find((candidate) => candidate.id === id);
              return <div key={id}>{tierLabels[id] ? <p className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{tierLabels[id]}</p> : null}<button type="button" onClick={() => chooseStep(id)} disabled={busy !== null || isDirty} aria-current={selected === id ? "step" : undefined} className={`mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${selected === id ? "bg-cyan-500/10 text-cyan-300" : "text-zinc-400 hover:bg-zinc-900"} disabled:cursor-not-allowed disabled:opacity-40`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">{item?.status === "verified" ? <CheckCircle2 size={16} /> : index + 1}</span><span>{definitions[id].title}</span></button></div>;
            })}
            <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-400"><p className="font-medium text-zinc-200">Service inventory</p><p className="mt-1">Secret store · Tailscale · CLIProxyAPI</p><p className="mt-2">Provider connections {state?.ready ? "available" : "unlock once a secret store is verified"}.</p></div>
          </nav>
          <main className="min-h-[450px] min-w-0 p-6 [overflow-wrap:anywhere]">
            {busy === "load" ? <p className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="animate-spin" size={16} /> Loading setup status…</p> : null}
            {!state && busy !== "load" ? <button type="button" onClick={() => { setBusy("load"); setError(null); refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load setup status.")).finally(() => setBusy(null)); }} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Retry loading</button> : null}
            {state ? <>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-semibold">{definition.title}</h3><p className="mt-1 text-sm text-zinc-400">{definition.purpose}</p></div><span className={`rounded-full border px-2.5 py-1 text-xs capitalize ${step?.status === "verified" && !isDirty ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>{isDirty ? "Unsaved changes" : step?.status ?? "unconfigured"}</span></div>
              {step?.skipped ? <p className="mb-4 text-sm text-zinc-300">Skipped for now. Any saved connection remains unchanged. Save or verify to resume setup.</p> : null}
              {supportsLocalInstall ? <>
                <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Setup mode">
                  <button type="button" aria-pressed={mode === "existing"} disabled={busy !== null} onClick={() => setMode("existing")} className={`rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${mode === "existing" ? "bg-zinc-700 text-white" : "border border-zinc-700 text-zinc-300"}`}>Connect existing</button>
                  <button type="button" aria-pressed={mode === "install"} disabled={busy !== null} onClick={() => setMode("install")} className={`rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${mode === "install" ? "bg-zinc-700 text-white" : "border border-zinc-700 text-zinc-300"}`}>Set up locally</button>
                </div>
                {selected === "infisical" ? <p className="mb-4 text-sm leading-relaxed text-zinc-300">For a new installation, use the built-in secret store or connect an existing Infisical. The bundled Infisical profile is deprecated; install new servers with the <a href={definition.docs} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline underline-offset-4">upstream installation guide</a>. Existing profile commands remain available and keep their volumes.</p> : null}
                {mode === "existing" ? <p className="mb-5 text-sm leading-relaxed text-zinc-300">Use a service you already operate. FleetHub connects to it without installing anything or replacing its accounts. Inside a container, localhost means that container. Allowlist the exact API origin in <code>FLEETHUB_ONBOARDING_ALLOWED_ORIGINS</code> before verifying.</p> : <div className="mb-5 rounded-lg border border-zinc-700 p-4 text-sm">
                  <h4 className="font-medium">{selected === "infisical" ? "Existing bundled Infisical installation" : "Start only CLIProxyAPI on your host"}</h4>
                  <p className="mt-2 leading-relaxed text-zinc-300">Run these commands yourself from the project directory. FleetHub never starts containers. Use your existing private env file and Compose project name when extending an installation.</p>
                  {selected === "infisical" ? <p className="mt-3 text-zinc-300">For a new Infisical server, follow the upstream installation guide. The command below is only for an existing bundled installation. Keep its original private configuration and volumes.</p> : <p className="mt-3 text-zinc-300">For a new installation only, first run <code>node scripts/prepare-local-setup.mjs</code>. It creates private configuration and starts nothing. Do not regenerate an existing setup.</p>}
                  <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre rounded bg-black/50 p-3 text-xs"><code>{definition.command}</code></pre>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button type="button" onClick={() => navigator.clipboard.writeText(definition.command).then(() => setNotice("Startup command copied. Review it before running it yourself.")).catch(() => setError("Could not copy the command."))} className="rounded border border-zinc-600 px-3 py-2 text-xs">Copy startup command</button>
                    <button type="button" disabled={busy !== null} onClick={useLocalAddresses} className="rounded border border-zinc-600 px-3 py-2 text-xs disabled:opacity-50">Use local Compose addresses</button>
                    <a href={definition.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:underline">Installation guide <ExternalLink size={13} /></a>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-zinc-300">{selected === "infisical" ? "Infisical starts its own PostgreSQL and Redis, with a combined 1.5 GiB memory limit. Its console uses host port 8088." : "CLIProxyAPI has a 512 MiB memory limit and uses host ports 8317 and 8085. Its auth files remain in its persistent volume."} Ports bind to host loopback. Keep the generated env file and named data volumes backed up; stopping a service does not require deleting its data.</p>
                </div>}
              </> : <p className="mb-5 text-sm leading-relaxed text-zinc-300">{selected === "builtin" ? "This backend uses FleetHub's database and requires no extra container. Set its encryption key on the server, then save and verify below." : "Private access is optional. Use an existing private network or install Tailscale on the host using its official guide. FleetHub does not install or enroll it for you."}{selected === "tailscale" ? <a href={definition.docs} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-cyan-300 hover:underline">Tailscale installation guide <ExternalLink size={13} /></a> : null}</p>}
              <div className="grid gap-4 sm:grid-cols-2">{definition.fields.map((field) => <label key={field.key} className="block text-sm text-zinc-300">{field.label}<input type="text" value={fieldValue(field.key)} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} autoComplete="off" disabled={busy !== null} className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-50" /></label>)}</div>
              {selected === "builtin" ? <pre className="mt-4 overflow-x-auto rounded bg-black/50 p-3 text-xs"><code>{definition.command}</code></pre> : null}
              {definition.guide.length > 0 ? <ol className="mt-5 list-decimal space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 pl-8 text-xs leading-relaxed text-zinc-400">{definition.guide.map((item) => <li key={item}>{item}</li>)}</ol> : null}
              {selected === "builtin" ? <p className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs leading-relaxed text-zinc-400">Set <code className="text-zinc-200">FLEETHUB_SECRET_STORE_KEY</code> in your private setup .env and restart once (this key is deliberately not hot-reloaded). It is separate from <code className="text-zinc-200">FLEETHUB_AUTH_SECRET</code>. Never enter keys in this form.</p> : <p className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs leading-relaxed text-zinc-400">Credentials belong in the FleetHub server environment, never in this form. Set <code className="text-zinc-200">{definition.env}</code> in <code className="text-zinc-200">runtime/runtime.env</code> in your private setup folder; it is picked up within a second, no restart needed. The other settings (<code className="text-zinc-200">FLEETHUB_ONBOARDING_ALLOWED_ORIGINS</code>, <code className="text-zinc-200">FLEETHUB_AUTH_SECRET</code>) come from your setup .env.</p>}
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400"><span>Enter service URLs explicitly. Infisical defaults to dev and /accounts when those fields are empty. Docs:</span>{definition.docLinks.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:underline">{link.label} <ExternalLink size={12} /></a>)}<span>· FleetHub docs/23-self-onboarding.md and docs/38-hot-reload-config.md</span></p>
              {isDirty ? <div className="mt-4 flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-amber-300">Unsaved changes. Save or discard them before moving on.</p><button type="button" disabled={busy !== null} onClick={() => { setValues({}); setError(null); setNotice("Unsaved changes discarded. Saved settings were not changed."); }} className="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-200 disabled:opacity-50">Discard changes</button></div> : null}
              {selected === "tailscale" ? <p className="mt-3 text-xs text-zinc-400">Choose this FleetHub host’s Tailscale device. Verification checks that its authorized online IP is on a local Tailscale interface.</p> : null}
              {selected === "tailscale" ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-400"><li><strong className="text-zinc-300">Tailnet</strong>: your tailnet name, such as <code>tailXXXX.ts.net</code> (the part of this Mac’s address after its machine name; also shown in the Tailscale admin console under DNS).</li><li><strong className="text-zinc-300">Device ID</strong>: this Mac’s node ID. Run <code>tailscale status --json</code> and copy <code>Self.ID</code>, or open Machines in the admin console.</li><li>Verification also needs <code>TAILSCALE_API_TOKEN</code> (an API access token from the admin console, Settings → Keys) in the server environment, and a fresh <code>tailscale status --json</code> snapshot at <code>TAILSCALE_STATUS_PATH</code>. See docs/23-self-onboarding.md.</li></ul> : null}
              {step?.message ? <p className="mt-4 text-sm text-zinc-400">{step.message}</p> : null}
              {step?.verifiedAt && step.status === "verified" ? <p className="mt-2 text-xs text-emerald-400">Verified {new Date(step.verifiedAt).toLocaleString()}</p> : null}
              {error ? <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-300"><CircleAlert size={16} className="shrink-0" />{error}</p> : null}
              {notice ? <p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p> : null}
              <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => submit("save")} disabled={busy !== null} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50">{busy === "save" ? "Saving…" : "Save settings"}</button><button type="button" onClick={() => submit("verify")} disabled={busy !== null || isDirty} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400 disabled:opacity-50">{busy === "verify" ? "Verifying…" : "Verify connection"}</button>{selectedIndex < stepIds.length - 1 ? <button type="button" onClick={() => chooseStep(stepIds[selectedIndex + 1])} disabled={!canAdvance || busy !== null} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm disabled:opacity-40">Next connection →</button> : null}{selected === "tailscale" || selected === "cliproxy" ? <button type="button" onClick={skipOptionalConnection} disabled={isDirty || busy !== null} className="rounded-lg px-4 py-2 text-sm text-zinc-300 underline underline-offset-4 disabled:opacity-40">Skip for now</button> : null}</div>
              {state.ready && !isDirty ? <div className="mt-6 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300">Secret backend ready. Optional connections can be configured later. <button type="button" onClick={onConnectProvider} className="ml-2 rounded bg-emerald-500 px-3 py-1.5 font-medium text-zinc-950">Connect provider</button></div> : null}
            </> : null}
            {error && !state ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
          </main>
        </div>
      </div>
    </div>
  );
}
