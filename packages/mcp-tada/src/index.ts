import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { listAllTools } from "./list.js";
import type { FromOutputSchema, FromSchema } from "./schema.js";

export type { FromOutputSchema, FromSchema } from "./schema.js";
export { combineMcpTada } from "./combine.js";
export type { AnyTypedClient, CombinedClient, CombinedIntrospection } from "./combine.js";
export { readOnly } from "./annotations.js";
export type {
  NonDestructiveToolNames,
  PickTools,
  ReadOnlyIntrospection,
  ReadOnlyToolNames,
  ToolAnnotationsOf,
} from "./annotations.js";
export { listAllTools } from "./list.js";
export type { ListToolsFn, ListToolsResultLike } from "./list.js";

/** One tool's entry in a snapshot: its JSON Schema input, and, when the server declared them,
 * its output schema and behavioural annotations (`readOnlyHint`, `destructiveHint`, ...). */
export type ToolEntry = {
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations;
};

/**
 * Shape of a generated introspection snapshot: a name-keyed map of tools, each carrying
 * its JSON Schema input (and optionally output) schema. Matches the output of `mcp-tada introspect`.
 */
export type Introspection = {
  tools: Record<string, ToolEntry>;
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

/**
 * One method per tool, so `mcp.tools.read_file({ path })` is `mcp.callTool("read_file", { path })`
 * with the same argument and result types. Names that aren't identifiers still work through
 * bracket access: `mcp.tools["get-library-docs"]({ ... })`.
 */
export type ToolMethods<I extends Introspection> = {
  [N in ToolNames<I>]: (
    ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
  ) => Promise<ToolResult<I, N>>;
};

export type TypedClient<I extends Introspection> = {
  callTool<N extends ToolNames<I>>(
    name: N,
    ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
  ): Promise<ToolResult<I, N>>;
  /** Every tool as a method: `mcp.tools.<name>(args?, options?)`. Backed by a `Proxy` since tool
   * names only exist at the type level, so `Object.keys(mcp.tools)` is empty; use `listTools()`
   * for runtime discovery. */
  tools: ToolMethods<I>;
  /** Every tool from every server page, following `nextCursor` until exhausted. For the raw,
   * single-page SDK call, use `client.listTools(...)` directly. */
  listTools(): Promise<Tool[]>;
  client: Client;
};

// Property names a catch-all proxy must not answer: `then` would make `tools` thenable (so
// `await` and `Promise.resolve` would hang on it), and the rest are probed by runtimes and
// serializers. A tool with one of these names is still reachable through `callTool`.
const reserved = new Set(["then", "catch", "finally", "toJSON", "constructor", "prototype"]);

/**
 * Builds a `tools` namespace whose every string property is a function forwarding to `call`
 * with that property as the tool name. The introspection only exists at the type level, so the
 * names can't be enumerated up front; a `Proxy` resolves them on access instead.
 */
function toolMethods<T>(
  call: (name: string, args?: unknown, options?: RequestOptions) => Promise<unknown>,
): T {
  const cache = new Map<string, (args?: unknown, options?: RequestOptions) => Promise<unknown>>();
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string" || reserved.has(prop)) return undefined;
      let method = cache.get(prop);
      if (!method) {
        method = (args, options) => call(prop, args, options);
        cache.set(prop, method);
      }
      return method;
    },
  }) as T;
}

/**
 * Initializes a typed wrapper for a given introspection snapshot. The generic
 * `Introspection` describes the server's tools at the type level only; nothing about it
 * is used at runtime. Call `.typed(client)` with a live SDK `Client` to get back a
 * `callTool` that narrows tool names, infers `args` from `inputSchema`, and types
 * `structuredContent` from `outputSchema`, plus a `tools` namespace exposing the same calls
 * as methods.
 */
export function initMcpTada<I extends Introspection>() {
  return {
    typed(client: Client): TypedClient<I> {
      async function callTool<N extends ToolNames<I>>(
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
      }
      return {
        client,
        listTools: () => listAllTools(client.listTools.bind(client)),
        callTool,
        tools: toolMethods<ToolMethods<I>>(callTool as never),
      };
    },
  };
}
