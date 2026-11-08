export interface PickerIdentity { id: string; displayName: string; email: string | null; emails: string[] }
export type IdentityChoice =
  | { mode: "existing"; identityId: string; email?: string }
  | { mode: "new"; name: string; email: string };

type ApiIdentity = { id: string; displayName: string; contacts?: Array<{ kind: string; value: string; isPrimary: boolean }> };

/** Reduces the identities API response to what a picker needs: a name and the primary email. */
export function pickerIdentities(identities: ApiIdentity[]): PickerIdentity[] {
  return identities.map(identity => {
    const emails = (identity.contacts ?? []).filter(contact => contact.kind === "email");
    const email = (emails.find(contact => contact.isPrimary) ?? emails[0])?.value ?? null;
    return { id: identity.id, displayName: identity.displayName, email, emails: emails.map(contact => contact.value) };
  });
}

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter(Boolean);
  return (words.length ? words : [local]).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Preselects the identity whose email matches the hint, or proposes a new one named after it; null when nothing is known. */
export function suggestIdentity(identities: PickerIdentity[], email: string | null): IdentityChoice | null {
  if (!email) return null;
  const match = identities.find(identity => identity.emails.some(value => value.toLowerCase() === email.toLowerCase()));
  const spelled = match?.emails.find(value => value.toLowerCase() === email.toLowerCase());
  return match ? { mode: "existing", identityId: match.id, email: spelled } : { mode: "new", name: nameFromEmail(email), email };
}

export function choiceIsValid(choice: IdentityChoice | null): boolean {
  if (!choice) return false;
  if (choice.mode === "existing") return choice.identityId.length > 0;
  return choice.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(choice.email.trim());
}

/** The email an existing-person choice will use: the one picked, else the person's primary. */
export function choiceEmail(identities: PickerIdentity[], choice: IdentityChoice | null): string | null {
  if (!choice) return null;
  if (choice.mode === "new") return choice.email.trim() || null;
  const person = identities.find(identity => identity.id === choice.identityId);
  return choice.email && person?.emails.includes(choice.email) ? choice.email : (person?.email ?? null);
}
