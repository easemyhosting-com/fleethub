# Local security checks

Use the exact Node version in `.nvmrc`. Install dependencies with `npm ci`.
Lifecycle scripts are disabled in `.npmrc`; run `npm run prepare` explicitly to
install repository-local hooks. Nothing changes global Git configuration.
Reviewed Next.js/esbuild build commands work with lifecycle scripts disabled;
new dependencies must not execute installation scripts without review.

Install gitleaks 8.30.1 from its official release using a verified checksum. CI
uses `scripts/install-security-tools.py` for the pinned Linux binary. Local
commits fail if gitleaks is unavailable. Run `npm run test:guardrails`,
`npm run check:security`, `npm run typecheck` and `npm test` before committing.
The Compose hook scans staged content rather than a changed working copy.

The generic checker prints only rule names and locations. Exact placeholders and
CIDRs live in `security/allowed-identifiers.txt`, with justification and optional
path scope. Test-only private-address entries must remain scoped to their exact
fixtures. Email domains are exact entries, never wildcard suffixes. The literal
`your-tailnet.ts.net` is permitted; other tailnet names are rejected.

Private identifiers never belong in committed policy. Create the private seed
outside the repository with permissions 600; each line is `literal<TAB>value`,
`name<TAB>value` or `email<TAB>value`. Link or copy it to the ignored
`security/.local-forbidden.txt`. The owner may also keep a private supplement
outside the repository in their private audit directory. Check that Git ignores
the link and never stage it. The checker also reads the optional supplement.
For the conventional private directory, create `~/fleethub-audit-private/seed/`,
set its permissions to 700, and keep `identifiers.txt` and optional
`supplement.txt` at mode 600. Use an editor locally to populate them; never paste
values into issues, PRs or agent chat. Create the ignored link explicitly:

```sh
ln -s ~/fleethub-audit-private/seed/identifiers.txt security/.local-forbidden.txt
git check-ignore security/.local-forbidden.txt
```

CI cannot know private seeds that are absent from its checkout. The generic gate
continues to work without them; this does not prove all private identifiers absent.

Commit messages use Conventional Commits. Commit authors must use the exact
configured project noreply address; GitHub's web committer address is also allowed
for committers. Additional agent coauthor addresses require deliberate owner
approval in `security/allowed-trailer-emails.txt`. Hooks can be bypassed by Git,
so CI independently enforces the policies. Agents must never bypass hooks.

Direct scanner suppressions fail. Quoted examples inside Markdown inline code or
fenced blocks are allowed, plus the explicitly named checker pattern files and
synthetic checker test fixture. Source/config directives are rejected.

All workflows use hosted runners. Repository rules must require owner approval
for protected controls and required checks. CI requires a current-head owner
approval when identifier/exception policy changes; a review event refreshes it.
This gate does not replace GitHub rulesets: a PR could otherwise alter the gate
itself. Configure required CODEOWNER reviews on the new repository before use.

Raw scanner reports stay in temporary storage and are never uploaded as artifacts.
Semgrep and Trivy summaries print counts; gitleaks output is redacted. Monthly
issues contain status only. The CLIProxy exception does not waive Compose rules
or the main Dockerfile gate and expires after 2026-12-15 UTC. Trivy 0.76.1 does
not recognize Compose targets; the static YAML checker covers Compose instead.

The empty `.semgrepignore` replaces default test-path exclusions so test fixtures
are included. No source suppression is authorized. Full-history gates can fail
on pre-migration identifiers and synthetic historical fixtures; resolve them via
the owner's separately approved history decision, never a scanner suppression.
