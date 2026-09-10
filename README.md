# mcp-tada

[![npm mcp-tada](https://img.shields.io/npm/v/mcp-tada?label=mcp-tada)](https://www.npmjs.com/package/mcp-tada) [![npm mcp-tada-server](https://img.shields.io/npm/v/mcp-tada-server?label=mcp-tada-server)](https://www.npmjs.com/package/mcp-tada-server) [![CI](https://github.com/JoviDeCroock/mcp-tada/actions/workflows/ci.yml/badge.svg)](https://github.com/JoviDeCroock/mcp-tada/actions/workflows/ci.yml)

Compile-time typed [Model Context Protocol](https://modelcontextprotocol.io) tool calls for TypeScript. Zero runtime, no generated client code, no schema library at the type level.

Point it at a running MCP server once, and every `callTool` in your codebase gets:

- tool names as a union, so a typo is a compile error
- arguments inferred from the tool's `inputSchema`
- `structuredContent` typed from the tool's `outputSchema`
- the tool's description on hover
- the tool's annotations (`readOnlyHint`, `destructiveHint`, ...) at the type level, so you can hand an agent only the read-only tools

## Quick start

```sh
pnpm add mcp-tada @modelcontextprotocol/sdk
pnpm mcp-tada introspect --stdio "npx -y @modelcontextprotocol/server-filesystem ." --out src/fs.introspection.d.ts
```

```ts
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./fs.introspection.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const fs = initMcpTada<introspection>().typed(client);

const result = await fs.callTool("read_file", { path: "README.md" });
//                                ^ union of tool names   ^ inferred from inputSchema
if (!result.isError) {
  result.structuredContent;
  //     ^ typed from outputSchema when the server declares one, otherwise unknown
}
```

Tools whose input schema has no required properties can be called without an arguments object.

Every tool is also a method under `tools`, with the same argument and result types, so your editor lists them on `fs.tools.`:

```ts
const result = await fs.tools.read_file({ path: "README.md" });
```

The same two pieces power "code mode" agents: the snapshot is a TypeScript declaration an LLM can read, and `mcp.tools` is the API its generated program calls. See `examples/code-mode`.

## How it works

1. `mcp-tada introspect` connects to the server, pages through `tools/list`, and writes a `.d.ts` containing the tool map as a strict JSON type literal, with each tool's title and description as a JSDoc block, and its `annotations` when the server declares them. Nothing else is generated.
2. `initMcpTada<introspection>()` returns a thin wrapper around the SDK `Client`. At runtime it forwards to `client.callTool`. Everything else is type-level.
3. A small purpose-built JSON Schema to TypeScript mapper turns each schema into a type on demand. It accepts draft-07 and 2020-12 vocabularies: objects with `required` and `additionalProperties`, arrays and `prefixItems` tuples, `enum`, `const`, `anyOf`, `oneOf`, `allOf`, `type` arrays, `nullable`, and `$ref` into `$defs` or `definitions`.

Off-the-shelf type-level mappers were measured at over 12 million type instantiations on real server schemas. This one checks the same snapshot in about 25 thousand, so editor feedback stays instant.

## CLI

### `mcp-tada introspect`

```sh
# stdio server
mcp-tada introspect --stdio "npx -y @modelcontextprotocol/server-filesystem ." --out src/fs.introspection.d.ts

# Streamable HTTP server, with headers (falls back to the legacy SSE transport on a 4xx)
mcp-tada introspect --url https://example.com/mcp --header "Authorization: Bearer x" --out src/remote.introspection.d.ts

# raw JSON instead of a .d.ts
mcp-tada introspect --stdio "node server.js" --json --out tools.json
```

Flags: `--stdio` or `--command` plus repeatable `--arg` and `--env KEY=VAL`; `--url` plus repeatable `--header`; `--out`, `--name <TypeName>` for an extra exported alias, `--json`, `--verbose`, `--timeout <ms>` (default 30000, applied to connecting and to each `tools/list` request; also settable per server as `timeoutMs` in the config file). The file is left untouched when the output is byte-identical. Warnings are printed for tools without `outputSchema` and for schemas that `$ref` an external URI. With `--config` and more than one server selected, `--out` is rejected (every server would overwrite the same file) - give each server its own `output` in the config, or select a single alias.

### `mcp-tada check`

Diffs a live server against a snapshot and exits 1 on any drift: added or removed tools, changed input schemas, changed or newly present output schemas, and changed annotations. A tool that stopped being read-only or non-destructive is called out on its own line, since code written against the old snapshot may be trusting that hint. Run it in CI. Accepts the same target flags as `introspect`, including `--timeout <ms>`.

```sh
mcp-tada check --stdio "npx -y @modelcontextprotocol/server-filesystem ." --against src/fs.introspection.d.ts
```

### Config file

With no target flags, both commands read `mcp-tada.config.json` from the current directory, or the path given with `--config`, and act on every configured server. Pass a server alias as a positional argument to act on just one.

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "output": "src/filesystem.introspection.d.ts"
    },
    "remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer x" },
      "output": "src/remote.introspection.d.ts"
    }
  }
}
```

A Claude Desktop or Cursor style file with an `mcpServers` block is accepted too.

Full reference in `docs/cli.md`.

## API

- `initMcpTada<I>()` returns `{ typed(client) }`. The typed client exposes `callTool(name, args?, options?)`, `tools`, `listTools()`, and the underlying `client`.
- `tools` has one method per tool: `mcp.tools.read_file(args?, options?)` is `mcp.callTool("read_file", args?, options?)` with identical types. Names that aren't identifiers use bracket access, `mcp.tools["get-library-docs"](...)`. Since tool names only exist at the type level, `tools` is a `Proxy`: `Object.keys(mcp.tools)` is empty, and `then`, `catch`, `finally`, `toJSON`, `constructor`, and `prototype` are never resolved as tools (a tool with such a name is still reachable through `callTool`). Use `listTools()` for runtime discovery.
- `callTool`'s result is a union on `isError`: when `isError` is `false` or absent, `structuredContent` is typed from the tool's `outputSchema` (or `unknown` if it has none - the spec allows a server to send one anyway); when `isError` is `true`, `structuredContent` is optional/`unknown` and `content` is still present. Narrow on `result.isError` before reading `structuredContent`.
- `listTools()` on both the typed client and the combined client pages through `nextCursor` and returns every tool, not just the first page. The raw single-page SDK call is still reachable as `client.listTools(...)` on the typed client's underlying `client`.
- `ToolNames<I>`, `ToolArgs<I, N>`, `ToolOutput<I, N>`, `ToolResult<I, N>` for naming the derived types in your own signatures. `ToolOutput<I, N>` is the success-case `structuredContent` type.
- `FromSchema<S, Root = S>` maps an `inputSchema`-shaped JSON Schema to its TS type; objects are closed to their declared `properties` unless `additionalProperties` says otherwise. `FromOutputSchema<S, Root = S>` maps an `outputSchema` the same way, except objects with no `additionalProperties` stay open (`& { [k: string]: unknown }`), since a server's structured output may legitimately include fields it didn't declare.
- `Introspection` describes the snapshot shape: `{ tools: Record<string, { inputSchema: unknown; outputSchema?: unknown; annotations?: ToolAnnotations }> }`. Snapshots generated before annotations were recorded still satisfy it.
- `ReadOnlyToolNames<I>` is the union of tools annotated `readOnlyHint: true`, and `NonDestructiveToolNames<I>` adds those annotated `destructiveHint: false`. Unannotated tools count as writable and destructive, matching the spec's defaults. `ToolAnnotationsOf<I, N>` is one tool's recorded annotations, and `PickTools<I, Names>` narrows a snapshot to a set of tools while keeping it an `Introspection`.
- `readOnly(mcp)` is a view of a typed client that only knows the read-only tools: `callTool` and `tools` narrow to `ReadOnlyToolNames<I>`, and `listTools()` filters the live list on the same annotation, so it can go straight into an LLM's tool list. It forwards to the same underlying client, so it is a compile-time restriction plus a runtime filter on the list, not a sandbox.

```ts
const safe = readOnly(fs);
await safe.callTool("read_file", { path: "README.md" }); // ok
await safe.callTool("write_file", { path: "x", content: "" }); // compile error
const tools = await safe.listTools(); // only tools with readOnlyHint: true
```
- `combineMcpTada(clients, options?)` merges several typed clients into one, prefixing each tool name with its alias (default separator `"__"`) so same-named tools on different servers never collide. Throws at construction if an alias is empty or contains the separator, or if the separator is empty. Its `tools` nests each server's methods under its alias, so `combined.tools.gh.search(...)` needs no prefixed string.

```ts
const fs = initMcpTada<FsIntrospection>().typed(fsClient);
const gh = initMcpTada<GhIntrospection>().typed(ghClient);

