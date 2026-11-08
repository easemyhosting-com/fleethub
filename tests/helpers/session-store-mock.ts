import { randomUUID } from "node:crypto";
import type * as Sessions from "../../src/lib/auth/sessions";
import { getSessionFromRequest } from "../../src/lib/auth/session";

export function sessionStoreMock(original: typeof Sessions) {
  return {
    ...original,
    resolveSession: async (req: Request) => {
      const user = getSessionFromRequest(req);
      return user ? { user, scope: "operator" as const } : { user: null, failure: "none" as const };
    },
    createServerSession: async () => `ses-${randomUUID()}`,
    revokeSession: async () => true,
  };
}
