/** Minutes between automatic scans. 0 is manual only. A connector without its own choice uses its kind's default. */
export const scanIntervalChoices = [0, 15, 60, 360, 1440] as const;
export const defaultScanInterval: Record<string, number> = { prometheus: 15, kubernetes: 360, docker: 360 };
export function effectiveScanInterval(kind: string, stored: number | null | undefined): number {
  return stored ?? defaultScanInterval[kind] ?? 0;
}

export interface ScheduleRow { kind: string; scanIntervalMinutes: number | null; lastScanAt: Date | null; scanRequestedAt: Date | null }
/** A requested rescan (Flux webhook) is always due; otherwise a connector is due when its interval has passed since the last scan, success or failure. */
export function scanIsDue(row: ScheduleRow, now: Date): boolean {
  if (row.scanRequestedAt) return true;
  const every = effectiveScanInterval(row.kind, row.scanIntervalMinutes);
  return every > 0 && (!row.lastScanAt || now.getTime() - row.lastScanAt.getTime() >= every * 60_000);
}

/** The most overdue first: requested rescans, then never scanned, then the oldest scan. */
export function nextDue<T extends ScheduleRow>(rows: T[], now: Date): T | null {
  const due = rows.filter(row => scanIsDue(row, now));
  due.sort((a, b) => Number(Boolean(b.scanRequestedAt)) - Number(Boolean(a.scanRequestedAt)) || (a.lastScanAt?.getTime() ?? 0) - (b.lastScanAt?.getTime() ?? 0));
  return due[0] ?? null;
}
