# Optional AI connection

FleetHub needs no AI service. Inventory, comparisons, placement explanations and the
read-only MCP interface work the same with or without this connection, and no other
feature reads it. This page describes the connection contract only. It does not add an
assistant, and saving a connection sends no inventory anywhere.

## What the operator configures

One connection, stored in `ai_connections` (a single row with id `default`):

| Field | Meaning |
| --- | --- |
| API base URL | The endpoint including its version path, such as `https://api.example.com/v1` or `http://127.0.0.1:11434/v1` for a local server |
| Protocol | `openai-chat-completions`, `openai-responses` or `anthropic-messages` |
| Model | The model name the endpoint expects |
| Key | An existing single-key encrypted-store secret reference, or none for a server that needs no key. References holding several keys are not offered, because they do not say which one is the AI key |

The three protocols are separate capabilities. Supporting one says nothing about the
others, and a reply in another protocol's shape counts as a failure. A Responses reply that reports
`status: "failed"` or an `error` counts as a failure; `incomplete` (the token cap was
reached) still shows that the model answered.

Keys are never entered on this page. The connection stores a secret reference ID. While a
connection points at a reference, `removeUnusedSecretRef` keeps that secret, as it does
for provider accounts, connectors and app-ledger links. Disconnecting removes only the
connection row. It does not delete the stored key or revoke anything upstream.

## Network rules

Requests use the same transport rules as other service connections:

- The endpoint origin must be listed in `FLEETHUB_ONBOARDING_ALLOWED_ORIGINS`.
- HTTPS is required outside loopback unless `FLEETHUB_ALLOW_INSECURE_SERVICE_HTTP=true`
  is set for a trusted internal network.
- URLs with credentials, query strings or fragments are refused.
- Redirects are refused. Each request times out after 8 seconds, and responses are capped at 1 MiB.
- Results report a status class only, never the upstream body, destination or key.

## Checking a connection

`POST /api/ai-connection/check` (operator, write access) requires
`{consentToBillableProbe: true|false, expectedConnection: <displayed connection>}`.
There is no default. The displayed connection includes its saved timestamp and
settings; a mismatch returns 409 before reading a key or contacting the endpoint.
Reload settings and obtain consent again.

1. The model list (`GET <base>/models`) is free on common servers. Its result is
   `listed`, `not_listed` or `failed`. A listed model is not proof that requests work.
2. Only with consent, one minimal request goes to the protocol's own path:
   `/chat/completions` (`max_completion_tokens: 1` for o-series models, otherwise `max_tokens: 1`), `/responses` (`max_output_tokens: 16`) or
   `/messages` (`max_tokens: 1`). The provider may bill it.
3. Usage and quota are always reported as `unsupported` for this connection. They belong
   to separate management adapters, such as the CLIProxy capability report, and the
   inference connection never calls management or quota endpoints.

Authentication headers follow the protocol: `Authorization: Bearer` for the OpenAI-style
protocols, and `x-api-key` with `anthropic-version` for Messages.

## API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/ai-connection` | Operator | Current connection (or `null`) and selectable secret references, with no key values |
| PUT | `/api/ai-connection` | Operator, write | Save or replace the connection. Strict schema; unknown fields are rejected |
| DELETE | `/api/ai-connection` | Operator, write | Forget the connection |
| POST | `/api/ai-connection/check` | Operator, write | Run the check above |

The settings page is `/ai-connection`, linked from the setup wizard's optional AI
gateway step.

## Not included

- No assistant, prompt context or inventory export. A future assistant needs explicit
  opt-in, a visible destination and minimal redacted context (docs/64).
- No routing, failover, provider login, token refresh or gateway lifecycle management.
- No billable request without consent, and no background or scheduled checks.
- Possession of a key or a compatible protocol does not establish permission to use a
  subscription credential this way. The operator decides.
