/** One key for a machine however it is spelled: polar-night-owl, polar_night_owl and Polar Night Owl are the same host. */
export const hostKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Tailscale assigns addresses from the CGNAT block 100.64.0.0/10. Probing is limited to it so this can never be aimed at the public internet or the local LAN. */
export function isTailscaleIp(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value.trim());
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  return [a, b, c, d].every(part => part <= 255) && a === 100 && b >= 64 && b <= 127;
}

export type AddressKind = "tailscale" | "private" | "public";

/** Classifies an IPv4 literal; anything else (a name) has no kind and is not listed as an address. */
export function addressKind(value: string): AddressKind | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match || match.slice(1).some(part => Number(part) > 255)) return null;
  if (isTailscaleIp(value)) return "tailscale";
  const [a, b] = match.slice(1).map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? "private" : "public";
}

/** Keys shared by two differently spelled names (web-1 and web1). hostKey is only an alias; a shared key cannot pick one machine, so nothing is joined through it. */
export function ambiguousHostKeys(names: string[]): Set<string> {
  const spellings = new Map<string, Set<string>>();
  for (const name of names) { const key = hostKey(name); spellings.set(key, (spellings.get(key) ?? new Set()).add(name.trim().toLowerCase())); }
  return new Set([...spellings].filter(([, set]) => set.size > 1).map(([key]) => key));
}
