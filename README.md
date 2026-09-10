# mcp-tada

Compile-time typed [Model Context Protocol](https://modelcontextprotocol.io) tool calls for TypeScript. Zero runtime, no codegen of client code, no schema library at type level.

Point it at a running MCP server once, and every `callTool` in your codebase gets:

- tool names as a union, so a typo is a compile error
- arguments inferred from the tool's `inputSchema`
- `structuredContent` typed from the tool's `outputSchema`
- hover on any call to see the tool's description

The approach is the one [gql.tada](https://gql-tada.0no.co) uses for GraphQL: snapshot the live schema into a `.d.ts`, then do all the work in the type system.

## Quick start

```sh
npm i mcp-tada @modelcontextprotocol/sdk
npx mcp-tada introspect --stdio "npx -y @modelcontextprotocol/server-filesystem ." --out src/fs.introspection.d.ts
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
result.structuredContent;
//     ^ typed from outputSchema when the server declares one
```

## How it works

1. `mcp-tada introspect` connects to the server, pages through `tools/list`, and writes a `.d.ts` containing the tool map as a type literal. Nothing else is generated.
2. `initMcpTada<introspection>()` returns a thin wrapper around the SDK `Client`. At runtime it forwards to `client.callTool`. Everything else is type-level.
3. A small purpose-built JSON Schema to TypeScript mapper turns each schema into a type on demand. It handles draft-07 and 2020-12 vocabularies: objects, required, additionalProperties, arrays, tuples, enum, const, anyOf, oneOf, allOf, type arrays, nullable, and `$ref` into `$defs` or `definitions`.

## Keeping the snapshot honest

Tool lists can change. Servers declare `tools.listChanged`, and the 2026-07-28 spec adds `ttlMs` and `cacheScope` to list results. Run `mcp-tada check` in CI to diff the live server against your snapshot and fail on drift:

```sh
npx mcp-tada check --stdio "npx -y @modelcontextprotocol/server-filesystem ." --against src/fs.introspection.d.ts
```

A tool that exists in the snapshot but not on the server fails at runtime the same way a removed GraphQL field would. The snapshot is your contract.

See `docs/cli.md` for the config file format and HTTP transport flags, and `docs/survey.md` for a survey of 23 public servers: about 15 percent of tools declare `outputSchema` today, so expect typed inputs everywhere and typed outputs where the server author opted in.

## Status

Early. API may change before 1.0.
