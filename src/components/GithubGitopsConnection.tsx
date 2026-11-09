"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

const endpoint = "/api/gitops/github";
const statusSchema = z.object({ status: z.enum(["not_configured", "disconnected", "connected", "reconnect"]) });
const startSchema = z.object({ url: z.url() });
const disconnectSchema = z.object({ outcome: z.enum(["revoked", "expired", "absent"]) });
const errorSchema = z.object({ error: z.string() });
const button = "min-h-11 rounded border border-zinc-700 px-3 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50";

export function GithubGitopsConnection() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema>["status"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("github_connection");
    if (outcome) {
      url.searchParams.delete("github_connection");
      window.history.replaceState(null, "", url);
      if (outcome === "connected") setNotice("GitHub authorization saved.");
      else setError("GitHub authorization did not complete. Try connecting again.");
    }
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const parsed = statusSchema.safeParse(await response.json());
      if (parsed.success && !controller.signal.aborted) setStatus(parsed.data.status);
    }).catch(() => { /* GitOps can still use the configured server token or push hook. */ });
    return () => controller.abort();
  }, []);

  async function change(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, { method });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = errorSchema.safeParse(body);
        throw new Error(parsed.success ? parsed.data.error : "GitHub authorization is unavailable.");
      }
      if (method === "POST") {
        const url = new URL(startSchema.parse(body).url);
        if (url.origin !== "https://github.com" || url.pathname !== "/login/oauth/authorize") throw new Error("GitHub authorization URL is invalid.");
        window.location.assign(url);
        return;
      }
      const { outcome } = disconnectSchema.parse(body);
      setStatus("disconnected");
      setNotice(outcome === "revoked" ? "GitHub authorization revoked." :
        outcome === "expired" ? "Unusable credentials removed. You can revoke the app authorization in GitHub settings." :
        "No GitHub credentials are stored.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "GitHub authorization is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  if ((!status || status === "not_configured") && !error && !notice) return null;
  return <section aria-label="GitHub authorization" className="space-y-2 rounded-xl border border-zinc-800 p-4">
    <h3 className="text-sm font-semibold text-white">GitHub authorization</h3>
    <p className="text-xs text-zinc-300">{status === "connected" ? "Connected for read-only GitOps in this operator account." :
      status === "reconnect" ? "This connection expired. Reconnect to read repositories." :
      "Connect a GitHub App to read GitOps files from its installed repositories."}</p>
    {status && status !== "not_configured" && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void change("POST")} className={button}>{status === "disconnected" ? "Connect GitHub" : "Reconnect GitHub"}</button>
      {status !== "disconnected" && <button type="button" disabled={busy} onClick={() => void change("DELETE")} className={button}>Disconnect GitHub</button>}
    </div>}
    {notice && <p role="status" className="text-xs text-emerald-200">{notice}</p>}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
  </section>;
}
