import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("targets", Path(__file__).with_name("assert-trivy-targets.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TargetTests(unittest.TestCase):
    def test_empty_or_unrelated_scans_fail(self):
        for value in [None, {}, {"Results": []}, {"Results": [{"Type": "npm", "Class": "lang-pkgs"}]}]:
            self.assertFalse(module.has_dockerfile_target(value))

    def test_zero_findings_still_requires_a_scanned_target(self):
        self.assertTrue(module.has_dockerfile_target({"Results": [{"Target": "Dockerfile", "Type": "dockerfile", "Class": "config"}]}))


if __name__ == "__main__":
    unittest.main()
