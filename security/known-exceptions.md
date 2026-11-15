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
      "reason": "Owner accepts AVD-DS-0002 until 2026-12-15. The service is profile-gated by cliproxy and integrations. Both published ports bind to 127.0.0.1. No Docker socket, privileged mode, host network/pid/ipc namespaces, cap_add or devices are configured. Changing the root-home credential volume requires a tested migration.",
      "risk": "The pinned image defaults to root and holds provider credentials. Its configuration bind mount is writable. No cap_drop, no-new-privileges or read_only is configured. Other containers on the Compose network can reach it despite loopback-only host port publication.",
      "compose_path": "compose.yml",
      "service": "cli-proxy-api"
    }
  ]
}
```

Review due 30 days after 2026-11-15. CI fails once the review-by date has passed
in UTC; the date is inclusive. Expiry requires an owner decision, not an automatic
extension. The owner must choose a tested non-root migration or explicit temporary
acceptance. Changing this record does not change containers, ownership or volumes.
