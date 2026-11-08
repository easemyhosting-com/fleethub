import type { CredentialRotator } from "./types";

const rotators = new Map<string, CredentialRotator>();

/** Adding a provider's rotation is one registerRotator call; nothing else in the pipeline changes. */
export function registerRotator(rotator: CredentialRotator): void {
  if (rotators.has(rotator.providerId)) throw new Error(`Rotator for ${rotator.providerId} is already registered`);
  rotators.set(rotator.providerId, rotator);
}

export function getRotator(providerId: string): CredentialRotator | undefined { return rotators.get(providerId); }
export function listRotators(): CredentialRotator[] { return [...rotators.values()]; }
export function resetRotatorsForTests(): void { rotators.clear(); }
