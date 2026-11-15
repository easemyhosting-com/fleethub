# Time-bounded security exceptions

This record does not suppress scanner output or change finding severity. The
application and gateway Dockerfile scans and the Compose configuration scan are gating. The owner must review
this file; required CODEOWNERS review must also be enabled in repository rules.

```json
{
  "exceptions": []
}
```

EX-001 (AVD-DS-0002, cliproxy/Dockerfile) was retired on 2026-11-16, before its
2026-12-15 review date. The gateway image now runs as a non-root user, Compose runs it
as the config file owner with a read-only root filesystem, and a one-shot step adopts
credential volumes written by the earlier root-run image. `scripts/verify-cliproxy-nonroot.sh`
is the disposable proof. The gateway Dockerfile scan is gating again.

Any new exception needs owner review, a review-by date and a tested remediation plan.
An exception never auto-extends.
