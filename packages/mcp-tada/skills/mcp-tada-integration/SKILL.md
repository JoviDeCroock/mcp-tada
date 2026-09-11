---
name: mcp-tada-integration
description: Wire mcp-tada into a project so MCP tool calls are typed at compile time - config, snapshot, typed client, read-only views, multi-server clients, and the CI steps that keep the snapshot honest. Use when writing or reviewing code that calls an MCP server through mcp-tada.
---

# Using mcp-tada in a project

Two artifacts do the work: a committed `<alias>.introspection.d.ts` snapshot of the server's
`tools/list`, and a typed wrapper around the SDK `Client`. Nothing runs at type-check time.

## Setup

```sh
npm install -D mcp-tada @modelcontextprotocol/sdk
npx mcp-tada init        # mcp-tada.config.json from .mcp.json / .cursor / .vscode / Claude Desktop
npx mcp-tada introspect  # one snapshot per configured server
npx mcp-tada doctor      # versions, config, snapshots, live servers
```

The config is meant to be committed, so keep secrets out of `env` / `headers` and in the
environment instead; `init` warns about keys that look like secrets. Without a config, target a
server directly: `--stdio "..."` or `--url ... --header "..."`, plus `--out`.

Commit the snapshots. Their diff is the contract review: a widened input, a new `outputSchema`,
or a tool that stopped being read-only shows up next to the code that depends on it.

## The client

```ts
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./fs.introspection.js";

const fs = initMcpTada<introspection>().typed(client); // a connected SDK Client

const result = await fs.tools.read_file({ path: "README.md" });
if (!result.isError) result.structuredContent; // typed from outputSchema, else unknown
```

- Prefer `mcp.tools.<name>(args)` over `mcp.callTool("<name>", args)`. Same types, but only the
  `tools` form shows the server's description and `@param` docs on hover. Non-identifier names
  use bracket access: `mcp.tools["get-library-docs"](...)`.
- Always narrow on `result.isError` before reading `structuredContent`. The result is a union on
  that field. Skipping the check is the most common mistake.
- A tool whose input schema has no required properties is callable with no arguments.
- `structuredContent` is `unknown` when the server declares no `outputSchema`. Most public
  servers declare none. Validate it or use the text `content`; don't cast.

## Restricting and combining

- `readOnly(mcp)` narrows `callTool` and `tools` to tools annotated `readOnlyHint: true` and
  filters `listTools()` the same way, ready for an LLM's tool list. Unannotated tools count as
  writable. It forwards to the same client, so it is not a sandbox.
- `combineMcpTada({ fs, gh })` merges typed clients, prefixing tool names with the alias
  (`"fs__read_file"`). `combined.tools.fs.read_file(...)` skips the prefix;
  `combined.servers.gh` reaches the underlying client. Prompts are not merged; use
  `servers.<alias>.getPrompt(...)`.
- For a code-mode agent, give the model the snapshot text as the API declaration and let its
  program call `mcp.tools.*` in a sandbox. `node:vm` isolates scope, not privileges.

## CI

```yaml
- run: npx mcp-tada introspect
- run: git diff --exit-code -- '**/*.introspection.d.ts'   # uncommitted regeneration
- run: npx mcp-tada check                                  # live server drifted
```

Use `check --fail-on dangerous` for a third-party server that adds tools often: it fails only
when something is removed or a safety hint withdrawn. Pair it with a scheduled plain `check`,
since additive drift still leaves the snapshot stale. Both steps need the servers reachable
from CI, with credentials in the runner's environment.

## Gotchas

- Never hand-edit a snapshot. Re-run `introspect`; it leaves an unchanged file untouched.
- `mcp.tools` is a `Proxy` over type-level names: `Object.keys(mcp.tools)` is empty, and
  `then` / `catch` / `finally` / `toJSON` / `constructor` / `prototype` never resolve as tools
  (use `callTool` for such a name). Use `listTools()` for runtime discovery.
- `listTools()` pages through `nextCursor`; the single-page SDK call is `mcp.client.listTools()`.
- `getPrompt` has no valid name on a snapshot of a server without the `prompts` capability.
- Script `introspect` / `check` from `mcp-tada/cli`, not `mcp-tada`. The main entry has no
  `node:fs` or transport imports on purpose.
