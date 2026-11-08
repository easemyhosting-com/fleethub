import { refreshRuntimeEnv } from "@/lib/config/runtime-env";

export type PairingPolicy = { enabled: boolean; qr: boolean; maxScope: "read" | "operator" };

const off = new Set(["0", "false", "off", "no", "disabled"]);
const isOff = (value: string | undefined) => value !== undefined && off.has(value.trim().toLowerCase());

export function pairingPolicy(env: Record<string, string | undefined> = process.env): PairingPolicy {
  if (env === process.env) refreshRuntimeEnv();
  return {
    enabled: !isOff(env.FLEETHUB_DEVICE_PAIRING),
    qr: !isOff(env.FLEETHUB_PAIRING_QR),
    maxScope: env.FLEETHUB_PAIRING_MAX_SCOPE?.trim().toLowerCase() === "read" ? "read" : "operator",
  };
}

export const scopeAllowed = (policy: PairingPolicy, scope: "read" | "operator") => scope === "read" || policy.maxScope === "operator";
