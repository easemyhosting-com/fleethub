/** Which fields of each provider's credential are secret. Everything else identifies the account and must not change on replacement. */
const secretFields: Record<string, readonly string[]> = {
  cloudflare: ["apiToken"],
  upstash: ["apiKey"],
  supabase: ["accessToken"],
  neon: ["apiKey"],
  // A new API key has a new fingerprint, so both change on rotation while tenancy, user and region identify the account.
  oracle: ["privateKey", "fingerprint"],
};

export function secretFieldsOf(providerId: string): readonly string[] { return secretFields[providerId] ?? []; }

export function scopeOf(providerId: string, config: Record<string, unknown>): string {
  const hidden = new Set(secretFieldsOf(providerId));
  const scope = Object.entries(config).filter(([key]) => !hidden.has(key)).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(scope);
}
