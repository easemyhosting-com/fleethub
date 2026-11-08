# Fleet Map and resource profiles

Status: built (M1). Part of [product scope](44-product-scope-and-onboarding-tiers.md); design background in fleet map and control plane.

## What the owner gets

A "Fleet Map" tab, now the default view. Every resource from every account is one tile.

- Group by provider, account, role, kind or region. Size by capacity or equally.
- Filter by provider, account, kind, state, role; a needs-attention toggle.
- State is never colour only: running ●, changing ◐, stopped ■, unknown ? (dashed), missing ✕.
- Map/Table toggle; the table is a full twin for accessibility.
- Click any tile for a drawer: state, public specs, and the profile editor.
- The layout is a squarified treemap (`src/lib/fleetmap/layout.ts`), so area is meaningful, unlike a stock heat map.

## Resource profile

Table `resource_profiles` (one row per resource, cascade delete). Fields come from a fixed vocabulary in `src/lib/fleet/vocabulary.ts`:

| Field | Values |
|---|---|
| role | primary_site, backup_site, agent_host, ci_runner, database_primary, database_backup, llm_endpoint, object_storage, general, unused |
| lifecycle | always_on, on_demand, ephemeral, scheduled |
| backupClass, criticality | fixed enums |
| autoStop | off, recommend, approve, auto |
| labels | up to 20, key `^[a-z][a-z0-9_.-]{0,31}$`, value ≤64 chars |
| notes | free text |

Defaults when unset: general / always_on / none / normal / off. The snapshot reports `profile.set` so the UI can tell "unlabelled" from "labelled general".

## Safety rules

- Protected resources (resource, account or Oracle flag) can never be set to `approve` or `auto`; the API returns 409 `protected_auto_stop`. OCI servers stay off by owner decision.
- `POST /api/resources/profile` is operator-only, same-origin, strict schema (unknown keys rejected).
- Updates merge: unspecified fields are preserved; labels are replaced only when sent.
- Every change writes a `capacity_events` row (`profile_set`) with the actor; label values are not copied into the audit log.
- Only an allowlist of spec fields reaches the browser (`publicResourceSpecs`), so provider attributes such as keys never leave the server.

## Registration form

The onboarding form has a collapsed "Advanced" section (role, lifecycle, backup class; defaults general / always_on / none). When any is changed and the account has a credential, the first-scan resources are labelled through `POST /api/resources/profile` (`applyRegistrationProfile` in `src/lib/providers/client.ts`). `autoStop` is never sent, so the protected-resource rule holds. Inventory-only accounts have no resources yet, so labels are set later in the drawer.

## Not yet built

- Acting on `autoStop` (policies, kill switch, actuator: M3).
- Relationships (primary/backup links) and health overlays (M2).

## Tests

`tests/fleetmap.test.ts` (layout, model, spec allowlist, vocabulary), `tests/profile-route.test.ts`, `tests/profiles.integration.test.ts` (PostgreSQL).
