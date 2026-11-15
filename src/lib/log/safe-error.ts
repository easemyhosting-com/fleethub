/**
 * Error class and code only, for server logs. Driver, provider and CLI messages can carry
 * SQL fragments, row values, identifiers, URLs or upstream bodies, so they are never logged.
 */
export function errorSummary(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const raw = error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined;
  const code = typeof raw === "string" || typeof raw === "number" ? String(raw).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) : "";
  return code ? `${name} ${code}` : name;
}
