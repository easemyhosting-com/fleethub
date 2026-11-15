# Time-bounded security exceptions

This record does not suppress scanner output or change finding severity. Only the
optional image configuration scan below is non-gating. The main application
Dockerfile and Compose configuration scans remain gating. The owner must review
this file; required CODEOWNERS review must also be enabled in repository rules.

```json
{
  "exceptions": [
    {
      "id": "EX-001",
      "finding": "AVD-DS-0002",
      "path": "cliproxy/Dockerfile",
      "severity": "HIGH",
      "owner": "@easemyhosting-com",
      "review_by": "2026-12-15",
      "reason": "The optional upstream image has no non-root USER declaration. Its existing credential volume is mounted beneath the root home directory; changing identity without a reviewed volume migration can make credentials unreadable.",
      "risk": "Provider credentials are held by a root-running optional gateway. Published ports bind to loopback, but container-network access still matters. No Docker socket is mounted; no capability-drop, no-new-privileges or read-only-rootfs controls are declared for this service."
    }
  ]
}
```

Review due 30 days after 2026-11-15. CI fails once the review-by date has passed
in UTC; the date is inclusive. Expiry requires an owner decision, not an automatic
extension. The owner must choose a tested non-root migration or explicit temporary
acceptance. Changing this record does not change containers, ownership or volumes.
