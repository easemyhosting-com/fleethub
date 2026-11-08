# FleetHub operating model for safe assisted orchestration

Researched 2026-10-26. This document recommends the product direction. It distinguishes existing implementation from proposed execution features. No live server enrollment, SSH access, secret import, or network policy change is authorized by this research.

## Vision

FleetHub should own the inventory, connection workflow, policies, approvals, and audit history. It should integrate established network, vault, and automation software. It should not become a universal root shell, a second Tailscale control plane, or a new secrets vault.

The default journey is useful before automation is enabled: register resources, collect read-only observations where credentials are available, then opt individual hosts into narrowly defined operations. Installing Tailscale must not imply permission to schedule workloads. Saving an SSH key must not imply permission to use it.

## What a new user experiences

A user with one or two servers can start FleetHub locally, establish the operator account, and register those servers without changing them. They then choose a connection path:

| Path | Recommended use | Responsibility |
| --- | --- | --- |
| Guided self-enrollment | Safest initial default, especially production servers | FleetHub prepares the exact steps; the owner performs the first privileged action and confirms identity. |
| Assisted enrollment over existing SSH | Optional convenience for a selected non-production server | A reviewed, approved job verifies SSH identity, inspects the host, installs/enrolls Tailscale when needed, and proves the result. |
| Already enrolled host | Existing tailnet | FleetHub verifies identity and connectivity without reinstalling or changing access policy. |
| API-only provider | Cloudflare, Neon, Supabase, Upstash and similar services | Use the provider API with scoped credentials. No software is installed at that provider merely to list projects or quotas. |

Do not require users to manually configure every future host. Make the guided route understandable and the assisted route optional. The owner still controls the initial trust grant and the exact server that can change.

Before the first vault exists, prefer an owner-run bootstrap or transient local SSH-agent access. This avoids a circular dependency and does not justify storing temporary SSH secrets in PostgreSQL.

For an entirely new installation, the owner creates or selects their own tailnet and vault organization. A self-hosted FleetHub installation can help bootstrap local components, but it must preserve an external recovery route and backups. For this owner's OCI servers, only existing read access and inventory are permitted; assisted installation or task placement remains prohibited.

## Prerequisites should follow capabilities

The current implementation requires Tailscale, Infisical, and CLIProxy before any credentialed provider registration. That implements the owner's earlier instruction. Research suggests replacing that global rule with a capability policy, after the owner accepts the change:

| Capability | Required foundations |
| --- | --- |
| Manual inventory | Operator authentication only |
| Cloud API collection | Authentication, scoped provider credential reference, approved API destination |
| Private host collection | Authentication and a verified reachable private path; collector credentials only when necessary |
| SSH-assisted enrollment | Verified target and host key, explicit approval, transient or vault-backed SSH access, a restricted bootstrap executor |
| LLM inference routing | A verified CLIProxy connection and an appropriate inference credential |
| Remote resource mutation | Explicit target eligibility, scoped executor identity, fresh observations, exact approved operation |

Tailscale is the preferred private network for managed hosts, not a universal requirement for public SaaS APIs. CLIProxy is an LLM integration, not an authorization prerequisite for a database inventory API. Existing SSH over a separately secured connection can be used only for the bootstrap job; it is not a standing exemption from subsequent network policy.

The current global gate is intentionally preserved until this product-policy change is accepted. The next code increment is planning-only and does not weaken it.

## SSH-assisted enrollment

FleetHub can eventually perform this work, but through a separate executor rather than the web process. The proposed job is:

1. Select an existing registered host and confirm that it is eligible for changes. Production, protected, unknown-ownership, and OCI targets are denied under the current policy.
2. Verify its SSH host key against an owner-approved fingerprint from an independent trusted channel. `ssh-keyscan` alone cannot establish trust. Do not disable host-key checking or enable SSH agent forwarding.
3. Perform a read-only inspection of operating system, architecture, current Tailscale installation, privileges, and available recovery access.
4. Show a concrete plan with target identity, installer/version, required privilege, assigned tags, expected network changes, and rollback limits. Approval must bind this exact plan, expire, and be checked again before execution.
5. Run a reviewed installer or playbook in a short-lived worker. Mint a short-lived, single-use, tagged Tailscale enrollment credential where the owner's provisioning permissions permit it. Never pass the long-lived Tailscale OAuth client secret to the target. Keep existing DNS, default routes, subnet advertisements, exit-node settings, and SSH authentication unchanged unless a separate operation explicitly approves them. Show the interface and overlay routes inherent in enrollment in the reviewed plan.
6. Verify the resulting device identity and connectivity. Keep the original SSH path until a separate private-path check succeeds. Do not automatically close ports, change routes, enable an exit node, or replace SSH authentication.
7. Record the result, destroy temporary credential material, and remove or disable bootstrap privileges. Failed attempts must be resumable without duplicate devices or hidden configuration drift.

