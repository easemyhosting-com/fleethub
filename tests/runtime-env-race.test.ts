import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// Simulates a file that grew after its metadata was read: every stat reports a small size while the content is over the limit.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: (path: string) => Object.assign(actual.statSync(path), { size: 32 }),
    fstatSync: (fd: number) => Object.assign(actual.fstatSync(fd), { size: 32 }),
  };
});

const { createRuntimeEnv } = await import("../src/lib/config/runtime-env");

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("never applies content beyond the limit even when metadata understates the size", () => {
  const dir = mkdtempSync(join(tmpdir(), "fh-runtime-race-")); dirs.push(dir);
  const file = join(dir, "runtime.env");
  writeFileSync(file, `FLEETHUB_PAIRING_QR=off\n${"#".repeat(70_000)}\n`);
  const env: Record<string, string | undefined> = { FLEETHUB_RUNTIME_ENV_FILE: file };
  const logs: string[] = [];
  expect(createRuntimeEnv({ env, now: () => 10_000, log: (message) => logs.push(message) })()).toEqual([]);
  expect(env.FLEETHUB_PAIRING_QR).toBeUndefined();
  expect(logs.join()).toContain("ignored");
});
