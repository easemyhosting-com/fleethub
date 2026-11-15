import type { GitopsFile } from "./parse";
import { readBoundedJson, readBoundedText, ResponseTooLargeError } from "@/lib/http/bounded";
import { maxFileBytes, maxFiles } from "./parse";

const repoShape = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const isRepo = (value: string) => repoShape.test(value);
export class GithubError extends Error { constructor(readonly code: "not_configured" | "unauthorized" | "not_found" | "rate_limited" | "unavailable" | "too_large") { super(code); } }

async function api(path: string, token: string, signal: AbortSignal, raw = false): Promise<Response> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "fleethub-readonly" },
    redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (response.status === 401 || response.status === 403) throw new GithubError(response.headers.get("x-ratelimit-remaining") === "0" ? "rate_limited" : "unauthorized");
  if (response.status === 404) throw new GithubError("not_found");
  if (response.status === 429) throw new GithubError("rate_limited");
  if (!response.ok) throw new GithubError("unavailable");
  return response;
}

const maxTreeBytes = 8 * 1024 * 1024;
/** Oversized or malformed bodies become typed GitHub errors, never raw parser or stream errors. */
async function bounded<T>(request: Promise<Response>, read: (response: Response) => Promise<T>): Promise<T> {
  const response = await request;
  try { return await read(response); }
  catch (error) { throw new GithubError(error instanceof ResponseTooLargeError ? "too_large" : "unavailable"); }
}

/** Read-only fetch of YAML files under a path. The token comes from FLEETHUB_GITHUB_READ_TOKEN (a fine-grained, contents:read token) and never leaves the server. */
export async function fetchRepoFiles(repo: string, branch: string, path: string, signal: AbortSignal, token = process.env.FLEETHUB_GITHUB_READ_TOKEN?.trim()): Promise<GitopsFile[]> {
  if (!token) throw new GithubError("not_configured");
  const tree = await bounded(api(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token, signal), response => readBoundedJson(response, maxTreeBytes)) as { truncated?: boolean; tree?: Array<{ path: string; type: string; size?: number }> } | null;
  if (!tree || !Array.isArray(tree.tree)) throw new GithubError("unavailable");
  const prefix = path.replace(/^\/+|\/+$/g, "");
  const wanted = tree.tree.filter(item => item.type === "blob" && /\.ya?ml$/i.test(item.path) && (prefix === "" || item.path === prefix || item.path.startsWith(`${prefix}/`)) && (item.size ?? 0) <= maxFileBytes);
  if (wanted.length > maxFiles) throw new GithubError("too_large");
  const files: GitopsFile[] = [];
  for (const item of wanted) {
    const content = await bounded(api(`/repos/${repo}/contents/${item.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, token, signal, true), response => readBoundedText(response, maxFileBytes));
    files.push({ path: item.path, content });
  }
  return files;
}
