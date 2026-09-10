import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { listAllTools } from "./list.js";
import type { FromOutputSchema, FromSchema } from "./schema.js";

export type { FromOutputSchema, FromSchema } from "./schema.js";
export { combineMcpTada } from "./combine.js";
export type { AnyTypedClient, CombinedClient, CombinedIntrospection } from "./combine.js";
export { listAllTools } from "./list.js";
export type { ListToolsFn, ListToolsResultLike } from "./list.js";

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

// The type of `structuredContent` on a *successful* call: typed from `outputSchema` (in output
// mode, so undeclared-but-present fields read as `unknown` instead of erroring) when the tool
// declares one, or `unknown` when it doesn't -- the spec allows a server to send
// `structuredContent` even without a declared `outputSchema`, so `undefined` would be a lie.
type StructuredContentOf<T extends { outputSchema?: unknown }> = T extends { outputSchema: infer S }
  ? FromOutputSchema<S>
  : unknown;

/** The success-case type of a tool's `structuredContent`, i.e. what `result.structuredContent`
 * is typed as once `result.isError` has been narrowed away. */
export type ToolOutput<I extends Introspection, N extends ToolNames<I>> = StructuredContentOf<
  I["tools"][N]
>;

/**
 * `CallToolResult` narrowed on `isError` so `structuredContent` reflects reality:
 * - `isError: true` -> `structuredContent` is optional/`unknown` (an error result may or may not
 *   carry one; a server should not be relied on to shape it like a success result), `content`
 *   stays present.
 * - `isError` `false` or absent (a successful call) -> `structuredContent` is typed from the
 *   tool's `outputSchema` (or `unknown` when the tool declares none).
 *
 * `content`, `_meta` and the rest of `CallToolResult` stay as typed by the SDK in both branches.
 */
// Spelled out rather than `Omit<CallToolResult, ...>`: the SDK result type carries a string index
// signature (passthrough), and `Omit` over such a type keeps only the index signature, turning
// `content` into `unknown`.
type ResultBase = {
  content: CallToolResult["content"];
  _meta?: CallToolResult["_meta"];
  [key: string]: unknown;
};

export type TypedCallToolResult<T extends { outputSchema?: unknown }> =
  | (ResultBase & { isError: true; structuredContent?: unknown })
  | (ResultBase & { isError?: false; structuredContent: StructuredContentOf<T> });

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
  /** Every tool from every server page, following `nextCursor` until exhausted. For the raw,
   * single-page SDK call, use `client.listTools(...)` directly. */
  listTools(): Promise<Tool[]>;
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
        listTools: () => listAllTools(client.listTools.bind(client)),
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
