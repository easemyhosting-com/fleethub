import type { FreebieEntry } from "./schema";

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
const region = (value: boolean | null) => value === true ? "yes" : value === false ? "no" : "not stated";

/** Render one provider's entries as the committed doc. `npm run docs:freebies` writes it; a test fails on drift. */
export function renderFreebiesMarkdown(providerName: string, entries: readonly FreebieEntry[]): string {
  const lines = [
    `# ${providerName} free tier`,
    "",
    "<!-- Generated from src/lib/catalog/freebies by `npm run docs:freebies`. Edit the data, not this file. -->",
    "",
    "Provider statements only, not measured usage. Search and filter these entries in FleetHub at `/freebies`.",
    "",
    "| ID | Service | Category | Free limit | Scope | Home region only | Status | Verified | Source |",
    "|---|---|---|---|---|---|---|---|---|",
    ...entries.map(entry => `| \`${entry.id}\` | ${cell(entry.service)} | ${entry.category} | ${cell(entry.limit.note)} | ${entry.scope.replace("_", " ")} | ${region(entry.homeRegionOnly)} | ${entry.verification} | ${entry.verifiedAt} | [link](${entry.sourceUrl}) |`),
    "",
    "## Caveats and suggested uses",
    "",
  ];
  for (const entry of entries) {
    if (!entry.caveats.length && !entry.suggestedUses.length && !entry.fitTags.length) continue;
    lines.push(`### ${entry.service} (\`${entry.id}\`)`, "");
    for (const caveat of entry.caveats) lines.push(`- **${caveat.kind.replace("_", " ")}:** ${caveat.text}${caveat.sharesWith?.length ? ` Shares with ${caveat.sharesWith.map(id => `\`${id}\``).join(", ")}.` : ""}`);
    if (entry.suggestedUses.length) lines.push(`- **Uses:** ${entry.suggestedUses.join("; ")}.`);
    if (entry.fitTags.length) lines.push(`- **Fit tags:** ${entry.fitTags.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
