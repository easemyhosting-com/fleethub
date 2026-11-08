import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { z } from "zod";

const composeSchema = z.object({
  services: z.record(z.string(), z.object({ depends_on: z.record(z.string(), z.unknown()).optional(), ports: z.array(z.unknown()).optional() })),
  volumes: z.record(z.string(), z.object({ name: z.string() })),
});

it("generates private bootstrap files once and refuses to overwrite them", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleethub-setup-test-"));
  const target = join(root, "new-install");
  const execute = promisify(execFile);
  try {
    const result = await execute(process.execPath, ["scripts/prepare-local-setup.mjs", "--directory", target]);
    const env = await readFile(join(target, ".env"), "utf8");
    const secret = /^FLEETHUB_AUTH_SECRET=([a-f0-9]{64})$/m.exec(env)?.[1];
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toContain("No containers were started");
    expect(result.stdout).toContain("--profile infisical or --profile cliproxy");
    expect(env).toContain("FLEETHUB_ONBOARDING_ALLOWED_ORIGINS=http://infisical:8080,http://cli-proxy-api:8317");
    expect((await stat(join(target, ".env"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(target, "cliproxy-config.yaml"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(target, "cliproxy-config.yaml"), "utf8")).toContain("logging-to-file: false");
    expect(JSON.parse(await readFile(join(target, "tailscale-status.json"), "utf8"))).toEqual({});
    await expect(execute(process.execPath, ["scripts/prepare-local-setup.mjs", "--directory", target])).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(target, ".env"), "utf8")).toBe(env);
    await expect(execute(process.execPath, ["scripts/prepare-local-setup.mjs", "--unknown"])).rejects.toMatchObject({ code: 2 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Compose resolves profiles without starting a daemon or any containers.
it.runIf(spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0)("resolves every existing/local service combination without renaming data volumes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fleethub-profiles-test-"));
  const target = join(root, "new-install");
  const execute = promisify(execFile);
  try {
    await execute(process.execPath, ["scripts/prepare-local-setup.mjs", "--directory", target]);
    const core = ["fleetdeck", "fleetdeck-db", "inventory-worker"];
    const vault = ["infisical", "infisical-db", "infisical-redis"];
    for (const profiles of [[], ["infisical"], ["cliproxy"], ["infisical", "cliproxy"], ["integrations"]]) {
      const args = ["compose", "-f", resolve("compose.yml"), "--project-name", "fleethub-profile-test", "--env-file", join(target, ".env"), ...profiles.flatMap(profile => ["--profile", profile]), "config", "--format", "json"];
      const { stdout } = await execute("docker", args, { env: { ...process.env, COMPOSE_PROFILES: "" } });
      const config = composeSchema.parse(JSON.parse(stdout));
      const expected = [...core, ...(profiles.includes("infisical") || profiles.includes("integrations") ? vault : []), ...(profiles.includes("cliproxy") || profiles.includes("integrations") ? ["cli-proxy-api"] : [])];
      expect(Object.keys(config.services).sort()).toEqual(expected.sort());
      expect(config.services.fleetdeck.depends_on).toHaveProperty("fleetdeck-db");
      expect(Object.keys(config.services.fleetdeck.depends_on ?? {})).toEqual(["fleetdeck-db"]);
      expect(config.volumes.fleetdeck_pg_data.name).toBe("fleethub-profile-test_fleetdeck_pg_data");
      if (config.services.infisical) {
        expect(config.volumes.infisical_pg_data.name).toBe("fleethub-profile-test_infisical_pg_data");
        expect(config.services["infisical-db"].ports).toBeUndefined();
        expect(config.services["infisical-redis"].ports).toBeUndefined();
      }
      if (config.services["cli-proxy-api"]) expect(config.volumes.cliproxy_auth.name).toBe("fleethub-profile-test_cliproxy_auth");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
