import { expect, it, vi } from "vitest";
import { GET } from "../src/app/api/projects/footprint/route";
const bootstrap = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/guard", () => ({ verifyApiAccess: async () => ({ authorized: true }), createUnauthorizedResponse: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: bootstrap }));
it("rejects confirmed-only filtering without a project before reading inventory", async () => {
  const result = await GET(new Request("http://localhost/api/projects/footprint?confirmedOnly=true"));
  expect(result.status).toBe(400);
  expect(bootstrap).not.toHaveBeenCalled();
});
it("rejects malformed or project-combined resource filters before reading inventory", async () => {
  for (const query of ["resource=", `resource=${"a".repeat(513)}`, "resource=bad%0Aid", "resource=r1&project=app"]) {
    expect((await GET(new Request(`http://localhost/api/projects/footprint?${query}`))).status).toBe(400);
  }
  expect(bootstrap).not.toHaveBeenCalled();
});
