const codePattern = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function buildPairLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/pair#code=${encodeURIComponent(code)}`;
}

export function parsePairHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("code")?.trim().toUpperCase() ?? "";
  return codePattern.test(value) ? value : null;
}

export function formatRemaining(expiresAt: string, now = Date.now()): string | null {
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const seconds = Math.ceil(remaining / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export type PairingState = { id: string; status: "pending" | "expired" | "used" | "cancelled"; label: string; scope: "read" | "operator" };

export function connectionResult(createdId: string | null, pairings: PairingState[]): { kind: "waiting" } | { kind: "connected"; label: string; scope: "read" | "operator" } | { kind: "ended"; reason: "expired" | "cancelled" } | { kind: "none" } {
  if (!createdId) return { kind: "none" };
  const match = pairings.find(item => item.id === createdId);
  if (!match) return { kind: "none" };
  if (match.status === "used") return { kind: "connected", label: match.label, scope: match.scope };
  if (match.status === "expired" || match.status === "cancelled") return { kind: "ended", reason: match.status };
  return { kind: "waiting" };
}
