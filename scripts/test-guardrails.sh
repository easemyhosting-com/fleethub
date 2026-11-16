#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"
# Python standard-library fixtures invoke the real Bash hooks in throwaway repos.
python3 scripts/test-guardrails.py
python3 scripts/test-private-identifiers.py
python3 scripts/test-security-exceptions.py
python3 scripts/test-trivy-targets.py
python3 scripts/test-history-policy.py
node --test scripts/test-compose-policy.mjs
