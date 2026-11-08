import { isIP } from "node:net";
import { z } from "zod";

const hostName = z.string().max(253).refine(value => isIP(value) !== 0 || value.split(".").every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)), "Use an IP address or hostname, not a URL or SSH command");
export const hostEnrollmentInput = z.strictObject({
  host: hostName,
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).default("fleethub"),
  mode: z.enum(["guided", "assisted"]).default("guided"),
  provider: z.enum(["oracle", "oci", "other", "unknown"]).default("unknown"),
  hostId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  isProtected: z.boolean().default(true),
  isProduction: z.boolean().default(true),
  hostKeyFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/).optional(),
  sshCredentialRef: z.string().regex(/^ref-[A-Za-z0-9_-]{1,128}$/).optional(),
});

export function planHostEnrollment(input: unknown) {
  const target = hostEnrollmentInput.parse(input);
  const inventoryOnly = target.provider === "oracle" || target.provider === "oci" || target.isProtected || target.isProduction;
  const blockers = ["authoritative_host_policy_not_verified", "no_approved_execution_worker"];
  if (inventoryOnly) blockers.push("inventory_only_target");
  if (!target.hostId) blockers.push("registered_host_required");
  if (target.mode === "assisted" && !target.hostKeyFingerprint) blockers.push("trusted_host_key_required");
  if (target.mode === "assisted" && !target.sshCredentialRef) blockers.push("scoped_ssh_access_required");
  if (target.username === "root") blockers.push("dedicated_non_root_account_recommended");
  return {
    version: 1,
    kind: "host_enrollment_plan",
    executionEnabled: false,
    inputTrust: "unverified_caller_description",
    verificationPerformed: false,
    target,
    disposition: inventoryOnly ? "inventory_only" : "proposal_requires_verification_and_approval",
    blockers,
    proposedOperations: inventoryOnly ? ["register_inventory"] : [
      "confirm_registered_host_policy", "verify_host_key_out_of_band", "inspect_host_readonly",
      "approve_exact_bootstrap_plan", "install_tailscale_if_absent", "enroll_with_one_time_tagged_key",
      "verify_private_connectivity", "register_inventory", "remove_temporary_bootstrap_access",
    ],
    requiredApprovalEvidence: ["registered_host_id_and_policy_revision", "independently_verified_host_key", "reviewed_installer_version", "exact_target_and_operations", "single_use_expiring_human_approval"],
    secretHandling: "References only. No SSH key, vault value, or enrollment token is returned or retrieved.",
    networkPolicyChanges: "Not authorized: no firewall, routes, exit-node, SSH-server, or tailnet-wide policy changes.",
    nextStep: inventoryOnly ? "Register or inspect inventory; do not install software or place workloads." : "Review this proposal. Host verification, approvals, and a restricted worker must be implemented before execution.",
  };
}
