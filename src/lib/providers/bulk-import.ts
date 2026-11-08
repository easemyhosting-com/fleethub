import { credentialFields } from "@/lib/rotation/fields";

export interface BulkRow { line: number; providerId: string; label: string; config: Record<string, string>; problem: string | null }

/** Providers that can be pasted as one line each: provider, label, then the provider's fields in the order the Replace form uses (identifier first, secret last). */
export const bulkProviders = Object.keys(credentialFields).filter(id => id !== "oracle");

export function bulkLineHelp(): string[] {
  return bulkProviders.map(id => `${id}, label, ${credentialFields[id].map(field => field.key).join(", ")}`);
}

export function parseBulkLines(text: string): BulkRow[] {
  const rows: BulkRow[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s*[,\t]\s*/);
    const providerId = (parts[0] ?? "").toLowerCase();
    const fields = credentialFields[providerId];
    const base = { line: index + 1, providerId, label: parts[1] ?? "", config: {} as Record<string, string> };
    if (!bulkProviders.includes(providerId) || !fields) { rows.push({ ...base, problem: `Unknown provider "${providerId}". Use ${bulkProviders.join(", ")}` }); return; }
    // Secrets may contain commas, so everything after the identifiers belongs to the last field.
    const values = [...parts.slice(2, 2 + fields.length - 1), parts.slice(1 + fields.length).join(",")];
    const config = Object.fromEntries(fields.map((field, i) => [field.key, (values[i] ?? "").trim()]));
    const missing = fields.filter(field => !config[field.key]).map(field => field.key);
    rows.push({ ...base, config, problem: !base.label ? "Missing label" : missing.length ? `Missing ${missing.join(", ")}` : null });
  });
  return rows;
}
