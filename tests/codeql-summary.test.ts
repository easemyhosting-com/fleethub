import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";

const execute = promisify(execFile);

const run = async (directory: string, env: Record<string, string> = {}) => {
  try {
    const result = await execute(process.execPath, ["scripts/codeql-summary.mjs", directory], { env: { ...process.env, CODEQL_UPLOAD: "", ...env } });
    return { code: 0, stdout: result.stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
};

const sarif = (results: unknown[]) => JSON.stringify({
  version: "2.1.0",
  runs: [{
    tool: { driver: { name: "CodeQL", rules: [{ id: "js/xss", properties: { "security-severity": "7.8" } }] } },
    results,
  }],
});

const finding = { ruleId: "js/xss", level: "error", message: { text: "Reflected  cross-site\nscripting" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/app/page.tsx" }, region: { startLine: 12 } } }] };

it("reports that there is nothing to summarize when CodeQL wrote no results", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleethub-codeql-empty-"));
  try {
    const missing = await run(join(root, "missing"));
    expect(missing.code).toBe(0);
    expect(missing.stdout).toContain("No SARIF results found");

    await mkdir(join(root, "results", "javascript"), { recursive: true });
    const empty = await run(join(root, "results"));
    expect(empty.code).toBe(0);
    expect(empty.stdout).toContain("No SARIF results found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("prints findings from every analysis result file and states that they were not uploaded", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleethub-codeql-findings-"));
  try {
    await mkdir(join(root, "results", "javascript"), { recursive: true });
    await writeFile(join(root, "results", "javascript", "results.sarif"), sarif([finding]));
    await mkdir(join(root, "results", "actions"), { recursive: true });
    await writeFile(join(root, "results", "actions", "results.sarif"), sarif([{ ...finding, ruleId: "actions/unpinned-tag", level: "warning", locations: [] }]));

    const { code, stdout } = await run(join(root, "results"));
    expect(code).toBe(0);
    expect(stdout).toContain("CodeQL reported 2 finding(s) across 2 analysis result file(s):");
    expect(stdout).toContain("[error] js/xss (security-severity 7.8) src/app/page.tsx:12 :: Reflected cross-site scripting");
    expect(stdout).toContain("[warning] actions/unpinned-tag (security-severity n/a) (unknown):? ::");
    expect(stdout).toContain("Results were not uploaded");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("confirms the upload when code scanning is enabled and no findings exist", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleethub-codeql-upload-"));
  try {
    await mkdir(join(root, "results"), { recursive: true });
    await writeFile(join(root, "results", "javascript.sarif"), sarif([]));
    const { code, stdout } = await run(join(root, "results"), { CODEQL_UPLOAD: "true" });
    expect(code).toBe(0);
    expect(stdout).toContain("CodeQL reported no findings across 1 analysis result file(s).");
    expect(stdout).toContain("Results were uploaded to code scanning.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("fails loudly on a corrupt result file instead of hiding it", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleethub-codeql-corrupt-"));
  try {
    await mkdir(join(root, "results"), { recursive: true });
    await writeFile(join(root, "results", "javascript.sarif"), "{not json");
    const { code, stderr } = await run(join(root, "results"));
    expect(code).not.toBe(0);
    expect(stderr).toContain("SyntaxError");
  } finally { await rm(root, { recursive: true, force: true }); }
});
