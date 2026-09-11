---
name: mcp-tada-integration
description: Wire mcp-tada into a project so MCP tool calls are typed at compile time - config, snapshot, typed client, read-only views, multi-server clients, code-mode agents, and the CI steps that keep the snapshot honest. Use when adding a new example here, or when writing or reviewing code that calls an MCP server through mcp-tada.
---

# Using mcp-tada in a project

Two artifacts do all the work: a committed `introspection.d.ts` snapshot of the server's
`tools/list`, and a thin typed wrapper around the SDK `Client`. Nothing runs at type-check time
and nothing is generated beyond the snapshot.

## Setup

```sh
pnpm add mcp-tada @modelcontextprotocol/sdk
pnpm mcp-tada init        # writes mcp-tada.config.json from .mcp.json / .cursor / .vscode / Claude Desktop
pnpm mcp-tada introspect  # writes one snapshot per configured server
pnpm mcp-tada doctor      # verifies versions, config, snapshots, and that each server still matches
```

`init` copies `env` and `headers` verbatim and warns about values that look like secrets. The
config is meant to be committed, so move those into the environment instead. Without a config,
target a server directly with `--stdio "..."` or `--url ... --header "..."` plus `--out`.

Commit the snapshots. They are the contract: their diff is what shows a widened input, a new
`outputSchema`, or a tool that stopped being read-only, sitting in the pull request next to the
code that depends on it.

## The client

```ts
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./fs.introspection.js";

const fs = initMcpTada<introspection>().typed(client); // client is a connected SDK Client

const result = await fs.callTool("read_file", { path: "README.md" });
if (!result.isError) result.structuredContent; // typed from outputSchema, else unknown
```

Prefer `fs.tools.read_file({ ... })` over `fs.callTool("read_file", ...)`. The types are
identical, but a string tool name cannot carry documentation in TypeScript, so only the `tools`
form shows the server's description and `@param` tags on hover. Names that are not identifiers
use bracket access: `fs.tools["get-library-docs"](...)`.

Always narrow on `result.isError` before reading `structuredContent`. The result is a union on
that field; skipping the check is the most common mistake in code using this library.

## What to expect from a real server

About 15 percent of tools in the survey declare an `outputSchema`, and adoption is all-or-nothing
per server. Typed arguments everywhere, typed outputs only where the server author opted in. When
a server declares none, `structuredContent` is `unknown` and that is correct, not a bug to work
around with a cast — validate it, or use the tool's text `content`.

Tools whose input schema has no required properties are callable with no arguments object.

## Restricting and combining

`readOnly(mcp)` narrows `callTool` and `tools` to tools annotated `readOnlyHint: true` and
filters `listTools()` the same way, so the result can go straight into an LLM's tool list.
Unannotated tools count as writable and destructive, matching the spec's defaults. It is a
compile-time restriction plus a runtime list filter, not a sandbox — it forwards to the same
client, so a privilege boundary still needs a real one.

`combineMcpTada({ fs, gh })` merges typed clients under one, prefixing tool names with the alias
(`"fs__read_file"`, separator `"__"`) so same-named tools cannot collide. `combined.tools.fs.read_file(...)`
is the same call without spelling the prefix, and `combined.servers.gh` reaches the underlying
client. Prompts are not merged; get them through `servers.<alias>.getPrompt(...)`.

For a code-mode agent, hand the model the snapshot text as the API declaration and give its
generated program `mcp.tools` in a sandbox. `examples/code-mode` is the working version, including
the caveat that `node:vm` isolates scope, not privileges.

## Keeping it honest in CI

```yaml
- run: pnpm mcp-tada introspect
- run: git diff --exit-code -- '**/*.introspection.d.ts'   # someone forgot to commit a regen
- run: pnpm mcp-tada check                                  # the live server drifted
```

For a server you do not control that ships new tools often, `mcp-tada check --fail-on dangerous`
fails only when something is taken away or a safety hint is withdrawn, and stays quiet when the
server only adds. Pair it with a scheduled plain `check`, since additive drift still leaves the
snapshot stale.

Both steps need the servers reachable from CI, so put credentials in the runner's environment
rather than in the committed config.

## Gotchas

- Never hand-edit a snapshot. Re-run `introspect`; it leaves the file untouched when nothing
  changed.
- `mcp.tools` is a `Proxy` over type-level names, so `Object.keys(mcp.tools)` is empty and
  `then` / `catch` / `finally` / `toJSON` / `constructor` / `prototype` never resolve as tools
  (such a tool is still reachable through `callTool`). Use `listTools()` for runtime discovery.
- `listTools()` on the typed and combined clients pages through `nextCursor`; the raw single-page
  SDK call is still at `mcp.client.listTools(...)`.
- `getPrompt` only exists for servers that declare the `prompts` capability; a snapshot of a
  tools-only server has no `prompts` key and no valid prompt name.
- Import the CLI from `mcp-tada/cli`, not `mcp-tada`, when scripting `introspect` or `check` — the
  main entry deliberately has no `node:fs` or transport imports.
