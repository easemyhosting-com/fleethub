# CLIProxy console reference review

Date: 2026-11-08. Target: local CLIProxyAPI Management Center at `http://127.0.0.1:8317/management.html`. The operator provided the signed-in browser session. Backend displayed v8.0.58; Management Center Info displayed UI v1.27.3.

This record completes the main-navigation coverage begun in the first signed-in review. All 12 sidebar pages were inspected across the two passes. This is a reference-product review for FleetHub planning, not an end-to-end test of CLIProxy or a complete accessibility audit.

## Page coverage

| Page | Inspected UI | FleetHub implication |
| --- | --- | --- |
| Dashboard | Connected status alongside Needs attention; rolling-window success/failure counts; credential availability; provider and configuration summaries; task links | State the observation window and separate connection success from upstream health. Lead to affected accounts rather than add a large decorative hero. |
| Quick Start | Current rendered content is a third-party top-up promotion with registration links | Do not copy the page based on its title. FleetHub needs an actual first-provider checklist and independent integration choices. No promotional dependency should block setup. |
| AI Providers | Provider-specific categories, active/total counts, quick-fill entries, sorting, model filter and New actions | Distinguish a configured provider endpoint from an authorized account. Offer supported templates and capability labels without promising discovery or permission from configuration alone. |
| Auth Files | Provider counts; name/account/type/provider/error search; enabled/disabled/problem filters; sort/display options; pagination; Models and quota-refresh actions; upload and bulk-delete affordances | Keep credential health accessible from accounts and map details. Separate enablement from health. FleetHub does not import raw CLIProxy credential files or duplicate credential administration. |
| OAuth Login | Browser sign-in, device-code methods, regional/site distinctions, service-account JSON and additional binding method | Choose connection methods per provider and site. Keep provider authorization distinct from FleetHub operator login. Presence of a method does not verify successful authorization. |
| Routing | Priority tiers; serving/cooling credentials; retry and fallback explanations; affinity options; explicit omissions in the preview | Explain recommendation exclusions and provenance in FleetHub maps. Keep inference policy edits in CLIProxy; previews must state uncertainty and omissions. |
| Quota Management | Provider filters and credential entries; no quotas loaded in observed state; per-account refresh affordances | Store quota observation separately from credential discovery and authentication. Not loaded must never become zero usage or available capacity. |
| Logs Viewer | Log Content and Error Request Logs tabs; search, severity, display filters, refresh, continuous reading, cached download, clear and fullscreen controls; error-log Open/Download actions | Plan account/connector diagnostics with bounded retention, redaction and source/time filters. Existing audit history is distinct from operational logs. Do not ingest raw proxy traffic by default. |
| Config Panel | Visual/Source choices; Common, Access & Authentication, Network Configuration, Logging & Diagnostics, Streaming Configuration, Advanced & Experimental and Payload Configuration sections; sync status and Reload | Use task-oriented settings and explicit saved/effective state. Keep advanced controls behind disclosure. Do not mirror the proxy configuration editor in FleetHub. |
| Plugins | Global Disabled status; discovered and effective counts; empty installed-plugin state; management explanation and store link | Distinguish installed, enabled and effective capabilities. Explain a global switch that prevents an individually enabled integration from operating. |
| Plugin Store | Registry entries, installed/not-installed/update filters, install actions and trust warning about credential/traffic access | Optional extensions are not core capabilities. FleetHub should detect supported read-only capability contracts and document version/dependency requirements, not require plugin installation during onboarding. |
| Management Center Info | UI version; update check; documentation/repository links; model-response section; clear-local-login action | Expose FleetHub and connector versions, last capability check, help links and redacted diagnostics. Keep sign-out/local-data clearing distinct from disconnecting or revoking a provider account. |

## Configuration section coverage

Common exposes frequently used settings. Access & Authentication includes host/port, OAuth credential-directory and token field labels. Network Configuration includes retry bounds, refresh workers, routing, affinity, cooldown and header behavior. Logging & Diagnostics includes debug/file logging, retention and in-memory usage settings. Streaming Configuration includes keepalive and bootstrap retries. Advanced & Experimental and Payload Configuration sections were opened; their presence was verified without exercising actions or interpreting hidden configuration values.

Visual mode and navigation tabs were used for this inspection. Source mode was not opened because raw configuration is unnecessary for the design review. Credential input values, raw configuration, log bodies, auth-file contents and browser storage were not collected. Empty or disabled sections provide no evidence of successful runtime behavior.

## Changes to the FleetHub plan

1. Add a connection summary with service/version, intended endpoint, last successful verification, and detected capabilities. Keep configuration saved, verified and effective states distinct.
2. Add a real first-use checklist: choose a backend, optionally connect a gateway, connect one provider, observe first scan, then explore Resources or the existing mind map. A skipped optional integration is a valid state.
3. Keep account enablement, authorization, upstream availability, quota freshness and connector effectiveness separate. Unsupported capability, globally disabled capability and missing measurements require different explanations.
4. Add bounded, redacted connector diagnostics to account details: operation, timestamp, source, permission/routing/error category and retry guidance. Any future diagnostic export must exclude credentials and provider payloads by default. Implement the existing audit trail separately.
5. Treat CLIProxy extensions as optional versioned capabilities. Record whether metadata comes from core or an extension. A registry listing or install button does not establish that an extension is installed, trusted or necessary.
6. Keep context actions and diagnostics beside the selected graph node/resource. Maintain shared search, problem filters and ownership context across maps and lists. Do not replace maps with proxy dashboard cards.
7. Preserve the boundary: FleetHub records capacity and advises; CLIProxy owns inference routing, model aliases, streaming configuration, payload transformations and LLM auth files. A proxy plugin marketplace is outside this onboarding batch.

## Verification limits

Navigation and rendered controls were inspected. No OAuth flow was started, file uploaded/downloaded, account changed, quota/credential refresh triggered, log cleared, plugin installed/enabled, configuration saved or update performed. External promotion and repository links were not followed. Page navigation may perform the console's normal background reads.

This covers the complete main navigation, not every nested editor, confirmation dialog, provider-specific form, plugin detail or operational outcome. Live quotas, refresh-token behavior, failover, update/install success and destructive actions remain untested. Mobile layout, keyboard behavior, screen-reader behavior and measured accessibility remain separate acceptance work. Provider/account identifiers and raw request errors are deliberately absent from this public record.
