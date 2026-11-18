import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// Simulates a file that grew after its metadata was read: every stat reports a small size while the content is over the limit.
const reads = vi.hoisted(() => ({ opened: 0, closed: 0, read: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: (path: string) => Object.assign(actual.statSync(path), { size: 32 }),
    fstatSync: (fd: number) => Object.assign(actual.fstatSync(fd), { size: 32 }),
    openSync: (...args: Parameters<typeof actual.openSync>) => { reads.opened += 1; return actual.openSync(...args); },
    readSync: (...args: Parameters<typeof actual.readSync>) => { reads.read += 1; return actual.readSync(...args); },
    closeSync: (fd: number) => { reads.closed += 1; actual.closeSync(fd); },
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
  expect(reads.closed).toBe(reads.opened);
});

it("does not read an unchanged file again", () => {
  const dir = mkdtempSync(join(tmpdir(), "fh-runtime-race-")); dirs.push(dir);
  const file = join(dir, "runtime.env");
  writeFileSync(file, "FLEETHUB_PAIRING_QR=off\n");
  const env: Record<string, string | undefined> = { FLEETHUB_RUNTIME_ENV_FILE: file };
  let clock = 0;
  const refresh = createRuntimeEnv({ env, now: () => (clock += 10_000), log: () => {} });
  expect(refresh()).toEqual(["FLEETHUB_PAIRING_QR"]);
  const before = reads.read;
  expect(refresh()).toEqual([]);
  expect(reads.read).toBe(before);
  expect(reads.closed).toBe(reads.opened);
});
