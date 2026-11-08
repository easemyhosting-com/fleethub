# Optional skips and public install guidance verification

Scope: tasks R8 and R9, including the uncommitted changes after the private development baseline. These checks do not establish gateway migration or whole-app acceptance.

## R8 persisted skips

Optional Tailscale and CLIProxy skips persist independently of saved connection configuration and verification metadata. Save and successful verification clear the skipped flag. The API rejects skips for credential backends. The PostgreSQL integration suite verifies persistence and preservation of saved connections.

The continuation suite passed on pinned Node 24.22.1 against a disposable local PostgreSQL database, including onboarding unit and database tests. The setup browser fixture checks skip/reopen behavior alongside saved configuration. No fixture request changes the live installation.

## R9 install defaults and deprecation

README and the self-onboarding runbook identify the built-in encrypted store and Connect existing Infisical as supported public paths. New Infisical installations use the upstream installation guide. The bundled profile is deprecated and remains available through explicit compatibility commands.

The runbook identifies volume retention, encrypted backup, restore verification and rollback before stopping a service. The setup browser fixture checks separate service commands and confirms that revealing installation guidance sends no startup request. Compose profile regression tests cover the independent profiles and legacy compatibility.

The earlier six styled setup fixture checks passed at desktop and 390px widths. This verification record supplies the per-item evidence requested by the follow-up CodeRabbit review. Authenticated provider workflows, gateway credentials and a full mobile application pass are outside this record.
