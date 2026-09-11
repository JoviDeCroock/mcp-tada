// `mcp-tada/testing`: a typed fake for code that consumes a `TypedClient`. Handlers are checked
// against the same snapshot as the real client, so a test that hands the wrong shape to an agent
// fails to compile instead of failing at runtime. Nothing here talks to a server or the SDK.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  GetPromptResult,
  Prompt,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Introspection,
  ToolArgs,
  ToolMethods,
  ToolNames,
  ToolOutput,
  TypedClient,
} from "./index.js";
import type { PromptArgs, PromptNames } from "./prompts.js";

/**
 * What a mocked tool may resolve to: a full `CallToolResult` (typed like the real client's
 * result, so `isError: true` is allowed), or, for a tool with an `outputSchema`, the bare
 * `structuredContent`, which the mock wraps the way an SDK server would (serialized into a
 * single text block plus `structuredContent`). A bare value that itself has a `content` array
 * is read as a full result; wrap it explicitly in that case.
 */
export type MockToolReturn<I extends Introspection, N extends ToolNames<I>> =
  | { content: CallToolResult["content"]; isError: true; structuredContent?: unknown }
  | (I["tools"][N] extends { outputSchema: unknown }
      ?
          | ToolOutput<I, N>
          | {
              content: CallToolResult["content"];
              isError?: false;
              structuredContent: ToolOutput<I, N>;
            }
      : { content: CallToolResult["content"]; isError?: false; structuredContent?: unknown });

/** A mocked tool: a fixed value, or a function of the typed `args` (and the call's options). */
export type MockToolHandler<I extends Introspection, N extends ToolNames<I>> =
  | MockToolReturn<I, N>
  | ((
      args: ToolArgs<I, N>,
      options?: RequestOptions,
    ) => MockToolReturn<I, N> | Promise<MockToolReturn<I, N>>);

export type MockPromptHandler<I extends Introspection, N extends PromptNames<I>> =
  | GetPromptResult
  | ((
      args: PromptArgs<I, N>,
      options?: RequestOptions,
    ) => GetPromptResult | Promise<GetPromptResult>);

/** Everything a mock can answer. Both maps are partial: an unmocked tool or prompt throws when
 * called, naming the tool, so a test only describes what it exercises. */
export type MockHandlers<I extends Introspection> = {
  tools?: { [N in ToolNames<I>]?: MockToolHandler<I, N> };
  prompts?: { [N in PromptNames<I>]?: MockPromptHandler<I, N> };
};

/** One recorded `callTool`, as a union over tool names so `call.name === "x"` narrows `args`. */
export type MockCall<I extends Introspection> = {
  [N in ToolNames<I>]: { name: N; args: ToolArgs<I, N> | undefined; options?: RequestOptions };
}[ToolNames<I>];

export type MockPromptCall<I extends Introspection> = {
  [N in PromptNames<I>]: { name: N; args: PromptArgs<I, N> | undefined; options?: RequestOptions };
}[PromptNames<I>];

export type MockClient<I extends Introspection> = TypedClient<I> & {
  /** Every `callTool` / `tools.<name>()` made so far, oldest first. */
  calls: MockCall<I>[];
  /** Every `getPrompt` made so far, oldest first. */
  promptCalls: MockPromptCall<I>[];
  /** Forget recorded calls. Handlers are kept. */
  reset(): void;
};

const reserved = new Set(["then", "catch", "finally", "toJSON", "constructor", "prototype"]);

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

/** Stands in for `client` on the mock: any property read explains that there is no SDK client
 * behind it, instead of a bare "cannot read properties of undefined" deep in the code under test.
 * Symbols and `then` read as `undefined` so inspectors and `await` do not trip over it. */
function noClient(): Client {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      throw new Error(
        `mcp-tada/testing: this mock has no underlying SDK Client (tried to read client.${prop})`,
      );
    },
  }) as Client;
}

function isFullResult(value: unknown): value is { content: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

/**
 * Builds a `TypedClient<I>` backed by in-memory handlers instead of a server. It has the same
 * `callTool`, `tools`, `getPrompt`, `listTools`, and `listPrompts` as the real client, plus a
 * `calls` log for assertions. `listTools()` and `listPrompts()` report the mocked names only;
 * schemas live in the snapshot type, not in the mock.
 *
 * ```ts
 * const mcp = mockMcpTada<introspection>({
 *   tools: {
 *     "get-structured-content": ({ location }) => ({ temperature: 20, conditions: "sunny" }),
 *     "get-sum": { content: [{ type: "text", text: "5" }] },
 *   },
 * });
 * await runAgent(mcp);
 * expect(mcp.calls[0]).toEqual({ name: "get-sum", args: { a: 2, b: 3 } });
 * ```
 */
export function mockMcpTada<I extends Introspection>(
  handlers: MockHandlers<I> = {},
): MockClient<I> {
  const tools = (handlers.tools ?? {}) as Record<string, unknown>;
  const prompts = (handlers.prompts ?? {}) as Record<string, unknown>;
  const calls: MockCall<I>[] = [];
  const promptCalls: MockPromptCall<I>[] = [];

  async function callTool(name: string, args?: unknown, options?: RequestOptions) {
    const record = { name, args } as MockCall<I>;
    if (options !== undefined) record.options = options;
    calls.push(record);
    if (!(name in tools)) {
      throw new Error(`mcp-tada/testing: no mock handler for tool "${name}"`);
    }
    const handler = tools[name];
    const value = typeof handler === "function" ? await handler(args, options) : handler;
    if (isFullResult(value)) return value;
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
    };
  }

  async function getPrompt(name: string, args?: unknown, options?: RequestOptions) {
    const record = { name, args } as MockPromptCall<I>;
    if (options !== undefined) record.options = options;
    promptCalls.push(record);
    if (!(name in prompts)) {
      throw new Error(`mcp-tada/testing: no mock handler for prompt "${name}"`);
    }
    const handler = prompts[name];
    return typeof handler === "function" ? await handler(args, options) : handler;
  }

  const mock = {
    client: noClient(),
    callTool,
    getPrompt,
    tools: toolMethods<ToolMethods<I>>(callTool),
    listTools: async (): Promise<Tool[]> =>
      Object.keys(tools).map((name) => ({ name, inputSchema: { type: "object" } })),
    listPrompts: async (): Promise<Prompt[]> => Object.keys(prompts).map((name) => ({ name })),
    calls,
    promptCalls,
    reset() {
      calls.length = 0;
      promptCalls.length = 0;
    },
  };
  return mock as unknown as MockClient<I>;
}
