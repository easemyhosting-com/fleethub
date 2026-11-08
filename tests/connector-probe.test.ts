import { describe, expect, it } from "vitest";
import { isTailscaleIp, otherWays, parseTailscaleInput, probeHosts, suggestionsFor } from "@/lib/connectors/probe";

describe("tailscale probe", () => {
  it("accepts only the CGNAT block", () => {
    expect(isTailscaleIp("100.101.50.7")).toBe(true);
    expect(isTailscaleIp("100.64.0.1")).toBe(true);
    expect(isTailscaleIp("100.127.255.255")).toBe(true);
    for (const bad of ["100.128.0.1", "100.63.255.255", "10.0.0.1", "192.168.1.1", "169.254.169.254", "127.0.0.1", "100.101.50.256", "100.101.50", "example.com", ""]) expect(isTailscaleIp(bad)).toBe(false);
  });
  it("parses tailscale status output and plain lists, dropping non-Tailscale addresses", () => {
    const text = "100.101.50.7  atlas  me@  linux  -\n100.64.1.2 borealis tagged-devices linux idle\n192.168.1.5 lan\n100.64.1.2 dup\nnot an address\n100.70.0.1,100.70.0.2; 100.70.0.3";
    expect(parseTailscaleInput(text)).toEqual([{ ip: "100.101.50.7", name: "atlas" }, { ip: "100.64.1.2", name: "borealis" }, { ip: "100.70.0.1", name: null }, { ip: "100.70.0.2", name: null }, { ip: "100.70.0.3", name: null }]);
    expect(parseTailscaleInput("100.70.0.1 alpha 100.70.0.2 beta")).toEqual([{ ip: "100.70.0.1", name: "alpha" }, { ip: "100.70.0.2", name: "beta" }]);
  });
  it("probes a fixed port list only on Tailscale addresses and builds suggestions", async () => {
    const calls: string[] = [];
    const hosts = await probeHosts([{ ip: "100.101.50.7", name: "atlas" }, { ip: "8.8.8.8", name: "evil" }], { connector: async (ip, port) => { calls.push(`${ip}:${port}`); return port === 2375; } });
    expect(calls.sort()).toEqual(["100.101.50.7:2375", "100.101.50.7:2376", "100.101.50.7:6443", "100.101.50.7:9090"]);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].open).toEqual([2375]);
    expect(hosts[0].suggestions).toEqual([expect.objectContaining({ kind: "docker", url: "http://100.101.50.7:2375", allowHttp: true })]);
    expect(hosts[0].otherWays.join(" ")).toMatch(/GitOps/);
    expect(hosts[0].otherWays.join(" ")).not.toMatch(/socket proxy compose/);
  });
  it("caps hosts and lists every way when nothing answers", async () => {
    const peers = Array.from({ length: 40 }, (_, i) => ({ ip: `100.64.0.${i + 1}`, name: null }));
    expect(await probeHosts(peers, { connector: async () => false })).toHaveLength(16);
    expect(otherWays([])).toHaveLength(5);
    expect(suggestionsFor("100.64.0.1", [6443])[0]).toMatchObject({ kind: "kubernetes", url: "https://100.64.0.1:6443", allowHttp: false });
  });
});
