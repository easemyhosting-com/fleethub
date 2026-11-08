import { describe, expect, it } from "vitest";
import { connectorKindLabel, connectorLastScanLabel, defaultConnectorSelection } from "@/lib/connectors/view";

describe("connector view helpers", () => {
  it("maps known connector kinds to user-facing labels", () => {
    expect(["kubernetes", "docker", "prometheus"].map(connectorKindLabel)).toEqual(["Kubernetes", "Docker", "Prometheus"]);
    expect(connectorKindLabel("other")).toBe("other");
  });

  it("selects apps and services while leaving platform projects out", () => {
    const projects = ["app", "service", "platform"].map((kind, index) => ({ slug: `project-${index}`, kind })) as never[];
    expect(defaultConnectorSelection(projects as never)).toEqual(["project-0", "project-1"]);
  });

  it("labels missing and present scans", () => {
    expect(connectorLastScanLabel(null)).toBe("Never scanned");
    expect(connectorLastScanLabel("2026-01-01T00:00:00.000Z")).toBe(new Date("2026-01-01T00:00:00.000Z").toLocaleString());
  });
});
