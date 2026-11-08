import { queryClient } from "@/lib/db/client";

const windowSeconds = 60;

// Atomic per-minute counter in FleetHub's own PostgreSQL, shared by every application instance. The upsert takes a row
// lock, so concurrent requests cannot both read a stale count; the database clock keeps instances on one window.
// Errors propagate so callers deny the request rather than allow it.
export async function consumeSharedLimit(identity: string, maximum: number): Promise<{ allowed: boolean }> {
  const [row] = await queryClient`
    INSERT INTO rate_limit_windows (key, window_start, count)
    VALUES (${identity}, to_timestamp(floor(extract(epoch FROM clock_timestamp()) / ${windowSeconds}) * ${windowSeconds}), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_windows.count + 1
    RETURNING count`;
  if (Math.random() < 0.01) await queryClient`DELETE FROM rate_limit_windows WHERE window_start < clock_timestamp() - interval '5 minutes'`.catch(() => undefined);
  return { allowed: Number(row.count) <= maximum };
}
