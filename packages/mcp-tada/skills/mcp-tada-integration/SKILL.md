---
name: mcp-tada-integration
description: Wire mcp-tada into a project so MCP tool calls are typed at compile time - config, snapshot, typed client, read-only views, multi-server clients, the in-memory mock client for tests, and the CI steps that keep the snapshot honest. Use when writing or reviewing code that calls an MCP server through mcp-tada.
---

# Using mcp-tada in a project

Two artifacts do the work: a committed `<alias>.introspection.d.ts` snapshot of the server's
`tools/list`, and a typed wrapper around the SDK `Client`. Nothing runs at type-check time.

## Setup

```sh
npm install -D mcp-tada @modelcontextprotocol/client
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

const fs = initMcpTada<introspection>().typed(client); // a connected SDK Client, v1 or v2

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
  `combined.servers.gh` reaches the underlying client. Prompts are prefixed the same way:
  `combined.getPrompt("gh__summarize", args)`, and `listPrompts()` returns prefixed names.
- Resources are not merged; use `servers.<alias>.readResource(...)`.
- `mcp.readResource(uri)` completes the snapshot's static resource URIs (any string is accepted)
  and narrows `contents[].mimeType` for a known one. `mcp.readResourceTemplate(name, params)`
  types `params` from the template's `{variables}` (query `{?a,b}` ones optional), expands it, and
  reads the result. Both need the server to declare the `resources` capability when the snapshot
  was taken; `listResources()` / `listResourceTemplates()` return `[]` on a server without it.
- For a code-mode agent, give the model the snapshot text as the API declaration and let its
  program call `mcp.tools.*` in a sandbox. `node:vm` isolates scope, not privileges.

## Testing

`mcp-tada/testing` exports `mockMcpTada<introspection>({ tools, prompts, resources, resourceTemplates })`, a `TypedClient`
backed by in-memory handlers instead of a server, so code that takes a typed client can be
tested without spawning one.

```ts
import { mockMcpTada } from "mcp-tada/testing";

const mcp = mockMcpTada<introspection>({
  tools: {
    read_file: ({ path }) => ({ content: [{ type: "text", text: `contents of ${path}` }] }),
    get_weather: ({ city }) => ({ temperature: 20, conditions: `sunny in ${city}` }),
  },
});

await runAgent(mcp);
expect(mcp.calls).toEqual([{ name: "read_file", args: { path: "README.md" } }]);
```

- Handler arguments are typed from the tool's `inputSchema`. A tool with an `outputSchema` may
  return the bare `structuredContent`; the mock wraps it the way an SDK server would. A tool
  without one must return a full result.
- Every map is partial. An unmocked tool, prompt, or resource throws, naming it, so a test only describes
  what it exercises.
- `calls` and `promptCalls` are unions on `name`, so `call.name === "x"` narrows `args`.
  `resourceCalls` records `{ uri }` for `readResource` and `{ name, params }` for templates.
  `reset()` clears them.
- It is a real `TypedClient`, so `readOnly` and `combineMcpTada` accept it. `client` throws on
  access, since there is no SDK client behind it, and `listTools()` reports the mocked names only.

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
- `typed(client)` accepts a `Client` from SDK v1 (`@modelcontextprotocol/sdk`) or v2
  (`@modelcontextprotocol/client`), and the CLI runs on whichever is installed (v2 first;
  `MCP_TADA_SDK=v1|v2` forces one). Install at least one of them next to mcp-tada.
- `getPrompt` has no valid name on a snapshot of a server without the `prompts` capability, and
  `readResourceTemplate` none on a snapshot without `resources`. `readResource` always accepts a
  string; only the `mimeType` narrowing needs the snapshot.
- `readResourceTemplate` throws when the live server no longer lists the template by that name:
  the snapshot has the template string as a type only, so the runtime asks the server for it once.
- Script `introspect` / `check` from `mcp-tada/cli`, not `mcp-tada`. The main entry has no
  `node:fs` or transport imports on purpose.
