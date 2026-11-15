/** Deliberately invalid key material constructed at runtime, never a usable key. */
export function invalidPrivateKey(kind = ""): string {
  const label = `${kind ? `${kind} ` : ""}PRIVATE KEY`;
  return [`-----BEGIN ${label}-----`, "invalid-fixture-material".repeat(10), `-----END ${label}-----`].join("\n");
}
