import { afterEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => [initial === null ? { accounts: [], workspaces: [], credentials: [], consumers: [], contacts: [], projects: [], secretRefs: [], limited: false } : initial, vi.fn()] };
});
import AppAccountsPage from "../src/app/app-accounts/page";

function keyForm(node: ReactNode): ((event: unknown) => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = keyForm(child); if (found) return found; }
  }
  if (!isValidElement<{ autoComplete?: string; onSubmit?: (event: unknown) => Promise<void>; children?: ReactNode }>(node)) return;
  if (node.type === "form" && node.props.autoComplete === "off") return node.props.onSubmit;
  return keyForm(node.props.children);
}
afterEach(() => vi.unstubAllGlobals());
it("clears a submitted key before awaiting a network request, including rejection", async () => {
  let input = "synthetic-key";
  const form = { reset: () => { input = ""; } };
  vi.stubGlobal("FormData", class { value = input; get(name: string) { return name === "value" ? this.value : "Fixture"; } });
  const fetch = vi.fn(async () => { expect(input).toBe(""); throw new Error("Network unavailable"); });
  vi.stubGlobal("fetch", fetch);
  const submit = keyForm(AppAccountsPage());
  expect(submit).toBeDefined();
  await submit?.({ preventDefault: vi.fn(), currentTarget: form });
  expect(fetch).toHaveBeenCalledOnce();
  expect(input).toBe("");
});
