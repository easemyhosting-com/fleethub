import type { ProviderPlugin, CollectResult, CollectContext } from "./types";

class PluginRegistry {
  private plugins = new Map<string, ProviderPlugin>();

  register(plugin: ProviderPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): ProviderPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): ProviderPlugin[] {
    return Array.from(this.plugins.values());
  }

  async collectAll(contexts: CollectContext[]): Promise<Map<string, CollectResult>> {
    const results = new Map<string, CollectResult>();

    await Promise.all(
      contexts.map(async (ctx) => {
        const plugin = this.get(ctx.accountId) || this.get(ctx.providerId ?? (ctx.accountId.startsWith("cf-") ? "cloudflare" : ctx.accountId.split("-")[0]));
        if (!plugin) return;

        try {
          const res = await plugin.collect(ctx);
          const key = `${plugin.id}:${ctx.accountId}`;
          results.set(key, res);
        } catch {
          const key = `${plugin.id}:${ctx.accountId}`;
          results.set(key, {
            resources: [],
            samples: [],
            health: { ok: false, latencyMs: 0, error: "Collection failed" },
          });
        }
      })
    );

    return results;
  }
}

export const pluginRegistry = new PluginRegistry();
