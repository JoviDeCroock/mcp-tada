// `mcp-tada/testing`: a typed fake for code that consumes a `TypedClient`. Handlers are checked
// against the same snapshot as the real client, so a test that hands the wrong shape to an agent
// fails to compile instead of failing at runtime. Nothing here talks to a server or the SDK.
import type {
  Introspection,
  ToolArgs,
  ToolMethods,
  ToolNames,
  ToolOutput,
  TypedClient,
} from "./index.js";
import type { PromptArgs, PromptNames } from "./prompts.js";
import type {
  ResourceResult,
  ResourceTemplateNames,
  ResourceTemplateParams,
  ResourceTemplateResult,
  ResourceUris,
  TypedReadResourceResult,
} from "./resources.js";
import type {
  ClientLike,
  ContentBlock,
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  RequestOptions,
  Resource,
  ResourceTemplate,
  Tool,
} from "./wire.js";

/**
 * What a mocked tool may resolve to: a full `CallToolResult` (typed like the real client's
 * result, so `isError: true` is allowed), or, for a tool with an `outputSchema`, the bare
 * `structuredContent`, which the mock wraps the way an SDK server would (serialized into a
 * single text block plus `structuredContent`). A bare value that itself has a `content` array
 * is read as a full result; wrap it explicitly in that case.
 */
export type MockToolReturn<I extends Introspection, N extends ToolNames<I>> =
  | { content: ContentBlock[]; isError: true; structuredContent?: unknown }
  | (I["tools"][N] extends { outputSchema: unknown }
      ?
          | ToolOutput<I, N>
          | { content: ContentBlock[]; isError?: false; structuredContent: ToolOutput<I, N> }
      : { content: ContentBlock[]; isError?: false; structuredContent?: unknown });

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

/** A mocked static resource: a result, or a function of the call's options. `contents` items
 * are typed with the resource's recorded `mimeType`. */
export type MockResourceHandler<I extends Introspection, U extends ResourceUris<I>> =
  | ResourceResult<I, U>
  | ((options?: RequestOptions) => ResourceResult<I, U> | Promise<ResourceResult<I, U>>);

/** A mocked resource template: a result, or a function of the typed template `params`. */
export type MockResourceTemplateHandler<
  I extends Introspection,
  N extends ResourceTemplateNames<I>,
> =
  | ResourceTemplateResult<I, N>
  | ((
      params: ResourceTemplateParams<I, N>,
      options?: RequestOptions,
    ) => ResourceTemplateResult<I, N> | Promise<ResourceTemplateResult<I, N>>);

/** Everything a mock can answer. Every map is partial: an unmocked tool, prompt, or resource
 * throws when called, naming it, so a test only describes what it exercises. `readResource`
 * with a URI outside the snapshot is answered by `resources` too, keyed by that URI. */
export type MockHandlers<I extends Introspection> = {
  tools?: { [N in ToolNames<I>]?: MockToolHandler<I, N> };
  prompts?: { [N in PromptNames<I>]?: MockPromptHandler<I, N> };
  resources?: { [U in ResourceUris<I>]?: MockResourceHandler<I, U> } & {
    [uri: string]:
      | TypedReadResourceResult
      | ((options?: RequestOptions) => TypedReadResourceResult | Promise<TypedReadResourceResult>)
      | undefined;
  };
  resourceTemplates?: { [N in ResourceTemplateNames<I>]?: MockResourceTemplateHandler<I, N> };
};

/** One recorded `callTool`, as a union over tool names so `call.name === "x"` narrows `args`. */
export type MockCall<I extends Introspection> = {
  [N in ToolNames<I>]: { name: N; args: ToolArgs<I, N> | undefined; options?: RequestOptions };
}[ToolNames<I>];

export type MockPromptCall<I extends Introspection> = {
  [N in PromptNames<I>]: { name: N; args: PromptArgs<I, N> | undefined; options?: RequestOptions };
}[PromptNames<I>];

/** One recorded `readResource` (by `uri`) or `readResourceTemplate` (by `name` and `params`). */
export type MockResourceCall<I extends Introspection> =
  | { uri: ResourceUris<I> | (string & {}); options?: RequestOptions }
  | {
      [N in ResourceTemplateNames<I>]: {
        name: N;
        params: ResourceTemplateParams<I, N> | undefined;
        options?: RequestOptions;
      };
    }[ResourceTemplateNames<I>];

export type MockClient<I extends Introspection> = TypedClient<I> & {
  /** Every `callTool` / `tools.<name>()` made so far, oldest first. */
  calls: MockCall<I>[];
  /** Every `getPrompt` made so far, oldest first. */
  promptCalls: MockPromptCall<I>[];
  /** Every `readResource` and `readResourceTemplate` made so far, oldest first. */
  resourceCalls: MockResourceCall<I>[];
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
function noClient(): ClientLike {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined;
      throw new Error(
        `mcp-tada/testing: this mock has no underlying SDK Client (tried to read client.${prop})`,
      );
    },
  }) as ClientLike;
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
 * `callTool`, `tools`, `getPrompt`, `readResource`, `readResourceTemplate`, and `list*` methods
 * as the real client, plus `calls`, `promptCalls`, and `resourceCalls` logs for assertions. The
 * `list*` methods report the mocked names only; schemas and templates live in the snapshot
 * type, not in the mock. `listResourceTemplates()` reports an empty `uriTemplate`.
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
  const resources = (handlers.resources ?? {}) as Record<string, unknown>;
  const templates = (handlers.resourceTemplates ?? {}) as Record<string, unknown>;
  const calls: MockCall<I>[] = [];
  const promptCalls: MockPromptCall<I>[] = [];
  const resourceCalls: MockResourceCall<I>[] = [];

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

  async function readResource(uri: string, options?: RequestOptions) {
    const record = { uri } as MockResourceCall<I>;
    if (options !== undefined) record.options = options;
    resourceCalls.push(record);
    if (!(uri in resources)) {
      throw new Error(`mcp-tada/testing: no mock handler for resource "${uri}"`);
    }
    const handler = resources[uri];
    return (typeof handler === "function" ? await handler(options) : handler) as ReadResourceResult;
  }

  async function readResourceTemplate(name: string, params?: unknown, options?: RequestOptions) {
    const record = { name, params } as MockResourceCall<I>;
    if (options !== undefined) record.options = options;
    resourceCalls.push(record);
    if (!(name in templates)) {
      throw new Error(`mcp-tada/testing: no mock handler for resource template "${name}"`);
    }
    const handler = templates[name];
    return (
      typeof handler === "function" ? await handler(params, options) : handler
    ) as ReadResourceResult;
  }

  const mock = {
    client: noClient(),
    callTool,
    getPrompt,
    readResource,
    readResourceTemplate,
    tools: toolMethods<ToolMethods<I>>(callTool),
    listTools: async (): Promise<Tool[]> =>
      Object.keys(tools).map((name) => ({ name, inputSchema: { type: "object" } })),
    listPrompts: async (): Promise<Prompt[]> => Object.keys(prompts).map((name) => ({ name })),
    listResources: async (): Promise<Resource[]> =>
      Object.keys(resources).map((uri) => ({ uri, name: uri })),
    listResourceTemplates: async (): Promise<ResourceTemplate[]> =>
      Object.keys(templates).map((name) => ({ name, uriTemplate: "" })),
    calls,
    promptCalls,
    resourceCalls,
    reset() {
      calls.length = 0;
      promptCalls.length = 0;
      resourceCalls.length = 0;
    },
  };
  return mock as unknown as MockClient<I>;
}
