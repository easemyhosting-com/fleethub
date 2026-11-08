import type { HostStatus } from "./host";

export function formatCores(milli: number): string {
  const cores = milli / 1000;
  return `${Number(cores.toFixed(2))} ${cores === 1 ? "core" : "cores"}`;
}

export function formatGiB(mebi: number): string {
  const gib = mebi / 1024;
  return `${Number(gib.toFixed(1))} GiB`;
}

export function statusLabel(status: HostStatus): string {
  return ({ ok: "OK", tight: "Tight", over: "Over-requested", no_data: "No data", unknown_size: "Size unknown" })[status];
}

export function barPercentage(value: number | null, total: number | null): number {
  if (value === null || total === null || total <= 0 || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

export function validCpuAsk(value: string): boolean {
  return /^\d+(?:\.\d+)?m?$/.test(value.trim()) && Number.parseFloat(value) > 0;
}

export function validMemoryAsk(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:Ki|Mi|Gi)?$/.test(value.trim()) && Number.parseFloat(value) > 0;
}
