# mcp-tada-server

[![npm](https://img.shields.io/npm/v/mcp-tada-server)](https://www.npmjs.com/package/mcp-tada-server)

Declare MCP tools once, on the server. `defineTool` types the handler's `args` from `inputSchema`
and (when present) its return from `outputSchema`; `registerTools` puts them on an `McpServer` and
emits the exact JSON Schemas on `tools/list`; `IntrospectionOf` gives you the same introspection
type `mcp-tada introspect` would generate, for a same-codebase client with no network round trip.

```sh
pnpm add mcp-tada-server mcp-tada @modelcontextprotocol/sdk
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defineTools, registerTools, type IntrospectionOf } from "mcp-tada-server";
import { initMcpTada } from "mcp-tada";

export const tools = defineTools([
  {
    name: "sum",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    outputSchema: {
      type: "object",
      properties: { total: { type: "number" } },
      required: ["total"],
    },
    // `args` is typed { a: number; b: number }, return is typed from outputSchema
    handler: async (args) => ({ total: args.a + args.b }),
  },
]);

const server = new McpServer({ name: "my-server", version: "1.0.0" });
registerTools(server, tools);

// Elsewhere in the same codebase, a typed client with zero network round trip:
declare const client: import("@modelcontextprotocol/sdk/client/index.js").Client;
const mcp = initMcpTada<IntrospectionOf<typeof tools>>().typed(client);
const result = await mcp.callTool("sum", { a: 1, b: 2 });
result.structuredContent.total; // typed as number
```

## Why the low-level handlers

The SDK's high-level `McpServer.registerTool` only accepts Zod (or Standard Schema) input, not raw
JSON Schema, so it cannot emit our schemas verbatim. `registerTools` installs the low-level
`tools/list`/`tools/call` request handlers directly instead, on the low-level server (`server.server`
when given an `McpServer`, or `server` itself when given a plain low-level `Server`). Because of
that, when given an `McpServer`, call it at most once per instance, and avoid also calling
`server.registerTool`/`server.tool` on the same instance, since the last handler installed wins.
That caveat does not apply to a plain `Server`, which has no such high-level API to conflict with.

Call `registerTools` before `connect()`-ing the server to a transport. The SDK rejects registering
capabilities after a transport is attached, and `registerTools` rethrows that as a clearer error
telling you tools must be registered first.

## Validation and error semantics

`registerTools` always validates incoming `arguments` against a tool's `inputSchema` before
invoking its handler, using a small built-in JSON Schema validator (see `src/validate.ts`) that
covers the same subset `mcp-tada`'s type-level mapper supports. On a mismatch, the handler is never
called: the result carries `isError: true` and a text content block listing the errors, per the
MCP spec's "invalid input" execution error, rather than a thrown protocol error.

A handler that throws is caught the same way: the result carries `isError: true` and the error's
message as a text block, not a JSON-RPC protocol error. The one case that remains a protocol-level
error is calling an unknown tool name, per the spec.

Pass `{ validateOutput: true }` as a third argument to also validate a handler's
`structuredContent` against `outputSchema` before it goes on the wire:

```ts
registerTools(server, tools, { validateOutput: true });
```

This defaults to `false`, since your handler's return already carries the type-level guarantee
from `outputSchema`; enable it to catch a value that type-checks against a widened type (`any`,
manual casts) but doesn't actually satisfy the schema. A mismatch returns `isError: true` with the
validation errors, the same as an input mismatch.

See the root `README.md` for `mcp-tada` itself, and `AGENTS.md` for the introspection contract
shared between `mcp-tada` and this package.
