#!/usr/bin/env bash
set -euo pipefail
# Explicit npm run prepare is required because npm lifecycle scripts are disabled.
git rev-parse --git-dir >/dev/null
git config --local core.hooksPath .githooks
printf '%s\n' 'Installed repository-local hooks. Install gitleaks before committing.'
