import fs from 'node:fs/promises';
import path from 'node:path';

// CodeQL can analyze the code without uploading SARIF, which is what happens when
// code scanning is unavailable for a private repository. This prints the findings
// that would otherwise only be visible in the code scanning UI.
const root = path.resolve(process.argv[2] ?? 'results');

const findSarifFiles = async directory => {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findSarifFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith('.sarif')) files.push(entryPath);
  }
  return files.sort();
};

const levelRank = { error: 0, warning: 1, note: 2, none: 3 };
const sarifFiles = await findSarifFiles(root);
if (sarifFiles.length === 0) {
  console.log(`No SARIF results found under ${root}.`);
  process.exit(0);
}

const findings = [];
for (const file of sarifFiles) {
  const sarif = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const run of sarif.runs ?? []) {
    const rules = new Map((run.tool?.driver?.rules ?? []).map(rule => [rule.id, rule]));
    for (const result of run.results ?? []) {
      const ruleId = result.ruleId ?? 'unknown';
      const rule = rules.get(ruleId);
      const location = result.locations?.[0]?.physicalLocation;
      findings.push({
        level: result.level ?? 'warning',
        score: rule?.properties?.['security-severity'] ?? 'n/a',
        ruleId,
        source: `${location?.artifactLocation?.uri ?? '(unknown)'}:${location?.region?.startLine ?? '?'}`,
        message: (result.message?.text ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
  }
}

findings.sort((a, b) => (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9) || a.ruleId.localeCompare(b.ruleId));
if (findings.length === 0) {
  console.log(`CodeQL reported no findings across ${sarifFiles.length} analysis result file(s).`);
} else {
  console.log(`CodeQL reported ${findings.length} finding(s) across ${sarifFiles.length} analysis result file(s):`);
  for (const finding of findings) {
    const message = finding.message.length > 200 ? `${finding.message.slice(0, 197)}...` : finding.message;
    console.log(`- [${finding.level}] ${finding.ruleId} (security-severity ${finding.score}) ${finding.source} :: ${message}`);
  }
}
if (process.env.CODEQL_UPLOAD === 'true') {
  console.log('Results were uploaded to code scanning.');
} else {
  console.log('Results were not uploaded: set the CODEQL_UPLOAD repository variable to true after enabling code scanning.');
}
