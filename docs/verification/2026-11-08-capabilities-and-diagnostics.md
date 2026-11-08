# CLIProxy capabilities and collection diagnostics

## Implemented scope

R5 adds an operator-only `GET /api/onboarding/cliproxy-capabilities` endpoint. The adapter uses the v8 management contract and the inference model-list route with distinct credentials. It reports a schema version, adapter contract, check time, inference and management authentication independently, credential enablement, reported upstream availability and quota support. Installed server version and actual inference availability remain unknown unless evidence exists. On 2026-11-09 the setup screen gained a read-only **Gateway capabilities** panel that calls this endpoint on request; `scripts/verify-setup-ui.mjs` covers it at 390px.

Quota observations have separate not-loaded, loading, observed, stale, unsupported and failed variants. Only observations contain measured values. The initial adapter has no provider quota reader, so its unsupported status describes the adapter, not the server or an account's remaining allowance. Expired observations retain their source time and measurements.

Credential IDs are keyed opaque hashes. Email addresses, filenames, auth contents, tokens, unknown provider strings and raw status messages never enter the response. The transport refuses redirects, limits JSON responses to 1 MiB and uses an eight-second timeout. No auth download, OAuth, routing, plugin or log endpoint is called.

R6 adds bounded diagnostic projections and shared keyboard-accessible recovery disclosures to account collection and connector details. Error categories select fixed repair guidance. Each record identifies its source and observation time, with unknown time explicit. Raw exception messages and gateway logs are not accepted as diagnostic input. This is current-state guidance, not a historical log viewer.

## Verification

The capability adapter tests use a real local HTTP server. They cover distinct keys, successful inference with rejected management access, disabled credentials, reported availability, absent metadata, 404/503 responses, invalid schema, missing runtime credentials, denied origins and redaction. Route tests verify operator access, missing setup, database failures, no-store and exception suppression. Quota lifecycle tests prevent absent measurements becoming zero.

Diagnostic tests cover every inventory error category, collection-state recovery, connector failures, invalid timestamps and suppression of arbitrary text. Browser fixture checks exercise keyboard disclosure and long account labels at desktop and narrow widths. The full disposable PostgreSQL suite passes 100 files and 680 tests on Node 24.22.1. Coverage is 95.45% statements, 91.49% branches, 96.19% functions and 97.87% lines. Production, worker and MCP builds pass. Diagnostics keyboard and long-label checks pass at 1280px, 390px and 320px, with no page errors or document overflow. The rendered mobile fixture was visually inspected. Impeccable found no issues in the three changed diagnostic UI files. CodeRabbit reviewed all new capability and diagnostic files and returned zero findings on follow-up. Live account mutations are outside this record.

## Contract source and limits

The [upstream v8 API reference](https://help.router-for.me/management/apiv8) documents the credential-list contract and distinguishes optional plugin quota endpoints. Reviewed on 2026-11-08. This adapter implements only the read paths described above. A successful model listing does not establish successful inference, and credential enablement does not establish upstream authentication. A 404 can mean management is disabled or unavailable, so it does not prove an unsupported server version.

Shared map/list/identity selection, filters and details remain task R7. Provider-specific OAuth authorization remains task R10. The independent Qwen review produced no report. The separately completed owner-requested LUNA review covers these additions with the limits recorded in its report.
