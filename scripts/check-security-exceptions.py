"""Validate the narrowly scoped optional-image exception and its UTC deadline."""
from datetime import date, datetime, timezone
import json
from pathlib import Path
import re


def validate(text, today):
    blocks = re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
    if len(blocks) != 1:
        raise ValueError("Expected one exception policy block")
    document = json.loads(blocks[0])
    if set(document) != {"exceptions"} or not isinstance(document["exceptions"], list):
        raise ValueError("Invalid exception policy")
    entries = document["exceptions"]
    if len(entries) != 1:
        raise ValueError("Expected exactly the owner-approved optional-image exception")
    entry = entries[0]
    required = {"id", "finding", "path", "severity", "owner", "review_by", "reason", "risk", "compose_path", "service"}
    if set(entry) != required or not all(isinstance(v, str) and v.strip() for v in entry.values()):
        raise ValueError("Incomplete exception record")
    if (entry["id"], entry["finding"], entry["path"], entry["severity"], entry["owner"]) != (
        "EX-001", "AVD-DS-0002", "cliproxy/Dockerfile", "HIGH", "@easemyhosting-com"
    ):
        raise ValueError("Exception cannot broaden paths, ownership, findings or severity")
    if (entry["compose_path"], entry["service"]) != ("compose.yml", "cli-proxy-api"):
        raise ValueError("Exception must identify exactly the accepted gateway service")
    deadline = date.fromisoformat(entry["review_by"])
    if deadline > date(2026, 12, 15):
        raise ValueError("Exception extension requires a reviewed policy change")
    if today > deadline:
        raise ValueError("Optional-image security exception expired; owner review required")


def main():
    policy = Path(__file__).resolve().parent.parent / "security/known-exceptions.md"
    try:
        validate(policy.read_text(), datetime.now(timezone.utc).date())
    except (OSError, ValueError, TypeError, KeyError):
        print("Security exception policy invalid or expired; owner review required")
        return 1
    print("Security exception scope and UTC review deadline are valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
