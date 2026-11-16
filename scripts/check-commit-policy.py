"""Enforce exact public commit identities and Conventional Commits."""
from pathlib import Path
import re
import subprocess
import sys

NAME = 'easemyhosting-com'
EMAIL = '347839428+easemyhosting-com@users.noreply.github.com'


def identity(author, committer, author_name=NAME, committer_name=None):
    expected_committer = 'GitHub' if committer == 'noreply@github.com' else NAME
    if committer_name is None:
        committer_name = expected_committer
    return author == EMAIL and committer in {EMAIL, 'noreply@github.com'} and author_name == NAME and committer_name == expected_committer


def message(text):
    if not re.fullmatch(r'(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^\r\n()]+\))?!?: .+', text.split('\n', 1)[0]):
        return False
    allowed = set((Path(__file__).parent.parent / 'security/allowed-trailer-emails.txt').read_text().splitlines())
    for line in text.splitlines():
        if re.match(r'^\s*(Co-authored-by|Signed-off-by)[ \t]*:', line, re.I):
            match = re.fullmatch(r'\s*(?:Co-authored-by|Signed-off-by)[ \t]*:[^<>]*<([^<>]+)>\s*', line, re.I)
            if not match or match[1] not in allowed:
                return False
    return True


def check_commits(revision, include_messages=False):
    revisions = [revision] if isinstance(revision, str) else revision
    commits = subprocess.check_output(['git', 'rev-list', *revisions], text=True).splitlines()
    for commit in commits:
        raw = subprocess.check_output(['git', 'show', '-s', '--format=%ae%x00%ce%x00%an%x00%cn', commit], text=True).strip().split('\0')
        if len(raw) != 4 or not identity(*raw):
            print(f'Commit identity rejected: {commit}. Use the configured exact noreply identity.')
            return 1
        if include_messages:
            body = subprocess.check_output(['git', 'show', '-s', '--format=%B', commit], text=True)
            if not message(body):
                print(f'Commit message or trailer rejected: {commit}. Use Conventional Commits and approved noreply trailers.')
                return 1
    return 0


def prepush():
    zero = '0' * 40
    for line in sys.stdin:
        local_ref, local_sha, remote_ref, remote_sha = line.split()
        if remote_ref == 'refs/heads/main':
            if local_sha == zero or remote_sha != zero and subprocess.run(['git', 'merge-base', '--is-ancestor', remote_sha, local_sha], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                print('Refusing deletion or non-fast-forward push to main.')
                return 1
        if local_sha == zero:
            continue
        # A new remote branch is checked only for commits no remote-tracking ref already holds;
        # published history (such as GitHub web merges on main) cannot be changed by the pusher.
        revision = [local_sha, '--not', '--remotes'] if remote_sha == zero else f'{remote_sha}..{local_sha}'
        if check_commits(revision):
            return 1
    return 0


def main():
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--message':
            if message(Path(sys.argv[2]).read_text()):
                return 0
            print('Use Conventional Commits and only approved noreply trailers.')
            return 1
        if sys.argv[1:] == ['--pre-push']:
            return prepush()
        if len(sys.argv) == 3 and sys.argv[1] in {'--range', '--pr-range'}:
            return check_commits(sys.argv[2], include_messages=sys.argv[1] == '--pr-range')
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Commit policy unavailable; fetch the base and check configuration.')
        return 2
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
