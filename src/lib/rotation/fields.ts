export type CredentialField = { key: string; label: string; secret: boolean; multiline?: boolean };

/** Form fields for replacing a provider's stored credentials. Non-secret fields must match the registered account. */
export const credentialFields: Record<string, readonly CredentialField[]> = {
  cloudflare: [{ key: "accountId", label: "Account ID", secret: false }, { key: "apiToken", label: "New API token", secret: true }],
  upstash: [{ key: "apiEmail", label: "Account email", secret: false }, { key: "apiKey", label: "New management API key", secret: true }],
  supabase: [{ key: "organizationId", label: "Organization ID", secret: false }, { key: "accessToken", label: "New access token", secret: true }],
  oracle: [{ key: "tenancyId", label: "Tenancy OCID", secret: false }, { key: "userId", label: "User OCID", secret: false }, { key: "region", label: "Region (for example ap-mumbai-1)", secret: false }, { key: "fingerprint", label: "New key fingerprint", secret: true }, { key: "privateKey", label: "New private key (PEM)", secret: true, multiline: true }],
  neon: [{ key: "organizationId", label: "Organization ID", secret: false }, { key: "apiKey", label: "New API key", secret: true }],
};
