"""Synthetic policy and actual hook tests; never use a real credential."""
import importlib.util
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


policy = module('repository_policy', 'check-repository-policy.py')
commits = module('commit_policy', 'check-commit-policy.py')


class Guardrails(unittest.TestCase):
    def test_forbidden_examples(self):
        samples = ['/'.join(['', 'Users', 'x']), 'gh' + 'p_' + 'A' * 36, 'person@' + 'unapproved.invalid', 'person@' + 'private-host', '10.' + '1.2.3', '100.' + '99.1.1', 'node.private.ts.' + 'net']
        for sample in samples:
            with self.subTest(sample_kind=samples.index(sample)):
                self.assertTrue(policy.forbidden_hits(sample, 'sample.txt'))

    def test_action_and_image_references_are_not_email_addresses(self):
        self.assertFalse(policy.forbidden_hits('actions/setup-node@' + 'a' * 40, 'workflow.yml'))
        self.assertFalse(policy.forbidden_hits('node:24-alpine@sha256:' + 'a' * 64, 'Dockerfile'))

    def test_exact_placeholders_do_not_mask_other_hosts(self):
        self.assertFalse(policy.forbidden_hits('your-tailnet.ts.net user@example.com 192.0.2.10', 'sample.txt'))
        self.assertTrue(policy.forbidden_hits('other.' + 'your-tailnet.ts.net', 'sample.txt'))

    def test_private_address_allowance_is_exact_and_test_scoped(self):
        ip = '.'.join(['10', '99', '88', '77'])
        original = policy.ROOT
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / 'security', root / 'security', ignore=shutil.ignore_patterns('.local-forbidden*'))
            try:
                policy.ROOT = root
                allowed = root / 'security/allowed-identifiers.txt'
                allowed.write_text(ip + '\tSynthetic test network\ttests/sample.ts\n')
                self.assertFalse(policy.forbidden_hits(ip, 'tests/sample.ts'))
                self.assertTrue(policy.forbidden_hits(ip, 'src/sample.ts'))
                allowed.write_text(ip + '\tInvalid global allowance\n')
                with self.assertRaises(ValueError):
                    policy.allowed_entries()
            finally:
                policy.ROOT = original

    def test_suppression_scope(self):
        token = 'gitleaks:allow'
        self.assertTrue(policy.suppression_hits(token, 'sample.ts'))
        self.assertTrue(policy.suppression_hits(token, 'sample.md'))
        self.assertFalse(policy.suppression_hits('`' + token + '`', 'sample.md'))
        self.assertFalse(policy.suppression_hits('```text\n' + token + '\n```', 'sample.md'))
        self.assertTrue(policy.suppression_hits('```text\nexample\n```\n' + token, 'sample.md'))
        self.assertTrue(policy.suppression_hits(token, '.github/workflows/sample.yml'))

    def test_sensitive_paths_fail_before_any_read(self):
        for path in ['.env.fixture', 'nested/.env.fixture', 'nested/id_rsa', 'nested/example.key', '.gitleaksignore', 'security/.local-forbidden.txt']:
            self.assertTrue(policy.sensitive(path))

    def test_identity(self):
        self.assertTrue(commits.identity(commits.EMAIL, commits.EMAIL))
        self.assertTrue(commits.identity(commits.EMAIL, 'noreply@github.com'))
        self.assertFalse(commits.identity('synthetic@example.com', commits.EMAIL))
        self.assertFalse(commits.identity(commits.EMAIL, 'synthetic@example.com'))

    def test_commit_messages(self):
        self.assertTrue(commits.message('fix(auth): reject invalid input'))
        self.assertFalse(commits.message('misc changes'))
        self.assertTrue(commits.message('test: add fixture\n\nCo-authored-by: Example <' + commits.EMAIL + '>'))
        self.assertFalse(commits.message('test: add fixture\n\nSigned-off-by: Example <synthetic@example.com>'))

    def test_actual_hooks_on_synthetic_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder in ['scripts', 'security', '.githooks']:
                shutil.copytree(ROOT / folder, root / folder, ignore=shutil.ignore_patterns('.local-forbidden*', '__pycache__'))
            shutil.copyfile(ROOT / '.gitleaks.toml', root / '.gitleaks.toml')
            env = {'PATH': os.environ['PATH'], 'HOME': str(root / 'empty-home'), 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_AUTHOR_NAME': 'Example', 'GIT_COMMITTER_NAME': 'Example', 'GIT_AUTHOR_EMAIL': commits.EMAIL, 'GIT_COMMITTER_EMAIL': commits.EMAIL}
            def run(args, **kwargs):
                return subprocess.run(args, cwd=root, env=env, capture_output=True, text=True, **kwargs)
            self.assertEqual(run(['git', 'init', '--quiet']).returncode, 0)
            self.assertEqual(run(['git', 'config', '--local', 'core.hooksPath', '.githooks']).returncode, 0)
            for text in ['/'.join(['', 'Users', 'x']), 'gh' + 'p_' + 'A' * 36, 'gitleaks:allow']:
                (root / 'sample.txt').write_text(text)
                self.assertEqual(run(['git', 'add', 'sample.txt']).returncode, 0)
                self.assertNotEqual(run(['git', 'commit', '-m', 'test: synthetic unsafe sample']).returncode, 0)
            (root / 'sample.txt').write_text('safe sample\n')
            self.assertEqual(run(['git', 'add', 'sample.txt']).returncode, 0)
            self.assertEqual(run(['git', 'commit', '-m', 'test: synthetic safe sample']).returncode, 0)
            sha = run(['git', 'rev-parse', 'HEAD']).stdout.strip()
            record = f'refs/heads/sample {sha} refs/heads/sample ' + '0' * 40 + '\n'
            self.assertEqual(run(['bash', '.githooks/pre-push'], input=record).returncode, 0)
            github_env = {**env, 'GIT_COMMITTER_EMAIL': 'noreply@github.com'}
            github = subprocess.run(['git', 'commit-tree', run(['git', 'rev-parse', 'HEAD^{tree}']).stdout.strip(), '-p', sha, '-m', 'test: synthetic web committer'], cwd=root, env=github_env, capture_output=True, text=True)
            self.assertEqual(github.returncode, 0)
            accepted = f'refs/heads/sample {github.stdout.strip()} refs/heads/sample {sha}\n'
            self.assertEqual(run(['bash', '.githooks/pre-push'], input=accepted).returncode, 0)
            rewind = f'refs/heads/main {sha} refs/heads/main {github.stdout.strip()}\n'
            self.assertNotEqual(run(['bash', '.githooks/pre-push'], input=rewind).returncode, 0)

            tree = run(['git', 'rev-parse', 'HEAD^{tree}']).stdout.strip()
            wrong_env = {**env, 'GIT_AUTHOR_EMAIL': 'synthetic@example.com', 'GIT_COMMITTER_EMAIL': 'noreply@github.com'}
            wrong = subprocess.run(['git', 'commit-tree', tree, '-p', sha, '-m', 'test: synthetic author rejection'], cwd=root, env=wrong_env, capture_output=True, text=True)
            self.assertEqual(wrong.returncode, 0)
            record = f'refs/heads/sample {wrong.stdout.strip()} refs/heads/sample {sha}\n'
            self.assertNotEqual(run(['bash', '.githooks/pre-push'], input=record).returncode, 0)
            deletion = f'refs/heads/main {"0" * 40} refs/heads/main {sha}\n'
            self.assertNotEqual(run(['bash', '.githooks/pre-push'], input=deletion).returncode, 0)


if __name__ == '__main__':
    unittest.main()
