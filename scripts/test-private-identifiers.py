"""Local synthetic tests; no real identity fixtures or network access."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import os
import shutil
import sys

sys.dont_write_bytecode = True
import unittest

MODULE = Path(__file__).with_name("check-private-identifiers.py")
spec = importlib.util.spec_from_file_location("private_identifiers", MODULE)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class PrivateIdentifierTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        (self.root / "sample.txt").write_text("SyntheticOwnerForTest uses synthetic-contact@example.invalid\n")
        subprocess.run(["git", "-C", str(self.root), "add", "sample.txt"], check=True)
        self.seed = self.root / "private-seed.txt"

    def test_missing_seed_is_safe(self):
        self.assertEqual(checker.scan(self.root, [self.seed]), [])

    def test_seed_and_lowercase_variants_report_locations_only(self):
        self.seed.write_text("name\tsyntheticownerfortest\nemail\tsynthetic-contact@example.invalid\n")
        hits = checker.scan(self.root, [self.seed])
        self.assertTrue(any(h[0] == "ID-1" for h in hits))
        self.assertTrue(any(h[0] == "ID-2" for h in hits))
        for hit in hits:
            self.assertEqual(hit[2:], ("sample.txt", 1))
            self.assertNotIn("SyntheticOwnerForTest", str(hit))
            self.assertNotIn("synthetic-contact", str(hit))

    def test_staged_identity_cannot_hide_behind_a_clean_working_copy(self):
        self.seed.write_text("literal\tSyntheticOwnerForTest\n")
        (self.root / "sample.txt").write_text("public example\n")
        self.assertEqual(checker.scan(self.root, [self.seed]), [])
        hits = checker.scan(self.root, [self.seed], staged=True)
        self.assertEqual(hits, [("ID-1", "full", "sample.txt", 1)])
        (self.root / "sample.txt").unlink()
        (self.root / "sample.txt").symlink_to("untracked-missing-target")
        self.assertEqual(checker.scan(self.root, [self.seed], staged=True), hits)

    def test_optional_supplement_is_scanned_without_seed(self):
        supplement = self.root / "supplement.txt"
        supplement.write_text("literal\tSyntheticOwnerForTest\n")
        self.assertTrue(checker.scan(self.root, [self.seed, supplement]))

    def test_name_fragments_are_lower_confidence(self):
        self.seed.write_text("name\tSyntheticOwnerForTest OtherSyntheticWord\n")
        hits = checker.scan(self.root, [self.seed])
        self.assertTrue(any(h[1] == "name fragment" for h in hits))

    def test_untracked_data_is_not_read(self):
        (self.root / "sample.txt").write_text("public example\n")
        self.seed.write_text("literal\tSyntheticOwnerForTest\n")
        (self.root / "untracked.txt").write_text("SyntheticOwnerForTest\n")
        self.assertEqual(checker.scan(self.root, [self.seed]), [])


    def test_shell_entry_point_with_and_without_ignored_seed(self):
        (self.root / "scripts").mkdir()
        shutil.copyfile(MODULE, self.root / "scripts/check-private-identifiers.py")
        shutil.copyfile(MODULE.with_name("check-repository-policy.py"), self.root / "scripts/check-repository-policy.py")
        (self.root / "security").mkdir()
        for policy_file in ["forbidden-patterns.txt", "suppression-patterns.txt", "allowed-email-domains.txt", "allowed-identifiers.txt"]:
            shutil.copyfile(MODULE.parent.parent / "security" / policy_file, self.root / "security" / policy_file)
        (self.root / ".gitignore").write_text("security/.local-forbidden*\n")
        environment = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(self.root / "empty-home")}
        command = ["bash", str(MODULE.with_name("check-forbidden.sh"))]
        clean = subprocess.run(command, cwd=self.root, env=environment, capture_output=True, text=True)
        self.assertEqual(clean.returncode, 0)
        self.seed.write_text("literal\tSyntheticOwnerForTest\n")
        link = self.root / "security/.local-forbidden.txt"
        link.symlink_to(self.seed)
        self.assertEqual(subprocess.run(["git", "check-ignore", "--quiet", str(link)], cwd=self.root).returncode, 0)
        found = subprocess.run(command, cwd=self.root, env=environment, capture_output=True, text=True)
        self.assertEqual(found.returncode, 1)
        self.assertIn("ID-1", found.stdout)
        self.assertNotIn("SyntheticOwnerForTest", found.stdout)
        self.assertEqual(subprocess.check_output(["git", "ls-files", "security/.local-forbidden.txt"], cwd=self.root), b"")


    def test_exact_approved_literal_does_not_hide_an_unrelated_match(self):
        (self.root / "security").mkdir()
        (self.root / "security/allowed-identifiers.txt").write_text("SyntheticOwnerForTest\tSynthetic approved example\tsample.txt\n")
        self.seed.write_text("literal\tSyntheticOwnerForTest\nliteral\tUnapprovedSyntheticValue\n")
        self.assertEqual(checker.scan(self.root, [self.seed]), [])
        (self.root / "sample.txt").write_text("SyntheticOwnerForTest UnapprovedSyntheticValue\n")
        hits = checker.scan(self.root, [self.seed])
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0][0], "ID-2")


if __name__ == "__main__":
    unittest.main()
