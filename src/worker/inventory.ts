import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { bootstrapDatabase } from "@/lib/db/bootstrap";
import { refreshRuntimeEnv } from "@/lib/config/runtime-env";
import { beatInventoryWorker, runNextInventoryJob } from "@/lib/inventory/service";
import { runDueExpiryChecks, runDueRotations } from "@/lib/rotation/service";
import { runDueConnectorScans } from "@/lib/connectors/schedule";

const processId = `${process.pid}-${randomUUID()}`;
const shutdown = new AbortController();
process.on("SIGINT", () => shutdown.abort());
process.on("SIGTERM", () => shutdown.abort());

const heartbeatMs = 30_000;
const idleDelayMs = 10_000;
let lastBeat = 0;
async function beat() {
  await beatInventoryWorker(processId);
  lastBeat = Date.now();
}

async function main() {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const boot = await bootstrapDatabase();
    if (!boot.success) throw new Error("Database unavailable");
    heartbeat = setInterval(() => { void beat().catch(() => {}); }, heartbeatMs);
    while (!shutdown.signal.aborted) {
      let worked = false;
      try {
        refreshRuntimeEnv();
        if (Date.now() - lastBeat >= heartbeatMs) await beat();
        worked = await runNextInventoryJob(shutdown.signal) || await runDueRotations() || await runDueExpiryChecks() || await runDueConnectorScans();
      } catch (error) {
        // Class and code only: messages can carry provider responses.
        const code = error && typeof error === "object" && "code" in error ? ` ${String((error as { code: unknown }).code)}` : "";
        console.error(`Inventory worker could not complete this pass (${error instanceof Error ? error.name : typeof error}${code}); retrying after a short delay`);
      }
      if (!worked && !shutdown.signal.aborted) {
        try { await delay(idleDelayMs, undefined, { signal: shutdown.signal }); }
        catch { /* Shutdown interrupts the idle wait. */ }
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await queryClient.end({ timeout: 5 });
  }
}

void main().catch(() => {
  console.error("Inventory worker stopped; inspect database and provider availability");
  process.exitCode = 1;
});
