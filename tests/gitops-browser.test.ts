import { describe, expect, it } from "vitest";
import { filterGitopsFiles, hostRequestTotals } from "@/lib/gitops/browser";

function file(name: string, size = 10, webkitRelativePath = `checkout/${name}`) {
  return { name, size, webkitRelativePath } as File;
}

describe("filterGitopsFiles", () => {
  it("keeps YAML manifests, strips the checkout root, and skips unsafe paths before reading", () => {
    const result = filterGitopsFiles([
      file("deployment.yaml", 10, "repo/apps/shop/deployment.yaml"),
      file("secrets.yaml", 10, "repo/apps/shop/secrets.yaml"),
      file("safe.yml", 10, "repo/.git/config/safe.yml"),
      file("values.yaml", 10, "repo/node_modules/pkg/values.yaml"),
      file(".env.yaml", 10, "repo/apps/shop/.env.yaml"),
      file("notes.txt"),
      file("large.yaml", 200 * 1024 + 1),
    ]);
    expect(result.files.map(item => item.webkitRelativePath)).toEqual(["repo/apps/shop/deployment.yaml"]);
    expect(result.skipped.map(item => item.reason)).toEqual([
      "secret-looking name; file was not read", "ignored directory", "ignored directory",
      "secret-looking name; file was not read", "not a YAML manifest", "larger than 200 KB",
    ]);
  });

  it("limits accepted YAML files to 600", () => {
    const result = filterGitopsFiles(Array.from({ length: 601 }, (_, index) => file(`file-${index}.yaml`)));
    expect(result.files).toHaveLength(600);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("file limit reached (600 files)");
  });
});

describe("hostRequestTotals", () => {
  it("sums selected project declared requests per placement host", () => {
    const projects = [
      { slug: "shop", placements: [{ host: "borealis", declared: { cpuRequestMilli: 150, memRequestMi: 320 } }, { host: "pno", declared: { cpuRequestMilli: 200, memRequestMi: 512 } }] },
      { slug: "database", placements: [{ host: "borealis", declared: { cpuRequestMilli: 850, memRequestMi: 704 } }] },
      { slug: "platform", placements: [{ host: "borealis", declared: { cpuRequestMilli: 500, memRequestMi: 900 } }] },
    ];
    expect(hostRequestTotals(projects, ["shop", "database"])).toEqual({
      borealis: { cpuMilli: 1000, memoryMi: 1024 },
      pno: { cpuMilli: 200, memoryMi: 512 },
    });
  });
});
