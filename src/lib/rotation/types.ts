export type RotationErrorCode =
  | "not_found" | "not_supported" | "rotator_missing" | "invalid_config" | "scope_mismatch" | "busy"
  | "vault_unavailable" | "provider_rejected" | "store_failed_after_roll";

const messages: Record<RotationErrorCode, string> = {
  not_found: "Account not found or has no stored credentials",
  not_supported: "Rotation is not available for this provider",
  rotator_missing: "Add a rotation credential for this account first",
  invalid_config: "The new credentials do not match the format this provider needs",
  scope_mismatch: "The new credentials point at a different account scope; register a new account instead",
  busy: "A collection or rotation is already running for this account; try again shortly",
  vault_unavailable: "The vault could not be reached or does not match the verified setup",
  provider_rejected: "The provider rejected the rotation request; check the rotation credential and its permissions",
  store_failed_after_roll: "The provider issued a new secret but it could not be stored. Create a new token and use Replace credentials",
};

export class RotationError extends Error {
  constructor(readonly code: RotationErrorCode, readonly fields: readonly string[] = []) { super(messages[code]); }
}

export type RotationTrigger = "manual" | "rotate" | "schedule";

export interface RotateInput {
  /** The account's current stored credential. Never returned to callers or logged. */
  current: Record<string, unknown>;
  /** The separately stored credential that is allowed to issue replacements. */
  rotatorSecret: string;
  signal: AbortSignal;
}

/** A provider-specific way to obtain a fresh credential without human steps. Register one per provider. */
export interface CredentialRotator {
  readonly providerId: string;
  readonly label: string;
  /** Plain-language instruction for the rotation credential, shown in the UI. */
  readonly rotatorHint: string;
  /** Returns the full replacement credential (same non-secret scope, new secret). */
  rotate(input: RotateInput): Promise<Record<string, unknown>>;
  /** Cheap check that a rotation credential is at least valid, before it is stored. */
  checkRotatorSecret(secret: string, signal: AbortSignal, scope: Record<string, unknown>): Promise<void>;
}
