# Repository and release workflow

> Current local migration boundary: earlier publication, protection and PR snapshots
> below are historical evidence. They do not establish current remote state or authorize
> pushes, merges or repository migration. Follow the current session's migration gates.
> Linear is the intended planning/status source; GitHub remains the code, review, release
> and durable technical-documentation source. Tracker onboarding has not been verified.

Verified 2026-11-15 against GitHub repository metadata and public main `b7e032b`.

## Canonical repository

Code, durable technical documentation, reviews and releases belong to
[easemyhosting-com/fleethub](https://github.com/easemyhosting-com/fleethub).
It is public. It was published with fresh audited history, rather than transferring
or making the original private development repository public. The two repositories
are independent, not a GitHub fork pair.

The original private repository is a historical development/reconciliation record.
An open PR there does not mean that the public project moved back. Private CI
results and merges do not update the public repository. Repository variables,
runners, protections and installed review apps are separate in each repository.
Do not start new product features in the private repository.

## Use a clean public checkout

For new work:

```bash
git clone https://github.com/easemyhosting-com/fleethub.git fleethub-public
cd fleethub-public
git switch -c docs/example-update origin/main
```

In an existing checkout, inspect `git remote -v`, branch tracking and `git status`
first. Remote names are aliases: `origin` may still identify the old private repo.
An explicit `--repo easemyhosting-com/fleethub` is required for GitHub operations
until a checkout has been verified. Use the account with the required repository
permissions, and restore any previously active account afterward.

Never merge the historical private branch into public main, push private main to
the public remote, or change a private branch's push target to public as a shortcut.
For a public follow-up, branch from public main and apply only reviewed public-safe
changes. Verify `git log <public-main>..HEAD` and `git diff <public-main>...HEAD`
before pushing. No private development commits may appear in that range.

Changing remote names alone neither migrates history nor changes a PR's target.
Keep private reconciliation separate until its work is preserved and its checks
pass. An equivalent tree can prove preservation after a squash even when ancestry
does not; inspect the exact trees before deleting a branch. Never force-reset main.

## Checks and review

Public main currently requires an up-to-date PR, linear history, resolved
conversations and these checks: `quality`, `dependencies`, `codeql`, `container`,
`secrets`, `inventory`, `CodeRabbit`. No human approval count is currently required.
Verify protections again before merging; do not infer readiness from this snapshot.

Read CodeRabbit's actual latest review and summary at the exact head. A skipped,
rate-limited or merely green check does not establish that code was reviewed.
Verify every actionable finding, including outside-diff comments. Merge normally
with a squash when checks and review permit. Never use an administrator override.

The public workflow currently uses GitHub-hosted Ubuntu runners. The private
reconciliation workflow has separate self-hosted routing and an explicit Node
setup for CodeQL. Those changes are not public product changes. Do not copy
private labels, hostnames or account-specific routing into public docs or workflows.

GitHub warns that public pull requests can compromise persistent self-hosted
runners. Public contributions should remain on hosted or properly isolated
infrastructure; do not send untrusted fork code to an owner's long-lived machine.
See [GitHub's runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
The public workflow must keep all existing checks regardless of runner selection.

## Evidence and cleanup

A passing test suite proves the tested checkout, not a running deployment. Record
head SHA, commands, passed/skipped/blocked checks and fixture versus live coverage.
Use [the execution plan](62-next-two-weeks.md) for the release acceptance sequence.
No deployment is implied by a documentation merge.

Before deleting a branch or worktree, ensure it is clean and that every change is
merged or demonstrably equivalent to a preserved commit. Delete neither historical
repositories nor retained data volumes as branch cleanup. Runtime inventories,
credentials, recovery evidence and operator-specific journals stay private.
