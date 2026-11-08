import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { consumeSharedLimit } from "../src/lib/auth/rate-limit";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("shared PostgreSQL rate limiter", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`DELETE FROM rate_limit_windows`;
  });
  afterAll(async () => { await queryClient`DELETE FROM rate_limit_windows`; await queryClient.end(); });

  it("is unlogged, so counters add no write-ahead log traffic", async () => {
    const [table] = await queryClient`SELECT relpersistence FROM pg_class WHERE relname = 'rate_limit_windows'`;
    expect(table.relpersistence).toBe("u");
  });

  it("never admits more than the limit under concurrent requests from separate connections", async () => {
    // A second pool stands in for another application replica sharing the database.
    const replica = postgres(process.env.DATABASE_URL ?? "", { max: 10 });
    try {
      const key = `itest:${Date.now()}`;
      const viaReplica = async () => {
        const [row] = await replica`
          INSERT INTO rate_limit_windows (key, window_start, count)
          VALUES (${key}, to_timestamp(floor(extract(epoch FROM clock_timestamp()) / 60) * 60), 1)
          ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_windows.count + 1 RETURNING count`;
        return { allowed: Number(row.count) <= 20 };
      };
      const results = await Promise.all(Array.from({ length: 60 }, (_, index) => index % 2 ? viaReplica() : consumeSharedLimit(key, 20)));
      // Requests straddling a minute boundary may start a fresh window, which can only admit more, never fewer than 20.
      const [{ total }] = await queryClient`SELECT SUM(count)::int AS total FROM rate_limit_windows WHERE key = ${key}`;
      expect(total).toBe(60);
      const windows = await queryClient`SELECT count FROM rate_limit_windows WHERE key = ${key}`;
      expect(results.filter(result => result.allowed).length).toBe(windows.reduce((sum, row) => sum + Math.min(Number(row.count), 20), 0));
    } finally { await replica.end(); }
  });

  it("starts a fresh window once the previous minute has passed", async () => {
    const key = `itest-window:${Date.now()}`;
    await queryClient`INSERT INTO rate_limit_windows (key, window_start, count) VALUES (${key}, date_trunc('minute', clock_timestamp()) - interval '1 minute', 99)`;
    expect(await consumeSharedLimit(key, 20)).toEqual({ allowed: true });
  });
});
