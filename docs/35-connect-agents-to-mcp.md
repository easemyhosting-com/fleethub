# Connect coding agents to FleetHub (stdio MCP)

FleetHub ships a local, read-only MCP server. It lets a coding agent read the stored inventory, setup readiness and protection rules. It has no write, SSH, shell, secret or execution tools. See document 33 for its design and limits.

## Before you start

1. Run FleetHub (default `http://localhost:3060`).
2. Build the server once: `npm run build:mcp`. It writes `build/mcp-stdio.mjs`.
3. Create **one agent key per agent** in FleetHub: sign in, open **Agent access**, enter a name and expiry, and copy the `fhk_…` key (it is shown once). Agent keys are read-only, expire after 7, 30 or 90 days, and can be revoked at once. Use `FLEETHUB_READONLY_KEY` only if you do not want per-agent keys. Never give an agent `FLEETHUB_API_KEY`: it is administrative.
4. `FLEETHUB_URL` must be `https`, or `http` on `localhost`, `127.0.0.1` or `[::1]`.

The agent's configuration file stores the key in plain text (`~/.claude.json` or `~/.codex/config.toml`). Treat those files as secrets, and revoke the agent key in **Agent access** if one leaks.

Replace `/ABS/PATH/fleethub` with this repository's absolute path and `<AGENT_KEY>` with that agent's key. The environment variable is still named `FLEETHUB_READONLY_KEY`; it carries whichever read-only credential you give it.

## Claude Code

```bash
claude mcp add fleethub --scope user -e FLEETHUB_URL=http://localhost:3060 -e FLEETHUB_READONLY_KEY=<AGENT_KEY> -- node /ABS/PATH/fleethub/build/mcp-stdio.mjs
```

Run `claude mcp list` to confirm it connects. Remove it with `claude mcp remove fleethub`.

## Codex

```bash
codex mcp add fleethub --env FLEETHUB_URL=http://localhost:3060 --env FLEETHUB_READONLY_KEY=<AGENT_KEY> -- node /ABS/PATH/fleethub/build/mcp-stdio.mjs
```

Run `codex mcp list` to confirm it. Remove it with `codex mcp remove fleethub`.

## Agents run from T3 Code

T3 Code starts ordinary Claude Code and Codex sessions that you have already signed in to on the same machine. Register FleetHub with those CLIs as above (Claude Code at `--scope user` so it applies in every project folder). New threads started from T3 Code then see the same tools. This has not been run inside T3 Code here; if a thread does not show the tools, start a new thread or check `claude mcp list` from the project folder.

T3 Code's own MCP server is a different thing: it lets outside agents drive T3 Code over HTTP with OAuth. FleetHub does not need it and does not use it.

## What the tools return

- `get_fleet_context`: registered accounts, setup readiness, protection rules, unknowns.
- `list_resources`: the stored resource snapshot, with freshness and protection. Filter by `accountId`, `category`, `includeMissing`.
- `get_fleet_capacity`: inventory counts. CPU, memory and storage capacity are `null` until measured.
- `get_quotas`, `get_llm_endpoints`: quota is reported unavailable and the gateway endpoint as configured, never as measured usage.
- `plan_host_enrollment`: a non-executable proposal. It does not connect to hosts.

A failed or unreachable FleetHub returns an error result, not an empty inventory. Oracle (OCI) resources are always protected and inventory-only.

## Not supported yet

HTTP transport and MCP OAuth (so ChatGPT and other hosted agents cannot connect). Agent keys cannot yet be limited to particular accounts; each can read the whole stored inventory.