const combined = combineMcpTada({ fs, gh });
await combined.callTool("fs__read_file", { path: "README.md" });
//                       ^ union of "fs__..." | "gh__..." tool names
await combined.tools.fs.read_file({ path: "README.md" }); // same call, no prefix to spell
const tools = await combined.listTools(); // Tool[], ready for an LLM's tool list
combined.servers.gh; // direct access to the underlying typed client
combined.split("gh__search"); // -> { server: "gh", tool: "search" }
```

## Keeping the snapshot honest

Tool lists can change, and so can what a tool promises about itself. Servers declare `tools.listChanged`, and the 2026-07-28 spec revision adds `ttlMs` and `cacheScope` to list results, which `introspect` records in the file header when present. A tool that exists in the snapshot but not on the server fails at runtime the same way a removed GraphQL field would. The snapshot is your contract, and `mcp-tada check` keeps it current.

## What to expect from real servers

`docs/survey.md` covers 23 public servers and 230 tools. About 15 percent of tools declare `outputSchema`, and adoption is all-or-nothing per server. Expect typed inputs everywhere and typed outputs where the server author opted in.

## Server side

Published separately as [`mcp-tada-server`](https://www.npmjs.com/package/mcp-tada-server).

Writing the server too? `mcp-tada-server` declares tools once with a typed handler, registers them so the exact JSON Schemas hit the wire, and hands you the same introspection type for a same-codebase client with no network round trip.

```sh
pnpm add mcp-tada-server mcp-tada @modelcontextprotocol/sdk
```

```ts
import { defineTools, registerTools, type IntrospectionOf } from "mcp-tada-server";

const tools = defineTools([{ name: "sum", inputSchema, handler: async (args) => ({ total: args.a + args.b }) }]);
registerTools(server, tools);
const mcp = initMcpTada<IntrospectionOf<typeof tools>>().typed(client);
```

## Examples

- `examples/notes`: a server declared with `mcp-tada-server`, its snapshot generated by the CLI, and a typed client that spawns it over stdio. Shows `isError` narrowing and that the CLI snapshot and `IntrospectionOf<typeof tools>` agree.
- `examples/deepwiki`: client only, against the public DeepWiki server, where every tool has an `outputSchema`.
- `examples/combined`: DeepWiki, Cloudflare docs, and Context7 behind one `combineMcpTada` client, with a prefixed tool list ready for an LLM.
- `examples/code-mode`: an LLM given one `run_code` tool and the snapshot as its API declaration, writing programs that call `mcp.tools.*` in a sandbox instead of one function call per tool.

```sh
pnpm --filter @mcp-tada/example-deepwiki start
```

## Development

```sh
pnpm install
pnpm run verify   # format, lint, build, typecheck, test
```

See `AGENTS.md` for contributor conventions and `.changeset/` for release notes.

## Status

Early. API may change before 1.0.
