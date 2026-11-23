import { createElement } from "react";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { CapacityLimitsPanel } from "../src/components/CapacityLimitsPanel";

it("keeps the catalog links reachable before limits load or when loading fails", () => {
  const renderer: unknown = createRequire(import.meta.url)("react-dom/server");
  if (typeof renderer !== "object" || renderer === null || !("renderToStaticMarkup" in renderer) || typeof renderer.renderToStaticMarkup !== "function") throw new Error("React server renderer unavailable");
  // Effects do not run on the server, so this renders the same no-data branch a failed request leaves behind.
  const html: unknown = renderer.renderToStaticMarkup(createElement(CapacityLimitsPanel));
  expect(typeof html).toBe("string");
  expect(html).toContain('href="/freebies"');
  expect(html).toContain('href="/compare/object-storage"');
  expect(html).toContain("Loading limits");
});
