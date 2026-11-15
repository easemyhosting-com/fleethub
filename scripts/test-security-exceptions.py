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
    # The retired EX-001 record keeps the scope rules exercised if an exception is reintroduced.
    retired = {"id": "EX-001", "finding": "AVD-DS-0002", "path": "cliproxy/Dockerfile", "severity": "HIGH", "owner": "@easemyhosting-com",
               "review_by": "2026-12-15", "reason": "Synthetic fixture.", "risk": "Synthetic fixture.", "compose_path": "compose.yml", "service": "cli-proxy-api"}

    def setUp(self):
        self.text = "```json\n" + json.dumps({"exceptions": [self.retired]}, indent=2) + "\n```\n"

    def test_current_record(self):
        policy.validate(self.text, date(2026, 11, 15))

    def test_repository_policy_has_no_open_exception(self):
        current = (Path(__file__).parent.parent / "security/known-exceptions.md").read_text()
        policy.validate(current, date(2027, 1, 1))
        self.assertIn('"exceptions": []', current)

    def test_second_exception_fails(self):
        doubled = "```json\n" + json.dumps({"exceptions": [self.retired, {**self.retired, "id": "EX-002"}]}) + "\n```\n"
        with self.assertRaises(ValueError):
            policy.validate(doubled, date(2026, 11, 15))

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
