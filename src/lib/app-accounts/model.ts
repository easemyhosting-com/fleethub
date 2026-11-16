import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/);
const label = z.string().trim().min(1).max(120);
export const appAccountCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("account"), label, service: label, ownerContactId: id }),
  z.strictObject({ action: z.literal("workspace"), accountId: id, label }),
  z.strictObject({ action: z.literal("credential"), workspaceId: id, secretRefId: id, label,
    issuer: label, purpose: z.string().trim().min(1).max(300), environment: label,
    scopes: z.array(label).max(40), expiresAt: z.iso.datetime({ offset: true }).nullable(),
    validity: z.enum(["unknown", "active", "revoked"]) }),
  z.strictObject({ action: z.literal("consumer"), credentialId: id, projectId: id }),
  z.strictObject({ action: z.literal("unlink"), credentialId: id, projectId: id }),
]);
export type AppAccountCommand = z.infer<typeof appAccountCommand>;

const option = z.object({ id: z.string(), label: z.string() });
export const appAccountSnapshot = z.object({
  accounts: z.array(option.extend({ service: z.string(), owner: z.string(), contact: z.string() })),
  workspaces: z.array(option.extend({ accountId: z.string() })),
  credentials: z.array(option.extend({ workspaceId: z.string(), secretRefId: z.string(), issuer: z.string(),
    purpose: z.string(), environment: z.string(), scopes: z.array(z.string()),
    expiresAt: z.string().nullable(), validity: z.enum(["unknown", "active", "revoked"]) })),
  consumers: z.array(z.object({ credentialId: z.string(), projectId: z.string() })),
  contacts: z.array(option), projects: z.array(option), secretRefs: z.array(option),
  limited: z.boolean(),
});
export type AppAccountSnapshot = z.infer<typeof appAccountSnapshot>;
