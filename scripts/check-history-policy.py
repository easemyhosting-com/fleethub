"""Full-history identifier audit, emitting only object IDs, paths and rule names."""
import importlib.util
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('history_policy', Path(__file__).with_name('check-repository-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def main():
    found = False
    for line in subprocess.check_output(['git', 'rev-list', '--objects', '--all'], text=True).splitlines():
        sha, _, path = line.partition(' ')
        if not path:
            continue
        if policy.sensitive(path):
            print(f'sensitive-history-path: {sha}')
            found = True
            continue
        if subprocess.check_output(['git', 'cat-file', '-t', sha], text=True).strip() != 'blob':
            continue
        data = subprocess.check_output(['git', 'cat-file', '-p', sha])
        if b'\0' in data:
            continue
        try:
            text = data.decode('utf8')
        except UnicodeDecodeError:
            continue
        for rule, number in policy.forbidden_hits(text, path):
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
