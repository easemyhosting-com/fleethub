"""Exercise historical blob/message detection in a synthetic local Git repo."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent

class HistoryTests(unittest.TestCase):
    def test_old_bad_blob_is_detected_after_tip_is_cleaned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_AUTHOR_NAME': 'Example', 'GIT_COMMITTER_NAME': 'Example', 'GIT_AUTHOR_EMAIL': '347839428+easemyhosting-com@users.noreply.github.com', 'GIT_COMMITTER_EMAIL': 'noreply@github.com'}
            def git(*args):
                subprocess.run(['git', *args], cwd=root, env=env, check=True, capture_output=True)
            git('init', '--quiet')
            (root / 'sample.txt').write_text('public example\n')
            git('add', 'sample.txt'); git('commit', '-m', 'test: clean source')
            scan = lambda: subprocess.run(['python3', str(ROOT / 'scripts/check-history-policy.py')], cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(scan().returncode, 0)
            (root / 'sample.txt').write_text('/'.join(['', 'Users', 'x']))
            git('add', 'sample.txt'); git('commit', '-m', 'test: synthetic old path')
            (root / 'sample.txt').write_text('public example\n')
            git('add', 'sample.txt'); git('commit', '-m', 'test: clean tip')
            result = scan()
            self.assertEqual(result.returncode, 1)
            self.assertIn('local-path:', result.stdout)
            self.assertNotIn('/'.join(['', 'Users', 'x']), result.stdout)

if __name__ == '__main__':
    unittest.main()
