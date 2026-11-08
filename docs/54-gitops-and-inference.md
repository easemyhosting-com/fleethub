# GitOps ingestion and inference (built 2026-11-05)

Part of [docs/52](52-projects-needs-usage-and-gitops.md) steps 5 and 7 (read side). FleetHub reads desired state from a GitOps repo; it never writes to the repo, never applies anything, and never starts, stops or provisions.

## Two ways in, one reconcile

1. **Push (no token stored in FleetHub):** a CI job in the GitOps repo posts its YAML to `POST /api/hooks/gitops` with a project key. Body `{files:[{path, content}]}`, at most 200 files, 200 KB each, 2 MB total. Links are written only for the key's own project. Same auth, timestamp window and rate limit as the other hooks.
2. **Pull (operator-triggered):** `POST /api/gitops/sync {projectId, repo, branch?, path?}` reads YAML under a path through the GitHub API, read-only. It needs `FLEETHUB_GITHUB_READ_TOKEN` on the server (a fine-grained token with Contents: read on that one repository). Without it the route answers 409 with instructions; the token is never sent to the browser.

Both call `syncProjectFromFiles` (`src/lib/gitops/sync.ts`).

## What is read (`src/lib/gitops/parse.ts`)

Multi-document Kubernetes and Flux YAML: kind, name, namespace, container images, hosts from Ingress rules, HTTPRoute hostnames, Certificate dnsNames and `spec.host`, and the annotation `fleethub.dev/uses: "kv:abc, borealis"`. Plus an optional `fleethub.yaml` per app:

```yaml
project: shopfront        # optional; must match the project the key or sync belongs to
uses:
  - resource: shopfront-cache   # resource id, native id (kv:abc), or an unambiguous name
    purpose: edge cache
```

Parsing is bounded and defensive: unsafe paths, non-YAML, oversized files, broken YAML and alias bombs are reported under `skipped` with a reason and never trusted. Strict schema for `fleethub.yaml` (unknown keys rejected).

## Inference (`src/lib/gitops/infer.ts`), strongest first

| Source | Evidence | Confidence | Status |
| --- | --- | --- | --- |
| `gitops` | declared in `fleethub.yaml` or the `fleethub.dev/uses` annotation | 1.0 | in_use |
| `inferred` | a manifest host sits under a registered zone | 0.7 | suggested |
| `inferred` | resource name contains the project slug (slug of 4+ characters; labelled "guess") | 0.35 | suggested |

Every link stores its evidence sentence, so "why does project X use this" has an answer. Ambiguous names resolve to nothing instead of guessing.

## Reconcile rules

- Only `gitops` and `inferred` links are managed. `declared` links (from usage reports) are never touched.
- Links not seen in a run become `stale`, not deleted, so history and disagreement stay visible.
- Owner decisions (`POST /api/projects/links {projectId, resourceId, decision: confirm|reject|clear}`, operator only) are remembered in `project_link_decisions`: reject removes the inferred link and it is not suggested again; confirm keeps it at confidence 1 across syncs.

## Not built yet

Cloudflare Worker bindings as evidence (needs the Workers settings API), observed traffic, Flux Kustomization health, drift ("manifest says it runs on a stopped node"), and opening pull requests back to the repo (M4). A GitHub App or per-repo stored token instead of the env token.

## Tests

`tests/gitops.test.ts` (parser limits, inference ranking, name resolution), `tests/project-hooks.test.ts` (gitops hook auth and project scoping), `tests/projects.integration.test.ts` (PostgreSQL: reconcile, rejection memory, confirmation, stale marking, declared links untouched).
