"""A Dockerfile scan must identify at least one Dockerfile configuration target."""
import json
from pathlib import Path
import sys


def has_dockerfile_target(document):
    results = document.get("Results") if isinstance(document, dict) else None
    return isinstance(results, list) and any(
        isinstance(item, dict) and item.get("Type") == "dockerfile" and item.get("Class") == "config"
        for item in results
    )


def main():
    try:
        if len(sys.argv) != 2 or not has_dockerfile_target(json.loads(Path(sys.argv[1]).read_text())):
            raise ValueError("No Dockerfile target")
    except (OSError, ValueError, TypeError):
        print("FAIL: Trivy did not report a Dockerfile configuration target")
        return 1
    print("Trivy Dockerfile target coverage confirmed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
