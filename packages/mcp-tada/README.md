# mcp-tada

[![npm](https://img.shields.io/npm/v/mcp-tada)](https://www.npmjs.com/package/mcp-tada)

Compile-time typed [Model Context Protocol](https://modelcontextprotocol.io) tool calls for TypeScript. Snapshot a server's `tools/list` once, and every `callTool` gets a narrowed tool name, arguments inferred from `inputSchema`, and `structuredContent` typed from `outputSchema`. Zero runtime beyond a thin wrapper around the SDK client.

## Install

```sh
pnpm add mcp-tada @modelcontextprotocol/sdk
```

## Generate a snapshot

```sh
# stdio server
pnpm mcp-tada introspect --stdio "npx -y @modelcontextprotocol/server-filesystem ." --out src/fs.introspection.d.ts

# Streamable HTTP server
pnpm mcp-tada introspect --url https://mcp.deepwiki.com/mcp --out src/deepwiki.introspection.d.ts
```

The file is a strict JSON type literal with each tool's title and description as JSDoc, so editors show them on hover. Commit it.

## Use it

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./deepwiki.introspection.js";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.deepwiki.com/mcp")));

const deepwiki = initMcpTada<introspection>().typed(client);

const result = await deepwiki.callTool("read_wiki_structure", { repoName: "0no-co/gql.tada" });
if (result.isError) {
  console.error(result.content);
} else {
  result.structuredContent.result; // string, from outputSchema
}
```

Results are a union on `isError`. On the error branch `content` is present and `structuredContent` is `unknown`. On the success branch `structuredContent` has the type derived from `outputSchema`, or `unknown` when the tool declares none. Tools whose input schema has no required properties can be called without an arguments object.

Every tool is also a method under `tools`, with the same argument and result types, so your editor lists them on `deepwiki.tools.`:

```ts
const result = await deepwiki.tools.read_wiki_structure({ repoName: "0no-co/gql.tada" });
```

## Keep the snapshot honest

```sh
pnpm mcp-tada check --url https://mcp.deepwiki.com/mcp --against src/deepwiki.introspection.d.ts
```

Exits 1 on added or removed tools and on any input or output schema change. Run it in CI. Both commands accept `--timeout <ms>` (default 30000) and a `--config mcp-tada.config.json` with several servers; see the repository docs for the config format.

## Several servers

```ts
import { combineMcpTada } from "mcp-tada";

const docs = combineMcpTada({ deepwiki, cloudflare });
await docs.callTool("cloudflare__search_cloudflare_documentation", { query: "Durable Objects" });
await docs.tools.cloudflare.search_cloudflare_documentation({ query: "Durable Objects" }); // same call
const tools = await docs.listTools(); // every server's tools, names prefixed, ready for an LLM
docs.split("deepwiki__ask_question"); // { server: "deepwiki", tool: "ask_question" }
```

Aliases are validated at construction. The separator defaults to `__` and is configurable.

## API

- `initMcpTada<I>()` returns `{ typed(client) }`. The typed client exposes `callTool(name, args?, options?)`, `tools`, `listTools()` which follows `nextCursor` until exhausted, and the underlying `client`.
- `tools` has one method per tool with the same types as `callTool`; non-identifier names use bracket access. It is a `Proxy` (tool names only exist at the type level), so `Object.keys(mcp.tools)` is empty and `then`, `catch`, `finally`, `toJSON`, `constructor`, and `prototype` never resolve as tools. On a combined client, `tools.<alias>.<tool>(...)` is the unprefixed form.
- `combineMcpTada(clients, { separator? })` merges typed clients under prefixed names.
- `ToolNames<I>`, `ToolArgs<I, N>`, `ToolOutput<I, N>`, `ToolResult<I, N>` for naming derived types in your own signatures.
- `FromSchema<S>` and `FromOutputSchema<S>` expose the JSON Schema to TypeScript mapper. Inputs are closed objects, outputs are open, so a field a server returns that its schema omits reads as `unknown`.
- `Introspection` describes the snapshot shape: `{ tools: Record<string, { inputSchema: unknown; outputSchema?: unknown }> }`.

## Supported schema vocabulary

Draft-07 and 2020-12: `type` including arrays of types, `properties` with `required` and `additionalProperties`, `items` and `prefixItems`, `enum`, `const`, `anyOf`, `oneOf`, `allOf`, `nullable`, `$ref` into `$defs` or `definitions`, and `properties` without an explicit `type`. Unsupported keywords degrade to `unknown` rather than failing.

## From a build script

Everything the CLI does is also exported from `mcp-tada/cli`, so you can generate or check a snapshot without shelling out:

```ts
import { check, introspect } from "mcp-tada/cli";

const target = { url: "https://mcp.deepwiki.com/mcp", timeoutMs: 10_000 };
await introspect({ target, out: "src/deepwiki.introspection.d.ts" });
const { report, text } = await check({ target, against: "src/deepwiki.introspection.d.ts" });
if (!report.identical) throw new Error(text);
```

The main `mcp-tada` entry stays free of `node:fs` and transport imports; see the repository docs for the full `mcp-tada/cli` surface.

## Server side

If you also write the server, [`mcp-tada-server`](https://www.npmjs.com/package/mcp-tada-server) declares tools once and gives the client the same types with no introspection step.

## More

Full documentation, the CLI reference, four runnable examples, and a survey of `outputSchema` adoption across public servers live in the [repository](https://github.com/JoviDeCroock/mcp-tada).

## Agent skills

The package ships four [agent skills](https://agentskills.io) under `skills/`, one `SKILL.md` per directory: `mcp-tada-integration` (wiring the client into a project), `mcp-tada-cli` (running or scripting the CLI), `mcp-tada-snapshots` (regenerating snapshots and reading a `check` report), and `mcp-tada-type-mapper` (how schemas map to types). Copy or symlink them into your project's skills directory, for example `.claude/skills/`:

```sh
ln -s ../../node_modules/mcp-tada/skills/mcp-tada-integration .claude/skills/mcp-tada-integration
```