Tailscale supports one-use auth keys and scoped OAuth provisioning. Tags determine device identity and policy. Persistent servers should not inherit ephemeral-runner lifecycle settings. Revoking an enrollment key does not remove a device already enrolled; unenrollment is a separate operation. [Tailscale auth keys](https://tailscale.com/docs/features/access-control/auth-keys), [OAuth clients](https://tailscale.com/docs/features/oauth-clients)

Do not put all hosts into a shared FleetHub-owned tailnet. Each installation uses its owner's network. Tag ownership, grants, and permitted ports need explicit policy. Membership alone does not prove authorization. Cross-customer OAuth provisioning cannot be assumed: the documented OAuth-app device flow is limited to its own tailnet. [Device provisioning limitations](https://tailscale.com/docs/features/oauth-apps/device-provisioning)

## Reuse automation and SSH systems

Use OpenSSH for the connection layer and evaluate Ansible Core plus Ansible Runner for reviewed installation jobs. Runner supports process/container isolation. For one or two servers, a one-shot local runner is preferable to deploying a full automation-controller service by default. Reuse established idempotent package/service modules rather than constructing model-generated shell scripts. [Ansible](https://github.com/ansible/ansible), [Runner isolation](https://docs.ansible.com/projects/runner/en/latest/intro/)

Ansible privilege escalation can be broad. A reviewed playbook and container do not remove the privilege of the credential or the target's sudo configuration. Never accept user-supplied playbooks, unrestricted inventory scripts, arbitrary extra variables, or raw shell text through the web/MCP interface. Keep the web process away from Docker sockets, SSH agents, and executor credentials. [Ansible privilege escalation](https://docs.ansible.com/projects/ansible-core/devel/playbook_guide/playbooks_privilege_escalation.html)

Keep ordinary OpenSSH over Tailscale initially. Tailscale SSH is an optional alternative and must not be silently enabled: enabling it intercepts SSH traffic on the Tailscale address and can interrupt existing connections. Check mode is useful for human high-risk access, but unattended automation requires a separate deliberate policy. [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)

## Vault ownership and SSH material

The operator owns the vault, its organization/project administration, encryption recovery, and backups. FleetHub may manage a bounded namespace inside that vault. It should not administer every project, import unrelated application secrets, or rotate existing credentials merely because it can see them.

For an existing vault, prefer a dedicated FleetHub project. A dedicated folder in an existing project is acceptable only when the deployed edition's effective permissions really isolate it. Folder names alone are not a security boundary. Verify the runtime identity cannot read an operator-provided outside-scope test item. If effective restrictions cannot be established, use a separate project or refuse secret-consuming automation. Infisical documents folder-level tiers from listing through full access; feature availability and limits must be checked for the actual edition. [Folder permission model](https://infisical.com/blog/folder-based-rbac), [edition and identity limits](https://infisical.com/pricing)

Use stable identifiers beneath the managed scope, for example:

- `/accounts/<account-id>/inventory`
- `/hosts/<host-id>/ssh`
- `/bootstrap/tailscale`

These are proposed paths, not instructions to move existing secrets. Record the vault instance, project, environment, path, and key identifier in PostgreSQL. Never infer shared ownership from matching secret names or email addresses.

Offer SSH credentials in this preference order:

1. A local SSH agent or an owner-run bootstrap, when possible, so FleetHub never stores the private key.
2. A dedicated, limited FleetHub SSH account/key, optionally saved to the selected vault scope with explicit consent.
3. Short-lived SSH certificates through an existing trusted CA or Infisical SSH/PAM when available and appropriate.

Do not default to uploading a personal root key. A key passphrase or shared agent does not neutralize a compromised process that can use it. Separate inventory credentials from bootstrap and action credentials. Minimize the number of identities required for a small free installation, but do not claim isolation if the edition or role cannot provide it.

Infisical supports SSH key/password access and certificate-based sessions. Certificate authentication requires installing CA trust on the destination, which is itself a privileged approved change. PAM is an optional integration, not a mandatory free-tier dependency; verify its licensing and operating requirements. [Infisical SSH/PAM](https://infisical.com/docs/documentation/platform/pam/getting-started/resources/ssh), [SSH CLI](https://infisical.com/docs/cli/commands/ssh)

Application bootstrap credentials must remain outside the vault they unlock. The existing environment-based machine identity is such an exception. Provider or SSH secrets can pass transiently through a trusted broker/worker; this architecture must not be described as zero knowledge.

## LLM and MCP contract

An LLM client should ask FleetHub for inventory, observations, prerequisite status, and structured plans. It must not receive SSH keys, vault values, reusable enrollment keys, arbitrary URL-fetch tools, or a generic `run_command` operation.

Separate these stages:

- Read and plan: available to a read-only client within its resource scope.
- Approve: a human in the FleetHub UI or another strongly authenticated approval channel, independent of model text.
- Execute: a separate worker consumes a single-use approval bound to resource identity, operation, exact parameters, plan version, and expiry.

A model assertion such as "the user approved" is not authorization. Host banners, file contents, logs, and provider responses are untrusted data. They cannot expand permissions or replace an approved plan. Recheck protection and current state immediately before execution; use idempotency keys, bounded retries, cancellation, and secret-free audit events.

Use the official MCP SDK/transport rather than extending an ad hoc protocol indefinitely. Prefer a local stdio bridge for the first same-machine integration. Remote HTTP support needs the protocol's authorization and resource/audience checks, a secured origin, and per-client scopes. Do not forward a client's token unchanged into upstream APIs. [MCP authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization), [MCP security guidance](https://modelcontextprotocol.io/docs/draft/tutorials/security/security_best_practices)

The current `/api/mcp` is a limited JSON-RPC integration with static keys, not a claim that every MCP client can already connect with standard OAuth discovery. Planning tools added now remain read-only and cannot execute a plan.

## Build sequence

1. Implement a typed host-enrollment planning API and matching MCP planning tool. Accept only public target details and vault references. Return blockers, exact proposed operations, and required approval evidence. No SSH connection or remote action occurs.
2. Bind plans to authoritative registered hosts and immutable protection rules. Add a persistent approval/audit model and session revocation before enabling privileged execution.
3. Add scoped SSH credential references and an isolated, reviewed bootstrap runner. Test with disposable local VMs before supporting live servers. Prove host-key checking, restricted target selection, retries, credential cleanup, and recovery access.
4. Replace the global prerequisite gate with the accepted capability policy. Add API-only provider collection without unnecessary network/LLM dependencies.
5. Add optional CA/PAM integrations and policy-limited actions only where the operator explicitly enables them.

The immediate implementation is step 1. Automatic SSH installation is a planned capability, not enabled by this document or the new planning endpoint. The owner's OCI restriction remains in force throughout.

## First implementation delivered

The next bounded task was implemented after this research: `POST /api/host-enrollment/plan` and the `plan_host_enrollment` tool in the existing MCP bridge. Both accept public target details and optional credential-reference IDs. They return non-executable proposals with explicit blockers. They never open SSH, retrieve credentials, modify a host, mint an enrollment key, or create an approval.

Caller-supplied host metadata is explicitly unverified. Protected, production, and declared OCI targets produce inventory-only proposals. Describing a target as non-production cannot authorize execution; the planner always reports execution disabled and requires authoritative host-policy checks and a future approved worker. This distinction avoids turning a model's proposed plan into an access grant.

Verification on Node.js 24.22.1: 236 tests passed, six integration tests skipped by default, typecheck passed, and production build passed. Overall coverage is 98.11% statements and 98.72% lines. New regression tests cover default protection, OCI handling, raw-secret and command rejection, reference validation, API authentication, MCP read-only access, and absence of outbound network calls.

The existing global prerequisite gate was preserved. SSH execution, importing SSH keys, standard MCP transport/OAuth compatibility, persistent approvals, and capability-based prerequisite changes remain unimplemented. No live infrastructure or secrets were changed.

## Minimum coverage clarification

The [agent context contract](26-agent-context-contract.md) makes the minimum scope explicit: registered facts or an honest connection recipe for every relevant fleet category. FleetHub can remain decoupled from execution while supplying context to another agent. The read-only context endpoint and bridge tool are implemented; structured external observation writeback is implemented separately as unverified reports; see [the writeback contract](27-observation-writeback.md).

## Deferred exploration: secure assisted setup

Decision (2026-10-26): keep the current release small. Inventory, connection guidance, non-executable plans and unverified observation reporting are the supported boundary. Guided owner-run setup is the default. SSH-assisted Tailscale installation, SSH credential import/use, privileged workers, human approval workflows and automated infrastructure changes are deferred exploration, not commitments or enabled features.

Revisit this explicitly after the read-only foundation is stable. Before implementation, document a threat model and evaluate existing maintained tools against a disposable-host prototype. Demonstrate verified host fingerprints, least-privilege credentials and vault permissions, explicit target-bound approvals independent of model text, bounded execution, secret cleanup, auditability, revocation and recovery. Obtain an independent security review of that prototype before proposing live use. Failure to demonstrate these controls keeps execution disabled; a plan or a stored SSH reference never grants permission.

This exploration must preserve the owner's OCI production prohibition. It does not authorize changes to any live machine, vault or tailnet. Capability-specific provider prerequisites and standards-compliant MCP integration should be assessed separately so neither silently introduces execution privileges.
