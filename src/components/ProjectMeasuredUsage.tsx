import type { ProjectMeasurement } from "@/lib/projects/measurements";
import { formatGiB } from "@/lib/capacity/view";

/** Measurements are separate from declared reservations; each reading names its host and scope. */
export function ProjectMeasuredUsage({ readings }: { readings: ProjectMeasurement[] }) {
  if (!readings.length) return null;
  return <ul className="mt-2 space-y-2 text-xs text-sky-200" aria-label="Measured project usage">{readings.map(reading =>
    <li key={`${reading.hostRef}-${reading.kind}`} className="min-w-0 break-words">
      <p className={reading.stale ? "text-amber-200" : "text-sky-200"}>{reading.stale ? "Last measured, over an hour ago" : "Measured usage"} · {reading.hostRef.replace(/^host:/, "")} · {reading.kind === "containers" ? "container snapshot" : "CPU 15 min average"}</p>
      <p>{reading.cpuCores === null ? "CPU unknown" : `${reading.cpuCores.toFixed(3)} CPU cores`} · {reading.memMi === null ? "memory unknown" : `${reading.memMi < 1024 ? `${reading.memMi} MiB` : formatGiB(reading.memMi)} memory`}</p>
      <p className="text-zinc-400">{[...reading.scopes, ...reading.containers].join(", ")} · {new Date(reading.measuredAt).toLocaleString()}</p>
    </li>)}</ul>;
}
