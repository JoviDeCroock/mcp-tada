# mcp-tada-server

[![npm](https://img.shields.io/npm/v/mcp-tada-server)](https://www.npmjs.com/package/mcp-tada-server)

Declare MCP tools once, on the server. `defineTool` types the handler's `args` from `inputSchema`
and (when present) its return from `outputSchema`; `registerTools` puts them on an `McpServer` and
emits the exact JSON Schemas on `tools/list`; `IntrospectionOf` gives you the same introspection
type `mcp-tada introspect` would generate, for a same-codebase client with no network round trip.

```sh
pnpm add mcp-tada-server mcp-tada @modelcontextprotocol/server
```

Built on MCP SDK v2: `@modelcontextprotocol/server` is a peer dependency. The 0.1.x line is the last
one for the v1 `@modelcontextprotocol/sdk`.

```ts
import { McpServer } from "@modelcontextprotocol/server";
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
declare const client: import("@modelcontextprotocol/client").Client;
const mcp = initMcpTada<IntrospectionOf<typeof tools>>().typed(client);
const result = await mcp.callTool("sum", { a: 1, b: 2 });
result.structuredContent.total; // typed as number
```

## Annotations

`annotations` on a definition are emitted on `tools/list` verbatim and carried into
`IntrospectionOf` with their literal values, so `ReadOnlyToolNames` and `readOnly` from `mcp-tada`
work on a same-codebase client exactly as they do on a CLI snapshot:

```ts
const tools = defineTools([
  defineTool({ name: "peek", inputSchema, annotations: { readOnlyHint: true }, handler }),
  defineTool({ name: "wipe", inputSchema, annotations: { destructiveHint: true }, handler }),
]);
const safe = readOnly(initMcpTada<IntrospectionOf<typeof tools>>().typed(client));
await safe.callTool("peek"); // ok
await safe.callTool("wipe"); // compile error
```

## Handler context

A handler receives `(args, ctx)`. `ctx` is SDK v2's `ServerContext`, exported here as `ToolExtra`:
the request's abort signal is `ctx.mcpReq.signal`, its id `ctx.mcpReq.id`, the session
`ctx.sessionId`, and, over HTTP, `ctx.http?.authInfo`. (SDK v1 passed a flat `extra` object with
`extra.signal`; the codemod in the SDK's migration guide rewrites those reads.)

## Why the low-level handlers

The SDK's high-level `McpServer.registerTool` takes a Standard Schema object (Zod, or JSON Schema
wrapped by the SDK's `fromJsonSchema`) and derives the wire schema from it, so what reaches
`tools/list` is the SDK's rendering rather than the JSON Schema you wrote. `registerTools` installs the low-level
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

## Multi-round-trip elicitation

On protocol 2026-07-28, a handler can return the SDK's `InputRequiredResult` to ask for input
before finishing. `registerTools` passes that intermediate result directly to the SDK, even
when the tool declares an `outputSchema` and `validateOutput` is enabled. Only the completed
structured output is checked against that schema.

```ts
import type { InputRequiredResult } from "@modelcontextprotocol/server";
import { defineTool } from "mcp-tada-server";

const confirmation: InputRequiredResult = {
  resultType: "input_required",
  inputRequests: {
    confirm: {
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Continue?",
        requestedSchema: {
          type: "object",
          properties: { confirmed: { type: "boolean" } },
          required: ["confirmed"],
        },
      },
    },
  },
};

const tool = defineTool({
  name: "confirm",
  inputSchema: { type: "object" },
  outputSchema: { type: "boolean" },
  handler: (_args, ctx) => {
    const response = ctx.mcpReq.inputResponses?.confirm;
    if (response === undefined) return confirmation;
    if (typeof response !== "object" || response === null ||
        !("action" in response) || response.action !== "accept" ||
        !("content" in response)) return false;
    const content = response.content;
    return typeof content === "object" && content !== null &&
      "confirmed" in content && content.confirmed === true;
  },
});
```

Serve modern requests with the SDK's `createMcpHandler` or `serveStdio`. Configure a v2 client
with modern negotiation, `capabilities: { elicitation: { form: {} } }`, and a
`client.setRequestHandler("elicitation/create", handler)` callback. The SDK's default automatic
fulfillment invokes that callback and retries the original tool call; the typed client returns
the completed result. Manual multi-round-trip handling stays on the underlying SDK client.
On legacy connections, the SDK's default `inputRequired.legacyShim` translates the same handler
result into legacy server-to-client requests when the client declares the needed capability.
Setting `inputRequired: { legacyShim: false }` on the server restores rejection there.

Read retry responses from `ctx.mcpReq.inputResponses` and validate them before use. If returning
`requestState`, use the SDK's state integrity facilities and read it through
`ctx.mcpReq.requestState()`. If a tool's ordinary data itself has `resultType: "input_required"`,
return it in `{ structuredContent: data }` to distinguish it from a protocol response.

The modern protocol also permits primitive, array and null structured output. Their schemas
are preserved in introspection, inferred by the client, and checked when `validateOutput` is
enabled; the helper emits a JSON text block alongside the structured value.
