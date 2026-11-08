export const MAX_GITOPS_FILE_BYTES = 200 * 1024;
export const MAX_GITOPS_FILES = 600;

export type BrowserManifestFile = { path: string; content: string };
export type FileSkip = { path: string; reason: string };
export type BrowserSelection = { files: File[]; skipped: FileSkip[] };

const forbiddenName = /(secret|sealed|credential|token|password|\.pem$|\.key$|\.crt$|\.p12$|(^|\/)\.env)/i;

/** Strip the browser's chosen directory name and reject unsafe/irrelevant file metadata before reading. */
export function filterGitopsFiles(input: Iterable<Pick<File, "name" | "size" | "webkitRelativePath">>): BrowserSelection {
  const files: File[] = [];
  const skipped: FileSkip[] = [];
  let acceptedCount = 0;
  for (const file of input) {
    const relative = file.webkitRelativePath || file.name;
    const path = relative.split("/").slice(1).join("/") || file.name;
    if (/(^|\/)\.git\//i.test(relative) || /(^|\/)node_modules\//i.test(relative)) {
      skipped.push({ path, reason: "ignored directory" });
    } else if (forbiddenName.test(path) || forbiddenName.test(file.name)) {
      skipped.push({ path, reason: "secret-looking name; file was not read" });
    } else if (!/\.ya?ml$/i.test(file.name)) {
      skipped.push({ path, reason: "not a YAML manifest" });
    } else if (file.size > MAX_GITOPS_FILE_BYTES) {
      skipped.push({ path, reason: "larger than 200 KB" });
    } else if (acceptedCount >= MAX_GITOPS_FILES) {
      skipped.push({ path, reason: "file limit reached (600 files)" });
    } else {
      acceptedCount += 1;
      files.push(file as File);
    }
  }
  return { files, skipped };
}

export type HostRequestTotals = Record<string, { cpuMilli: number; memoryMi: number }>;

/** Sum declared requests only for selected projects, once per host placement. */
export function hostRequestTotals<T extends { slug: string; placements: Array<{ host: string; declared: { cpuRequestMilli: number; memRequestMi: number } }> }>(projects: T[], selectedSlugs: Iterable<string>): HostRequestTotals {
  const selected = new Set(selectedSlugs);
  const totals: HostRequestTotals = {};
  for (const project of projects) {
    if (!selected.has(project.slug)) continue;
    for (const placement of project.placements) {
      const total = totals[placement.host] ??= { cpuMilli: 0, memoryMi: 0 };
      total.cpuMilli += placement.declared.cpuRequestMilli;
      total.memoryMi += placement.declared.memRequestMi;
    }
  }
  return totals;
}

export function relativeManifestPath(file: Pick<File, "name" | "webkitRelativePath">): string {
  const relative = file.webkitRelativePath || file.name;
  return relative.split("/").slice(1).join("/") || file.name;
}
