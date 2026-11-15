import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { parseArgs } from "node:util";
import { queryClient } from "@/lib/db/client";
import { MasterKeyRotationError, rotateBuiltinMasterKey } from "@/lib/vault/master-key-rotation";

async function keyFile(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0) throw new Error("Invalid private key file");
    const data = await handle.readFile();
    try { return data.toString("utf8").replace(/\r?\n$/, ""); }
    finally { data.fill(0); }
  } finally { await handle.close(); }
}

try {
  const { values } = parseArgs({ options: {
    "old-key-file": { type: "string" }, "new-key-file": { type: "string" }, "offline-maintenance": { type: "boolean" },
  }, strict: true, allowPositionals: false });
  if (!process.env.DATABASE_URL || !values["old-key-file"] || !values["new-key-file"] || values["offline-maintenance"] !== true) {
    throw new MasterKeyRotationError("maintenance_required");
  }
  const result = await rotateBuiltinMasterKey(queryClient, {
    oldKey: await keyFile(values["old-key-file"]), newKey: await keyFile(values["new-key-file"]),
    maintenanceConfirmed: true, signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(error instanceof MasterKeyRotationError ? error.message + "\n" : "Master-key rotation failed; verify private inputs and database availability\n");
  process.exitCode = 1;
} finally { await queryClient.end(); }
