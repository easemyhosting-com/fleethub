"""Policy tests use injected calendar dates; the CI entry point uses real UTC."""
import importlib.util
import json
from datetime import date
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("exceptions", Path(__file__).with_name("check-security-exceptions.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ExceptionTests(unittest.TestCase):
    def setUp(self):
        self.text = (Path(__file__).parent.parent / "security/known-exceptions.md").read_text()

    def test_current_record(self):
        policy.validate(self.text, date(2026, 11, 15))

    def test_review_date_is_inclusive(self):
        policy.validate(self.text, date(2026, 12, 15))

    def test_next_utc_day_fails(self):
        with self.assertRaises(ValueError):
            policy.validate(self.text, date(2026, 12, 16))

    def test_scope_and_severity_cannot_be_changed(self):
        for old, new in [("cliproxy/Dockerfile", "Dockerfile"), ("HIGH", "LOW"), ("AVD-DS-0002", "AVD-DS-0001"), ("cli-proxy-api", "another-service"), ("compose.yml", "other.yml")]:
            with self.assertRaises(ValueError):
                policy.validate(self.text.replace(old, new), date(2026, 11, 15))

    def test_missing_owner_and_extended_deadline_fail(self):
        for old, new in [("@easemyhosting-com", ""), ("2026-12-15", "2027-01-15")]:
            with self.assertRaises(ValueError):
                policy.validate(self.text.replace(old, new), date(2026, 11, 15))


if __name__ == "__main__":
    unittest.main()
