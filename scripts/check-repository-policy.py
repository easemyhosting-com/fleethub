"""Inspect text without disclosing matched values or following sensitive files."""
import argparse
import ipaddress
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
# Explicit self-test and pattern files contain quoted detection examples.
PATTERN_FILES = {'security/forbidden-patterns.txt', 'security/suppression-patterns.txt'}
SUPPRESSION_FIXTURES = {'scripts/test-guardrails.py'}


def git(*args):
    return subprocess.check_output(['git', *args])


def sensitive(path):
    parts = Path(path).parts
    return Path(path).suffix in {'.pem', '.key', '.p12', '.pfx'} or Path(path).name in {'id_rsa', 'id_ed25519', '.gitleaksignore'} or any(part.startswith('.env') for part in parts) or path.startswith('security/.local-forbidden') or any(part in {'.ssh', '.aws'} for part in parts)


def allowed_entries():
    entries = []
    for line in (ROOT / 'security/allowed-identifiers.txt').read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        fields = line.split('\t')
        if len(fields) not in (2, 3) or not fields[0] or not fields[1]:
            raise ValueError('Invalid exact allowlist')
        value, scope = fields[0], fields[2] if len(fields) == 3 else None
        try:
            network = ipaddress.ip_network(value)
        except ValueError:
            network = None
        if network:
            permitted = any(network.subnet_of(approved) for approved in [ipaddress.ip_network(cidr) for cidr in ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '127.0.0.0/8', '::1/128']] if approved.version == network.version)
            if not permitted and not (scope and scope.startswith('tests/') and network.num_addresses == 1):
                raise ValueError('Non-example IP allowances must be exact test-only addresses')
        if '*' in value or '\n' in value:
            raise ValueError('Identifier allowances must be exact literals')
        entries.append((value, scope, network))
    return entries


def strip_allowed(line, path, entries):
    for value, scope, network in entries:
        if scope and path != scope and not path.startswith(scope.rstrip('/') + '/'):
            continue
        if network:
            def replace(match):
                try:
                    return '' if ipaddress.ip_address(match[0]) in network else match[0]
                except ValueError:
                    return match[0]
            line = re.sub(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])', replace, line)
        else:
            # Exact identifier boundaries prevent a placeholder from masking a suffix.
            line = re.sub(r'(?<![\w.-])' + re.escape(value) + r'(?![\w.-])', '', line)
    return line


def suppression_hits(text, path):
    if path in PATTERN_FILES | SUPPRESSION_FIXTURES:
        return []
    tokens = (ROOT / 'security/suppression-patterns.txt').read_text().splitlines()
    hits, fence = [], None
    for number, original in enumerate(text.splitlines(), 1):
        line = original
        if path.endswith('.md'):
            marker = re.match(r'^\s{0,3}(`{3,}|~{3,})', line)
            if marker:
                value = marker[1]
                if fence is None:
                    fence = value
                elif value[0] == fence[0] and len(value) >= len(fence):
                    fence = None
                continue
            if fence:
                continue
            line = re.sub(r'(`+)([^`]*?)\1', '', line)
        for token in tokens:
            if token and token.casefold() in line.casefold():
                # Reject all inline ESLint disables; no security-rule parsing ambiguity.
                hits.append(('suppression', number))
                break
    return hits


def forbidden_hits(text, path):
    if path == 'security/allowed-identifiers.txt':
        allowed_entries()  # Validate policy data instead of treating its scoped examples as source.
        return []
    if path in PATTERN_FILES:
        return []
    rules = []
    for line in (ROOT / 'security/forbidden-patterns.txt').read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        name, expression = line.split('\t', 1)
        rules.append((name, re.compile(expression)))
    domains = set((ROOT / 'security/allowed-email-domains.txt').read_text().splitlines())
    allowed = allowed_entries()
    result = []
    for number, original in enumerate(text.splitlines(), 1):
        line = strip_allowed(original, path, allowed)
        for name, expression in rules:
            if name == 'private-key' and path.startswith('tests/fixtures/'):
                continue
            if expression.search(line):
                result.append((name, number))
        for match in re.finditer(r'(?<![\w/.:+-])[A-Za-z0-9][A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)', line):
            if any(character.isalpha() for character in match[1]) and match[1].lower() not in domains:
                result.append(('email-domain', number))
    return result


def paths_and_text(staged):
    args = ('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z') if staged else ('ls-files', '-z')
    for raw in filter(None, git(*args).split(b'\0')):
        path = raw.decode('utf8')
        if sensitive(path):
            yield path, None
            continue
        if staged:
            # Do not follow index symlinks; scanning their targets could expose private data.
            mode = git('ls-files', '-s', '--', path).split(b' ', 1)[0]
            if mode == b'120000':
                yield path, None
                continue
            data = git('show', ':' + path)
        else:
            file = Path(path)
            if file.is_symlink():
                yield path, None
                continue
            data = file.read_bytes()
        if b'\0' in data:
            continue
        try:
            yield path, data.decode('utf8')
        except UnicodeDecodeError:
            continue


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--staged', action='store_true')
    parser.add_argument('--suppressions-only', action='store_true')
    args = parser.parse_args()
    hits = []
    try:
        for path, text in paths_and_text(args.staged):
            if text is None:
                hits.append((path, 'sensitive-path-or-symlink', 0))
                continue
            for rule, line in suppression_hits(text, path):
                hits.append((path, rule, line))
            if not args.suppressions_only:
                for rule, line in forbidden_hits(text, path):
                    hits.append((path, rule, line))
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Repository policy unavailable; check policy syntax and Git state')
        return 2
    for path, rule, line in sorted(set(hits)):
        print(f'{rule}: {path}:{line}')
    return int(bool(hits))


if __name__ == '__main__':
    raise SystemExit(main())
