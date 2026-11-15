#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
python3 "$root/scripts/check-repository-policy.py" "$@"
python3 "$root/scripts/check-private-identifiers.py" --root "$root"
