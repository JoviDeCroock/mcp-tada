# mcp-tada

[![npm mcp-tada](https://img.shields.io/npm/v/mcp-tada?label=mcp-tada)](https://www.npmjs.com/package/mcp-tada) [![npm mcp-tada-server](https://img.shields.io/npm/v/mcp-tada-server?label=mcp-tada-server)](https://www.npmjs.com/package/mcp-tada-server) [![CI](https://github.com/JoviDeCroock/mcp-tada/actions/workflows/ci.yml/badge.svg)](https://github.com/JoviDeCroock/mcp-tada/actions/workflows/ci.yml)

Compile-time typed [Model Context Protocol](https://modelcontextprotocol.io) tool calls for TypeScript. Zero runtime, no generated client code, no schema library at the type level.

Point it at a running MCP server once, and every `callTool` in your codebase gets:

- tool names as a union, so a typo is a compile error
- arguments inferred from the tool's `inputSchema`
- `structuredContent` typed from the tool's `outputSchema`
- the tool's description and each argument's description on hover
- the tool's annotations (`readOnlyHint`, `destructiveHint`, ...) at the type level, so you can hand an agent only the read-only tools
- `getPrompt` with prompt names as a union and arguments typed from each prompt's argument list

## Quick start

```sh
pnpm add mcp-tada @modelcontextprotocol/sdk
pnpm mcp-tada introspect --stdio "npx -y @modelcontextprotocol/server-filesystem ." --out src/fs.introspection.d.ts
```

Requires Node 22.18 or newer. TypeScript 5.4 or newer is supported and the test suite runs on both TypeScript 5 and 7.

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

Every tool is also a method under `tools`, with the same argument and result types, so your editor lists them on `fs.tools.` and shows the tool's description and argument descriptions when you hover a method:

```ts
const result = await fs.tools.read_file({ path: "README.md" });
```

A string tool name like `callTool("read_file", ...)` cannot carry documentation in TypeScript, so use the `tools` form when you want docs on hover.

Prompts get the same treatment when the server declares the `prompts` capability: the snapshot records each prompt's argument names and which are required, and `getPrompt` types them as strings.

```ts
const prompt = await fs.getPrompt("summarize", { path: "README.md" });
//                                 ^ union of prompt names   ^ required args string, optional args string?
```

The same two pieces power "code mode" agents: the snapshot is a TypeScript declaration an LLM can read, and `mcp.tools` is the API its generated program calls. See `examples/code-mode`.

## How it works

1. `mcp-tada introspect` connects to the server, pages through `tools/list` (and `prompts/list` when the server offers prompts), and writes a `.d.ts` containing the tool and prompt maps as a strict JSON type literal, with each entry's title and description as a JSDoc block, and each tool's `annotations` when the server declares them. Nothing else is generated.
2. `initMcpTada<introspection>()` returns a thin wrapper around the SDK `Client`. At runtime it forwards to `client.callTool`. Everything else is type-level.
3. A small purpose-built JSON Schema to TypeScript mapper turns each schema into a type on demand. It accepts draft-07 and 2020-12 vocabularies: objects with `required` and `additionalProperties`, arrays and `prefixItems` tuples, `enum`, `const`, `anyOf`, `oneOf`, `allOf`, `type` arrays, `nullable`, and `$ref` into `$defs` or `definitions`.

Off-the-shelf type-level mappers were measured at over 12 million type instantiations on real server schemas. This one checks the same snapshot in about 25 thousand, so editor feedback stays instant.

## CLI

### `mcp-tada init`

Writes `mcp-tada.config.json` from the servers your project already configures for its editor or agent, so the first `introspect` needs no flags. It reads the first of `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, or the Claude Desktop config, or the file given with `--from`, and gives every server an `output` under `src/` (or `--out-dir`). Values in `env` and `headers` are copied verbatim, and `init` warns about any that look like secrets. `--force` overwrites an existing config.

```sh
mcp-tada init
mcp-tada init --from ~/Library/Application\ Support/Claude/claude_desktop_config.json --out-dir src/mcp
```

### `mcp-tada doctor`

Runs the setup checks people otherwise discover one failed command at a time: the installed `@modelcontextprotocol/sdk` and `typescript` versions, that the config loads and no two servers share an `output`, that each snapshot exists and parses back, and, unless `--offline`, that each server answers and still matches its snapshot. Exits 1 on any failure. Warnings alone exit 0.

```sh
mcp-tada doctor
mcp-tada doctor --offline --config mcp-tada.config.json
```

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

Diffs a live server against a snapshot and exits 1 on any drift: added or removed tools, changed input schemas, changed or newly present output schemas, changed annotations, and added, removed, or re-argued prompts. Run it in CI. Accepts the same target flags as `introspect`, including `--timeout <ms>`.

```sh
mcp-tada check --stdio "npx -y @modelcontextprotocol/server-filesystem ." --against src/fs.introspection.d.ts
```

Each difference gets a severity, and the report is grouped by it, with the reason underneath:

```
mcp-tada check: differences from src/fs.introspection.d.ts (1 breaking, 1 dangerous, 1 additive)
  breaking:
    search: inputSchema changed
      .limit: is now required
  dangerous:
    delete-file: lost a safety guarantee
      destructiveHint is no longer false
  additive:
    summarize: added tool
```

Breaking means code written against the snapshot can stop working: a tool or prompt that went away, a newly required argument, an input schema that got stricter, an output schema that got looser. Direction matters, so the same edit is breaking on the way in and additive on the way out. Dangerous means the contract still holds but a tool withdrew a promise: it stopped being read-only, idempotent, non-destructive, or closed-world. Anything `check` cannot model counts as breaking rather than being waved through.

`--fail-on <level>` sets the least severe difference that fails the build: `any` (the default), `dangerous`, or `breaking`. Milder drift is still printed. `dangerous` is the setting for a server you do not control and that ships new tools regularly.

```sh
mcp-tada check --fail-on dangerous
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

- `initMcpTada<I>()` returns `{ typed(client) }`. The typed client exposes `callTool(name, args?, options?)`, `tools`, `listTools()`, `getPrompt(name, args?, options?)`, `listPrompts()`, and the underlying `client`.
- `tools` has one method per tool: `mcp.tools.read_file(args?, options?)` is `mcp.callTool("read_file", args?, options?)` with identical types. Names that aren't identifiers use bracket access, `mcp.tools["get-library-docs"](...)`. Since tool names only exist at the type level, `tools` is a `Proxy`: `Object.keys(mcp.tools)` is empty, and `then`, `catch`, `finally`, `toJSON`, `constructor`, and `prototype` are never resolved as tools (a tool with such a name is still reachable through `callTool`). Use `listTools()` for runtime discovery.
- `callTool`'s result is a union on `isError`: when `isError` is `false` or absent, `structuredContent` is typed from the tool's `outputSchema` (or `unknown` if it has none - the spec allows a server to send one anyway); when `isError` is `true`, `structuredContent` is optional/`unknown` and `content` is still present. Narrow on `result.isError` before reading `structuredContent`.
- `listTools()` on both the typed client and the combined client pages through `nextCursor` and returns every tool, not just the first page. The raw single-page SDK call is still reachable as `client.listTools(...)` on the typed client's underlying `client`.
- `ToolNames<I>`, `ToolArgs<I, N>`, `ToolOutput<I, N>`, `ToolResult<I, N>` for naming the derived types in your own signatures. `ToolOutput<I, N>` is the success-case `structuredContent` type.
- `getPrompt(name, args?, options?)` is `prompts/get` with `name` narrowed to the snapshot's prompts and `args` typed from the prompt's argument list: required arguments as `string`, optional ones as `string | undefined`, closed to the declared names, and omissible when nothing is required. The result is the SDK's `GetPromptResult`. `PromptNames<I>` and `PromptArgs<I, N>` name those types. A snapshot of a server without the `prompts` capability has no `prompts` key, so `getPrompt` has no valid name on it, and `listPrompts()` returns `[]` without a request when the connected server does not declare the capability.
- `FromSchema<S, Root = S>` maps an `inputSchema`-shaped JSON Schema to its TS type; objects are closed to their declared `properties` unless `additionalProperties` says otherwise. `FromOutputSchema<S, Root = S>` maps an `outputSchema` the same way, except objects with no `additionalProperties` stay open (`& { [k: string]: unknown }`), since a server's structured output may legitimately include fields it didn't declare.
- `Introspection` describes the snapshot shape: `{ tools: Record<string, { inputSchema: unknown; outputSchema?: unknown; annotations?: ToolAnnotations }>; prompts?: Record<string, { arguments: { name: string; required?: boolean }[] }> }`. Snapshots generated before annotations or prompts were recorded still satisfy it.
- `ReadOnlyToolNames<I>` is the union of tools annotated `readOnlyHint: true`, and `NonDestructiveToolNames<I>` adds those annotated `destructiveHint: false`. Unannotated tools count as writable and destructive, matching the spec's defaults. `ToolAnnotationsOf<I, N>` is one tool's recorded annotations, and `PickTools<I, Names>` narrows a snapshot to a set of tools, keeping its prompts, so it is still an `Introspection`.
- `readOnly(mcp)` is a view of a typed client that only knows the read-only tools: `callTool` and `tools` narrow to `ReadOnlyToolNames<I>`, and `listTools()` filters the live list on the same annotation, so it can go straight into an LLM's tool list. It forwards to the same underlying client, so it is a compile-time restriction plus a runtime filter on the list, not a sandbox.

```ts
const safe = readOnly(fs);
await safe.callTool("read_file", { path: "README.md" }); // ok
await safe.callTool("write_file", { path: "x", content: "" }); // compile error
const tools = await safe.listTools(); // only tools with readOnlyHint: true
```
- `combineMcpTada(clients, options?)` merges several typed clients into one, prefixing each tool name with its alias (default separator `"__"`) so same-named tools on different servers never collide. Prompts are not merged; reach them through `combined.servers.<alias>.getPrompt(...)`. Throws at construction if an alias is empty or contains the separator, or if the separator is empty. Its `tools` nests each server's methods under its alias, so `combined.tools.gh.search(...)` needs no prefixed string.

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

## Testing

`mcp-tada/testing` exports `mockMcpTada<introspection>(handlers)`, a `TypedClient` backed by in-memory handlers instead of a server. Each handler's arguments are typed from the tool's `inputSchema`, and its return is either a full result or, for a tool with an `outputSchema`, the bare `structuredContent`, which the mock wraps the way an SDK server would. Both maps are partial: calling an unmocked tool throws, naming it, so a test only describes what it exercises. Every call is recorded on `calls` (and `promptCalls`), as a union on `name` so a comparison narrows `args`.

```ts
import { mockMcpTada } from "mcp-tada/testing";

const mcp = mockMcpTada<introspection>({
  tools: {
    read_file: ({ path }) => ({ content: [{ type: "text", text: `contents of ${path}` }] }),
    get_weather: ({ city }) => ({ temperature: 20, conditions: `sunny in ${city}` }),
  },
});

await runAgent(mcp); // anything that takes a TypedClient<introspection>
expect(mcp.calls).toEqual([{ name: "read_file", args: { path: "README.md" } }]);
```

The mock is a real `TypedClient`, so `readOnly` and `combineMcpTada` accept it. Its `client` property throws on any access, since there is no SDK client behind it. `listTools()` reports the mocked names only; schemas live in the snapshot type.

## Workflow

The snapshot is a committed file, and the commands map onto the moments where it can go stale.

- **Setup.** List each server and its `output` in `mcp-tada.config.json`, then run `mcp-tada introspect` to write one snapshot per server. Commit the snapshots.
- **Editing.** Types come from the committed snapshot, so nothing runs while you edit. Re-run `introspect` when you upgrade a server or change one you author; the file is left alone when nothing changed, so it is cheap to run often.
- **Committing.** The snapshot changes only when a server's contract does, which makes its diff a review artifact: a widened input, a new `outputSchema`, or a tool that stopped being read-only shows up in the pull request next to the code that relies on it.
- **CI.** Run `mcp-tada check` to fail when a live server has drifted from the snapshot (or `mcp-tada check --fail-on dangerous` to ignore drift that only adds things), and `mcp-tada introspect` followed by `git diff --exit-code` to fail when someone forgot to commit a regenerated one. Both need the servers reachable from CI, so put secrets in `env` through the runner's environment rather than in the config.

```yaml
- run: pnpm mcp-tada introspect
- run: git diff --exit-code -- '**/*.introspection.d.ts'
- run: pnpm mcp-tada check
```

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

## Agent skills

The package ships four [agent skills](https://agentskills.io) under `skills/`, one `SKILL.md` per directory: `mcp-tada-integration` (wiring the client into a project), `mcp-tada-cli` (running or scripting the CLI), `mcp-tada-snapshots` (regenerating snapshots and reading a `check` report), and `mcp-tada-type-mapper` (how schemas map to types). Copy or symlink them into your project's skills directory, for example `.claude/skills/`:

```sh
ln -s ../../node_modules/mcp-tada/skills/mcp-tada-integration .claude/skills/mcp-tada-integration
```

## Development

```sh
pnpm install
pnpm run verify   # format, lint, build, typecheck, test
pnpm test:e2e     # against real servers over the network, see e2e/README.md
```

See `AGENTS.md` for contributor conventions and `.changeset/` for release notes.

## Status

Early. API may change before 1.0.
