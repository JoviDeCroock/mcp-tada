# mcp-tada-server

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
`tools/list`/`tools/call` request handlers directly instead. Because of that, call it at most once
per `McpServer`, and avoid also calling `server.registerTool`/`server.tool` on the same instance.

See the root `README.md` for `mcp-tada` itself, and `AGENTS.md` for the introspection contract
shared between `mcp-tada` and this package.
