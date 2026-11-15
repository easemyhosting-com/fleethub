import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/onboarding/cliproxy-capabilities/route";
import { createSessionToken } from "../src/lib/auth/session";

const mocks = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("@/lib/auth/sessions", async importOriginal => (await import("./helpers/session-store-mock")).sessionStoreMock(await importOriginal<typeof import("../src/lib/auth/sessions")>()));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: async () => ({ success: true }) }));
vi.mock("@/lib/onboarding/service", () => ({ getSetupState: async () => ({ steps: [{ id: "cliproxy", status: "configured", config: {} }] }) }));
vi.mock("@/lib/cliproxy/capabilities", () => ({ inspectCliProxy: mocks.inspect }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "capability-auth-regression-secret-at-least-32-bytes");
  vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
  vi.stubEnv("FLEETHUB_API_KEY", "fixture-admin-key");
  vi.stubEnv("FLEETHUB_READONLY_KEY", "fixture-read-only-key");
  mocks.inspect.mockResolvedValue({ schemaVersion: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it("accepts an operator's browser GET without an Origin header", async () => {
  const token = createSessionToken({ id: "capability-operator", email: "operator@example.test", name: "Operator", provider: "local", createdAt: Date.now() });
  const response = await GET(new Request("http://localhost/api/onboarding/cliproxy-capabilities", {
    headers: { cookie: `fleethub_session=${token}`, "sec-fetch-site": "same-origin" },
  }));
  expect(response.status).toBe(200);
  expect(mocks.inspect).toHaveBeenCalledOnce();
});

it("denies a read-only API key before probing", async () => {
  const response = await GET(new Request("http://localhost/api/onboarding/cliproxy-capabilities", {
    headers: { "x-api-key": "fixture-read-only-key" },
  }));
  expect(response.status).toBe(403);
  expect(mocks.inspect).not.toHaveBeenCalled();
});

it("denies an unauthenticated request before probing", async () => {
  expect((await GET(new Request("http://localhost/api/onboarding/cliproxy-capabilities"))).status).toBe(401);
  expect(mocks.inspect).not.toHaveBeenCalled();
});
