import { describe, expect, it } from "vitest";
import { markTourDone, shouldAutoStartTour, tourStorageKey, tourSteps } from "../src/lib/tour/steps";
const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }; };
describe("guided tour", () => {
 it("starts once for a first-time visitor and stays dismissed", () => {
  const storage = memory();
  expect(shouldAutoStartTour(storage)).toBe(true);
  markTourDone(storage);
  expect(storage.getItem(tourStorageKey)).toBe("done");
  expect(shouldAutoStartTour(storage)).toBe(false);
 });
 it("never throws when storage is blocked or missing", () => {
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  expect(shouldAutoStartTour(blocked)).toBe(false);
  expect(() => markTourDone(blocked)).not.toThrow();
  expect(shouldAutoStartTour(undefined)).toBe(false);
  expect(() => markTourDone(undefined)).not.toThrow();
 });
 it("has unique steps with the documented order and honest claims", () => {
  expect(new Set(tourSteps.map(s => s.id)).size).toBe(tourSteps.length);
  expect(tourSteps.map(s => s.id)).toEqual(["welcome", "operator", "setup", "account", "resources", "agents"]);
  const text = JSON.stringify(tourSteps).toLowerCase();
  expect(text).toContain("inventory-only"); expect(text).toContain("never shown as zero"); expect(text).toContain("read-only");
  expect(text).not.toMatch(/deploy to|install an agent|run commands/);
  expect(tourSteps.flatMap(s => s.action ? [s.action.kind] : [])).toEqual(["auth", "setup", "provider"]);
 });
});
