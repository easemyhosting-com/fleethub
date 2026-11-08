# Security policy

FleetHub stores references to provider credentials and can hold credentials in its built-in encrypted store, so security reports are welcome.

## Reporting a vulnerability

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include the affected version or commit, the deployment mode (local or production), reproduction steps and the impact you observed. Never include real credentials, tokens or private host details; use placeholders.

## Scope

In scope: the FleetHub web application, inventory worker, setup helper, Compose configuration and documentation that could lead an operator into an insecure setup.

Out of scope: vulnerabilities in Infisical, CLIProxyAPI, PostgreSQL or provider APIs themselves. Report those to their maintainers. Reports about how FleetHub integrates with them are in scope.

## Supported versions

Only the latest commit on the default branch receives fixes.
