"""Full-history identifier audit, emitting only object IDs, paths and rule names."""
import importlib.util
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('history_policy', Path(__file__).with_name('check-repository-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def history_entries():
    """Yield every (blob, path) pair that any commit introduced, NUL-safe.

    `git rev-list --objects` names each object once, so a blob stored under two
    paths would be checked under only one of them.
    """
    raw = subprocess.check_output(['git', 'log', '--all', '--root', '-m', '--no-renames', '--raw', '-z', '--no-abbrev', '--format='])
    fields = raw.split(b'\0')
    seen = set()
    index = 0
    while index < len(fields):
        header = fields[index].lstrip(b'\n')
        index += 1
        if not header.startswith(b':'):
            continue
        parts = header[1:].split(b' ')
        path = fields[index].decode('utf8', 'surrogateescape')
        index += 1
        if len(parts) < 5 or parts[1] == b'160000' or set(parts[3]) == {ord('0')}:
            continue
        entry = (parts[3].decode('ascii'), path)
        if entry not in seen:
            seen.add(entry)
            yield entry


def main():
    found = False
    blobs = {}
    for sha, path in history_entries():
        if policy.sensitive(path):
            print(f'sensitive-history-path: {sha}')
            found = True
            continue
        if sha not in blobs:
            data = subprocess.check_output(['git', 'cat-file', 'blob', sha])
            try:
                blobs[sha] = None if b'\0' in data else data.decode('utf8')
            except UnicodeDecodeError:
                blobs[sha] = None
        if blobs[sha] is None:
            continue
        for rule, number in policy.forbidden_hits(blobs[sha], path):
            print(f'{rule}: {sha} {path}:{number}')
            found = True
    for sha in subprocess.check_output(['git', 'rev-list', '--all'], text=True).splitlines():
        text = subprocess.check_output(['git', 'show', '-s', '--format=%B', sha], text=True)
        for rule, number in policy.forbidden_hits(text, 'commit-message'):
            print(f'{rule}: commit {sha}:{number}')
            found = True
    return int(found)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError):
        print('History policy scan unavailable; failing closed.')
        raise SystemExit(2)
