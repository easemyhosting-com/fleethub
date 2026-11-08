import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeEnv, parseEnvFile } from "../src/lib/config/runtime-env";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup(initial: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fh-runtime-")); dirs.push(dir);
  const file = join(dir, "runtime.env");
  const env: Record<string, string | undefined> = { FLEETHUB_RUNTIME_ENV_FILE: file, ...initial };
  const logs: string[] = [];
  let clock = 0; let version = 1;
  const refresh = createRuntimeEnv({ env, now: () => (clock += 10_000), log: (m) => logs.push(m) });
  const write = (text: string) => { writeFileSync(file, text); utimesSync(file, version, version); version += 1; };
  return { env, refresh, write, file, logs };
}

describe("runtime env parsing", () => {
  it("parses assignments, quotes and export prefixes and skips comments and junk", () => {
    expect(parseEnvFile('# c\n\nexport A_B="x y"\nC=\'z\'\nD=plain\nlower=no\nbad line\nE=')).toEqual({ A_B: "x y", C: "z", D: "plain", E: "" });
    expect(parseEnvFile(`BIG=${"x".repeat(5000)}`)).toEqual({});
  });
});

describe("runtime env refresh", () => {
  it("does nothing without a configured file", () => {
    const env: Record<string, string | undefined> = {};
    expect(createRuntimeEnv({ env })()).toEqual([]);
  });
  it("applies allowlisted keys, names but never values in logs, and ignores other keys", () => {
    const { env, refresh, write, logs } = setup();
    write("FLEETHUB_PAIRING_QR=off\nFLEETHUB_AUTH_SECRET=evil\nDATABASE_URL=evil\nFLEETHUB_AUTH_REQUIRED=false\nTAILSCALE_API_TOKEN=tskey-secret\n");
    expect(refresh()).toEqual(["FLEETHUB_PAIRING_QR", "TAILSCALE_API_TOKEN"]);
    expect(env.FLEETHUB_PAIRING_QR).toBe("off");
    expect(env.FLEETHUB_AUTH_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.FLEETHUB_AUTH_REQUIRED).toBeUndefined();
    expect(logs.join()).toContain("FLEETHUB_PAIRING_QR");
    expect(logs.join()).not.toContain("tskey-secret");
  });
  it("picks up edits, is idempotent when unchanged, and restores the original when a key is removed", () => {
    const { env, refresh, write } = setup({ FLEETHUB_PAIRING_QR: "on" });
    write("FLEETHUB_PAIRING_QR=off\n");
    refresh();
    expect(env.FLEETHUB_PAIRING_QR).toBe("off");
    expect(refresh()).toEqual([]);
    write("FLEETHUB_PAIRING_QR=off\nFLEETHUB_DEVICE_PAIRING=off\n");
    expect(refresh()).toEqual(["FLEETHUB_DEVICE_PAIRING"]);
    write("# empty\n");
    expect(refresh()).toEqual(["FLEETHUB_DEVICE_PAIRING", "FLEETHUB_PAIRING_QR"]);
    expect(env.FLEETHUB_PAIRING_QR).toBe("on");
    expect(env.FLEETHUB_DEVICE_PAIRING).toBeUndefined();
  });
  it("restores originals when the file disappears and tolerates a missing file", () => {
    const { env, refresh, write, file } = setup();
    expect(refresh()).toEqual([]);
    write("FLEETHUB_PAIRING_MAX_SCOPE=read\n");
    refresh();
    unlinkSync(file);
    expect(refresh()).toEqual(["FLEETHUB_PAIRING_MAX_SCOPE"]);
    expect(env.FLEETHUB_PAIRING_MAX_SCOPE).toBeUndefined();
    expect(refresh()).toEqual([]);
  });
  it("throttles checks to the interval", () => {
    const dir = mkdtempSync(join(tmpdir(), "fh-runtime-")); dirs.push(dir);
    const file = join(dir, "runtime.env"); writeFileSync(file, "FLEETHUB_PAIRING_QR=off\n");
    const env: Record<string, string | undefined> = { FLEETHUB_RUNTIME_ENV_FILE: file };
    let clock = 5000;
    const refresh = createRuntimeEnv({ env, now: () => clock, intervalMs: 1000, log: () => {} });
    expect(refresh()).toEqual(["FLEETHUB_PAIRING_QR"]);
    writeFileSync(file, "FLEETHUB_PAIRING_QR=on\n"); utimesSync(file, 99, 99);
    clock += 500; expect(refresh()).toEqual([]); expect(env.FLEETHUB_PAIRING_QR).toBe("off");
    clock += 600; expect(refresh()).toEqual(["FLEETHUB_PAIRING_QR"]); expect(env.FLEETHUB_PAIRING_QR).toBe("on");
  });
  it("ignores an oversized file", () => {
    const { env, refresh, write, logs } = setup();
    write(`FLEETHUB_PAIRING_QR=off\n${"#".repeat(70_000)}\n`);
    expect(refresh()).toEqual([]);
    expect(env.FLEETHUB_PAIRING_QR).toBeUndefined();
    expect(logs.join()).toContain("ignored");
  });
});

describe("shared runtime env state", () => {
  it("is shared across module copies so originals survive and reloads are logged once", () => {
    const dir = mkdtempSync(join(tmpdir(), "fh-runtime-")); dirs.push(dir);
    const file = join(dir, "runtime.env"); writeFileSync(file, "FLEETHUB_PAIRING_QR=off\n");
    const env: Record<string, string | undefined> = { FLEETHUB_RUNTIME_ENV_FILE: file, FLEETHUB_PAIRING_QR: "on" };
    const logs: string[] = []; let clock = 0;
    const first = createRuntimeEnv({ env, now: () => (clock += 5000), log: (m) => logs.push(m) }, true);
    const second = createRuntimeEnv({ env, now: () => (clock += 5000), log: (m) => logs.push(m) }, true);
    expect(first()).toEqual(["FLEETHUB_PAIRING_QR"]);
    expect(second()).toEqual([]);
    writeFileSync(file, "# none\n"); utimesSync(file, 500, 500);
    expect(second()).toEqual(["FLEETHUB_PAIRING_QR"]);
    expect(env.FLEETHUB_PAIRING_QR).toBe("on");
    expect(logs).toHaveLength(2);
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("fleethub.runtime-env")];
  });
});
