# Live connectors: Kubernetes (Flux, Argo CD, Helm), Docker, Prometheus (built 2026-11-05)

Deterministic: no LLM anywhere. Every connector reads the system that already knows (the cluster, the Docker daemon, the metrics API) and normalises it into the same projects, placements, declared footprint and measured usage. All calls are `GET`. Nothing is started, stopped, applied or written to the target.

## What each connector reads

| Connector | Reads | Project is... | Verified against |
| --- | --- | --- | --- |
| Kubernetes (any CD tool) | Deployments, StatefulSets, DaemonSets, Ingresses, PVCs, plus optional Flux and Argo CRDs | see precedence below | Flux and Argo docs and API types |
| Flux (inside Kubernetes) | `Kustomization.status.inventory.entries[].id` (`ns_name_group_Kind`), HelmRelease label `helm.toolkit.fluxcd.io/name` | the Kustomization or HelmRelease that applied it | fluxcd.io Kustomization and HelmRelease docs |
| Argo CD (inside Kubernetes) | `Application.status.resources[]` (`group, version, kind, namespace, name, status, health`) | the Application | Argo CD `ResourceStatus` Go type |
| Helm and other tools | `meta.helm.sh/release-name`, `app.kubernetes.io/instance`, `app.kubernetes.io/part-of` | the release or instance | Kubernetes recommended labels |
| Docker (Compose and plain) | `GET /containers/json`, plus `HostConfig` limits from `/containers/{id}/json` | the Compose project (`com.docker.compose.project`), else the container | Docker Engine API (from documentation memory, not re-fetched) |
| Prometheus-compatible | fixed PromQL over kube-state-metrics, cAdvisor and node_exporter metrics | n/a: measured usage per namespace or Compose project, and whole-host CPU and memory | kube-state-metrics and cAdvisor metric docs |

Grouping precedence on Kubernetes (strongest first): Argo Application resources, Flux Kustomization inventory, Flux or Helm labels, `app.kubernetes.io/instance`, `part-of`, then the namespace. No names are special-cased; platform detection uses only namespaces that exist in every distribution (kube-system, flux-system, argocd, cert-manager, monitoring and similar). Because every CD tool ends as Kubernetes objects, Rancher Fleet, Spinnaker or a plain `kubectl apply` are covered by the label and namespace fallbacks even without a dedicated connector.

## Safe by construction

- `GET` only, redirects refused, 8 MB body cap, 10 s timeout, no URL credentials, no cloud metadata addresses, https required unless the connector is explicitly marked `allowHttp` (for a docker-socket-proxy on a private network).
- Self-signed cluster CAs are supported by pasting the CA certificate; verification is never disabled.
- Kubernetes Secrets are never listed. Docker inspect output is reduced to `HostConfig.NanoCpus`, `Memory` and `MemoryReservation`; environment variables and mounts are discarded inside the client and never stored or returned.
- Credentials follow the same rule as provider accounts: **Infisical when its setup step is verified, otherwise the built-in encrypted store**. Only a `secret_refs` pointer is saved in the database (backend, project, path, secret name), never the value, and the API never returns it. If no secret store is verified the connector is refused (409). Removing a connector deletes its secret from whichever backend holds it.
- Dry run by default. `apply` registers only the slugs you select.

## Read-only Kubernetes access (example)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: fleethub-readonly, namespace: kube-system }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: fleethub-readonly }
rules:
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets"]
    verbs: ["get", "list"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list"]
  - apiGroups: ["kustomize.toolkit.fluxcd.io", "helm.toolkit.fluxcd.io", "argoproj.io"]
    resources: ["kustomizations", "helmreleases", "applications"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: fleethub-readonly }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: fleethub-readonly }
subjects: [{ kind: ServiceAccount, name: fleethub-readonly, namespace: kube-system }]
```

Create a long-lived token with `kubectl create token fleethub-readonly -n kube-system --duration=8760h` (or a token Secret for your Kubernetes version). Nothing here grants access to Secrets.

## Docker hosts and any other compute: what exists

Nothing needs an LLM and nothing needs a custom agent. Options, from least to most work for the host owner:

1. **Prometheus-compatible API (recommended, pull).** One query endpoint covers every kind of machine: node_exporter (any VM: CPU and memory), cAdvisor (Docker and Kubernetes containers, labelled by Compose project), kube-state-metrics (Kubernetes requests, limits, replicas). Grafana Alloy, Grafana Agent or Prometheus `remote_write` can ship these to Grafana Cloud, Mimir or any Prometheus, and FleetHub just queries that one URL. Grafana's datasource proxy (`/api/datasources/proxy/uid/<uid>/api/v1/query`) works as the URL with a Grafana service-account token. This is the connector built here.
2. **Docker Engine API behind a read-only proxy (pull).** The Docker socket is root-equivalent, so never expose it directly. Put a socket proxy in front that allows only `GET /containers` (for example Tecnativa's docker-socket-proxy with `CONTAINERS=1` and everything else off) and point the Docker connector at it. Gives containers, images, Compose project labels and limits.
3. **Push** (already built): any script or agent posts facts to `/api/observations` or the project hooks. Use when the host cannot be reached from FleetHub.
4. **Static files** (already built): Compose and Kubernetes manifests in Git through the GitOps reader, as a fallback when no live access is possible.

## Built

`src/lib/connectors/{kubernetes,docker,prometheus,clients,service}.ts`; routes `GET/POST/DELETE /api/connectors` and `POST /api/connectors/scan`; table `connectors`; `project_placements.scope`. Registration reuses the same `applyProposal` path as GitOps discovery, so evidence, kind and zone inference are identical. Measured usage becomes `project_usage_reports` rows (one per scope per quarter hour, idempotent) on placements whose scope matches.

Update 2026-11-06: the connector screen exists (Projects tab, "Connect a cluster, Docker host or metrics source"), including Tailscale discovery, measured host usage and a per-host page. The Docker socket proxy is optional: a host that already exports per-container metrics (for example through Alloy and textfile metrics) does not need it. The Prometheus URL keeps its path (Grafana Cloud needs `/api/prom`).

## Not built yet

Scheduled rescans (today a scan is operator-triggered), Rancher Fleet and Argo `ApplicationSet` specifics beyond the label fallbacks, Portainer/Coolify APIs, Terraform state, and Flux notification-controller webhooks as a "something changed, rescan now" trigger.

## Tests

`tests/connectors.test.ts` (normalisers on fixtures: Flux inventory, Argo, Helm, labels, Docker, Prometheus), `tests/connector-clients.test.ts` (local fake Kubernetes, Docker and Prometheus servers: GET only, pagination, optional CRDs, no env leakage, no redirects, URL policy), `tests/projects.integration.test.ts` (PostgreSQL: live registration, zone inference, measured usage idempotency).
