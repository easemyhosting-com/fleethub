"""Check tracked text against private identity seeds without disclosing matches.

This is the private-seed portion of the forbidden checker. Generic policy checks
and hook/CI integration are separate hardening work.
"""
import argparse
from pathlib import Path
import re
import subprocess


def patterns(files):
    entries = []
    for path in files:
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            if not line or line.startswith("#"):
                continue
            kind, sep, value = line.partition("\t")
            if not sep:
                kind, value = "literal", line
            if kind not in {"literal", "name", "email"}:
                raise ValueError("Invalid private identifier type")
            if value:
                entries.append((kind, value))
    result = []
    for number, (kind, value) in enumerate(entries, 1):
        variants = [(value, "full")]
        if kind == "name":
            words = value.split()
            if words:
                variants += [(words[0], "name fragment"), (words[-1], "name fragment")]
        elif kind == "email" and "@" in value:
            local, domain = value.rsplit("@", 1)
            variants += [(local, "email local-part"), (domain, "email domain")]
        seen = set()
        for needle, confidence in variants:
            normalized = needle.casefold()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            expression = re.compile(r"(?<![\w])" + re.escape(needle) + r"(?![\w])", re.IGNORECASE)
            result.append((f"ID-{number}", confidence, expression))
    return result


def approved_literals(root):
    path = root / "security/allowed-identifiers.txt"
    entries = [
        ("347839428+easemyhosting-com@users.noreply.github.com", None),
        ("easemyhosting-com", None),
        ("GitHub <noreply@github.com>", None),
    ]
    if not path.is_file():
        return entries
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) not in (2, 3) or not fields[0] or not fields[1]:
            raise ValueError("Invalid exact-identifier policy entry")
        entries.append((fields[0], fields[2] if len(fields) == 3 else None))
    return entries


def scan(root, seeds, staged=False):
    rules = patterns(seeds)
    allowed = approved_literals(root)
    if not rules:
        return []
    command = ["git", "-C", str(root)]
    selection = ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"] if staged else ["ls-files", "-z"]
    paths = subprocess.check_output(command + selection).split(b"\0")
    hits = []
    for encoded in filter(None, paths):
        relative = encoded.decode("utf8")
        path = root / relative
        # Private sources are never scanned or disclosed, even if added by mistake.
        if path.name.startswith(".env") or relative.startswith("security/.local-forbidden"):
            continue
        if not staged and path.is_symlink():
            continue
        try:
            if staged:
                mode = subprocess.check_output(command + ["ls-files", "-s", "--", relative]).split(b" ", 1)[0]
                if mode == b"120000":
                    continue
                text = subprocess.check_output(command + ["show", ":" + relative]).decode("utf8")
            else:
                text = path.read_text()
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), 1):
            for literal, scope in allowed:
                if scope is None or relative == scope or relative.startswith(scope.rstrip("/") + "/"):
                    line = line.replace(literal, "")
            for identity, confidence, expression in rules:
                if expression.search(line):
                    hits.append((identity, confidence, relative, line_number))
    return hits


def main():
    parser = argparse.ArgumentParser(description="Check private identifier locations; never print values")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--staged", action="store_true")
    args = parser.parse_args()
    seed = args.root / "security/.local-forbidden.txt"
    supplement = Path.home() / "fleethub-audit-private/seed/supplement.txt"
    try:
        hits = scan(args.root, [seed, supplement], staged=args.staged)
    except (OSError, ValueError, subprocess.SubprocessError):
        print("Private identifier check unavailable; check local seed permissions and format")
        return 2
    for identity, confidence, path, line in hits:
        print(f"{identity} ({confidence}): {path}:{line}")
    return int(bool(hits))


if __name__ == "__main__":
    raise SystemExit(main())
