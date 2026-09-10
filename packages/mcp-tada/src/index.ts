import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FromSchema } from "./schema.js";

export type { FromSchema } from "./schema.js";

/**
 * Shape of a generated introspection snapshot: a name-keyed map of tools, each carrying
 * its JSON Schema input (and optionally output) schema. Matches the output of `mcp-tada introspect`.
 */
export type Introspection = {
  tools: Record<string, { inputSchema: unknown; outputSchema?: unknown }>;
};

/** Alias kept for discoverability alongside `Introspection`. */
export type TadaIntrospection = Introspection;

export type ToolNames<I extends Introspection> = keyof I["tools"] & string;

export type ToolArgs<I extends Introspection, N extends ToolNames<I>> = FromSchema<
  I["tools"][N]["inputSchema"]
>;

export type ToolOutput<I extends Introspection, N extends ToolNames<I>> = I["tools"][N] extends {
  outputSchema: infer S;
}
  ? FromSchema<S>
  : undefined;

/**
 * `CallToolResult` narrowed so `structuredContent` reflects the tool's `outputSchema`
 * (or is `undefined` when the tool has none), while `content`, `isError` and `_meta`
 * stay as typed by the SDK.
 */
export type TypedCallToolResult<T extends { outputSchema?: unknown }> = Omit<
  CallToolResult,
  "structuredContent"
> & {
  structuredContent: T extends { outputSchema: infer S } ? FromSchema<S> : undefined;
};

export type ToolResult<I extends Introspection, N extends ToolNames<I>> = TypedCallToolResult<
  I["tools"][N]
>;

// True when a tool's input schema has no required properties, so `args` can be omitted.
type HasNoRequiredArgs<S> = S extends { required: readonly unknown[] }
  ? S["required"] extends readonly [] // required: [] behaves the same as no required props
    ? true
    : false
  : true;

// Widen the call signature so `args` is optional when nothing is required.
type CallToolArgs<S> =
  HasNoRequiredArgs<S> extends true
    ? [args?: FromSchema<S>, options?: RequestOptions]
    : [args: FromSchema<S>, options?: RequestOptions];

export type TypedClient<I extends Introspection> = {
  callTool<N extends ToolNames<I>>(
    name: N,
    ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
  ): Promise<ToolResult<I, N>>;
  listTools: Client["listTools"];
  client: Client;
};

/**
 * Initializes a typed wrapper for a given introspection snapshot. The generic
 * `Introspection` describes the server's tools at the type level only; nothing about it
 * is used at runtime. Call `.typed(client)` with a live SDK `Client` to get back a
 * `callTool` that narrows tool names, infers `args` from `inputSchema`, and types
 * `structuredContent` from `outputSchema`.
 */
export function initMcpTada<I extends Introspection>() {
  return {
    typed(client: Client): TypedClient<I> {
      return {
        client,
        listTools: client.listTools.bind(client),
        async callTool<N extends ToolNames<I>>(
          name: N,
          ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
        ): Promise<ToolResult<I, N>> {
          const [args, options] = rest;
          const result = await client.callTool(
            { name, arguments: args as Record<string, unknown> },
            undefined,
            options,
          );
          return result as unknown as ToolResult<I, N>;
        },
      };
    },
  };
}
