import {
  listAllPrompts,
  listAllResourceTemplates,
  listAllResources,
  listAllTools,
} from "./list.js";
import { expandUriTemplate } from "./resources.js";
import type {
  HasNoRequiredTemplateVars,
  ResourceEntry,
  ResourceResult,
  ResourceTemplateEntry,
  ResourceTemplateNames,
  ResourceTemplateOf,
  ResourceTemplateResult,
  ResourceUris,
  UriTemplateParams,
} from "./resources.js";
import type {
  HasNoRequiredPromptArgs,
  PromptArgs,
  PromptArgumentsOf,
  PromptEntry,
  PromptNames,
} from "./prompts.js";
import type { FromOutputSchema, FromSchema } from "./schema.js";
import type {
  ClientLike,
  ContentBlock,
  GetPromptResult,
  Prompt,
  RequestOptions,
  Resource,
  ResourceTemplate,
  Tool,
  ToolAnnotations,
} from "./wire.js";

export type { FromOutputSchema, FromSchema } from "./schema.js";
// The wire types a caller sees on the typed client's surface. The finer-grained ones (each
// content block kind, a tool's schema shapes) are reachable from these by narrowing or indexing.
export type {
  BlobResourceContents,
  ClientLike,
  ContentBlock,
  GetPromptResult,
  ListPromptsResultLike,
  ListResourceTemplatesResultLike,
  ListResourcesResultLike,
  ListToolsResultLike,
  Prompt,
  ReadResourceResult,
  RequestOptions,
  Resource,
  ResourceTemplate,
  TextResourceContents,
  Tool,
  ToolAnnotations,
} from "./wire.js";
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
export {
  listAllPrompts,
  listAllResourceTemplates,
  listAllResources,
  listAllTools,
} from "./list.js";
export type {
  ListPromptsFn,
  ListResourceTemplatesFn,
  ListResourcesFn,
  ListToolsFn,
} from "./list.js";
export { expandUriTemplate } from "./resources.js";
export type {
  HasNoRequiredTemplateVars,
  ResourceEntry,
  ResourceMimeType,
  ResourceResult,
  ResourceTemplateEntry,
  ResourceTemplateMimeType,
  ResourceTemplateNames,
  ResourceTemplateOf,
  ResourceTemplateParams,
  ResourceTemplateResult,
  ResourceUris,
  TypedReadResourceResult,
  UriTemplateParams,
} from "./resources.js";
export type {
  PromptArgs,
  PromptArgsFrom,
  PromptArgumentEntry,
  PromptArgumentsOf,
  PromptEntry,
  PromptNames,
} from "./prompts.js";

/** One tool's entry in a snapshot: its JSON Schema input, and, when the server declared them,
 * its output schema and behavioural annotations (`readOnlyHint`, `destructiveHint`, ...). */
export type ToolEntry = {
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations;
};

/**
 * Shape of a generated introspection snapshot: a name-keyed map of tools, each carrying
 * its JSON Schema input (and optionally output) schema; when the server declares the
 * `prompts` capability, a name-keyed map of prompts with their argument lists; and when it
 * declares `resources`, a URI-keyed map of static resources and a name-keyed map of resource
 * templates, each with its `mimeType` when the server sent one. Matches the output of
 * `mcp-tada introspect`.
 */
export type Introspection = {
  tools: Record<string, ToolEntry>;
  prompts?: Record<string, PromptEntry>;
  resources?: Record<string, ResourceEntry>;
  resourceTemplates?: Record<string, ResourceTemplateEntry>;
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
// The index signature keeps whatever else a server (or a newer SDK) puts on the result readable
// as `unknown`, the way the SDK's own passthrough result types do.
type ResultBase = {
  content: ContentBlock[];
  _meta?: Record<string, unknown>;
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
  [N in keyof I["tools"]]: (
    ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
  ) => Promise<ToolResult<I, N & string>>;
};

// Same widening for prompts: `args` is optional when no argument is `required: true`.
type GetPromptArgs<N extends PromptNames<I>, I extends Introspection> =
  HasNoRequiredPromptArgs<PromptArgumentsOf<I, N>> extends true
    ? [args?: PromptArgs<I, N>, options?: RequestOptions]
    : [args: PromptArgs<I, N>, options?: RequestOptions];

// And for resource templates: `params` is optional when every variable is a query-style one.
type ReadTemplateArgs<N extends ResourceTemplateNames<I>, I extends Introspection> =
  HasNoRequiredTemplateVars<ResourceTemplateOf<I, N>> extends true
    ? [params?: UriTemplateParams<ResourceTemplateOf<I, N>>, options?: RequestOptions]
    : [params: UriTemplateParams<ResourceTemplateOf<I, N>>, options?: RequestOptions];

/** The typed wrapper `initMcpTada<I>().typed(client)` returns. `C` is the concrete client that
 * was passed in (a v1 or v2 SDK `Client`, or anything else satisfying `ClientLike`), kept so
 * `mcp.client` still exposes that client's full API. */
export type TypedClient<I extends Introspection, C extends ClientLike = ClientLike> = {
  callTool<N extends ToolNames<I>>(
    name: N,
    ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
  ): Promise<ToolResult<I, N>>;
  /** `prompts/get` with the name narrowed to the snapshot's prompts and `args` typed from each
   * prompt's argument list (required arguments as `string`, optional ones as `string?`). Not
   * callable on a snapshot of a server without the `prompts` capability. */
  getPrompt<N extends PromptNames<I>>(
    name: N,
    ...rest: GetPromptArgs<N, I>
  ): Promise<GetPromptResult>;
  /** Every prompt from every `prompts/list` page. Returns `[]` without a request when the
   * connected server does not declare the `prompts` capability (the SDK would throw). */
  listPrompts(): Promise<Prompt[]>;
  /** `resources/read` with `uri` completed from the snapshot's static resources (any other
   * string is accepted too, e.g. a URI a tool result handed back) and each content item's
   * `mimeType` narrowed to what the snapshot recorded for a known URI. */
  readResource<U extends ResourceUris<I> | (string & {})>(
    uri: U,
    options?: RequestOptions,
  ): Promise<ResourceResult<I, U>>;
  /** Expands one of the snapshot's resource templates with `params` (typed from the template's
   * RFC 6570 variables) and reads the resulting URI. The template string is fetched from the
   * live server once per typed client, since the snapshot only has it as a type. */
  readResourceTemplate<N extends ResourceTemplateNames<I>>(
    name: N,
    ...rest: ReadTemplateArgs<N, I>
  ): Promise<ResourceTemplateResult<I, N>>;
  /** Every static resource from every `resources/list` page, or `[]` without a request when the
   * connected server does not declare the `resources` capability. */
  listResources(): Promise<Resource[]>;
  /** Every template from every `resources/templates/list` page, or `[]` without a request when
   * the connected server does not declare the `resources` capability. */
  listResourceTemplates(): Promise<ResourceTemplate[]>;
  /** Every tool as a method: `mcp.tools.<name>(args?, options?)`. Backed by a `Proxy` since tool
   * names only exist at the type level, so `Object.keys(mcp.tools)` is empty; use `listTools()`
   * for runtime discovery. */
  tools: ToolMethods<I>;
  /** Every tool from every server page, following `nextCursor` until exhausted. For the raw,
   * single-page SDK call, use `client.listTools(...)` directly. */
  listTools(): Promise<Tool[]>;
  client: C;
};

/**
 * True when `client` is a v2 SDK `Client`, whose `callTool` is `(params, options?)`. v1's is
 * `(params, resultSchema?, options?)`: handing v1 the options in the second slot makes it read
 * them as a result schema and throw, and handing v2 the options in the third slot silently
 * drops them. Only v2's `Client` has `getProtocolEra`, so its presence is the discriminator.
 */
function hasTwoArgumentCallTool(client: ClientLike): boolean {
  return typeof (client as { getProtocolEra?: unknown }).getProtocolEra === "function";
}

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
 * is used at runtime. Call `.typed(client)` with a live SDK `Client`, from either
 * `@modelcontextprotocol/sdk` (v1) or `@modelcontextprotocol/client` (v2), to get back a
 * `callTool` that narrows tool names, infers `args` from `inputSchema`, and types
 * `structuredContent` from `outputSchema`, plus a `tools` namespace exposing the same calls
 * as methods.
 */
export function initMcpTada<I extends Introspection>() {
  return {
    typed<C extends ClientLike>(client: C): TypedClient<I, C> {
      // Decided once per wrapper, not per call: see `hasTwoArgumentCallTool`.
      const twoArgumentCallTool = hasTwoArgumentCallTool(client);
      async function callTool<N extends ToolNames<I>>(
        name: N,
        ...rest: CallToolArgs<I["tools"][N]["inputSchema"]>
      ): Promise<ToolResult<I, N>> {
        const [args, options] = rest;
        // An omitted `args` goes on the wire as `{}`: the SDK's `McpServer` validates
        // `arguments` against the tool's schema and rejects a missing object outright.
        const params = { name, arguments: (args ?? {}) as Record<string, unknown> };
        // v2: `callTool(params, options?)`; v1: `callTool(params, resultSchema?, options?)`.
        const result = twoArgumentCallTool
          ? await client.callTool(params, options)
          : await client.callTool(params, undefined, options);
        return result as unknown as ToolResult<I, N>;
      }
      async function getPrompt<N extends PromptNames<I>>(
        name: N,
        ...rest: GetPromptArgs<N, I>
      ): Promise<GetPromptResult> {
        const [args, options] = rest as [
          Record<string, string> | undefined,
          RequestOptions | undefined,
        ];
        return client.getPrompt(
          { name, arguments: args as Record<string, string> | undefined },
          options,
        );
      }
      const hasResources = () => client.getServerCapabilities()?.resources !== undefined;
      const listResources = () =>
        hasResources() ? listAllResources(client.listResources.bind(client)) : Promise.resolve([]);
      const listResourceTemplates = () =>
        hasResources()
          ? listAllResourceTemplates(client.listResourceTemplates.bind(client))
          : Promise.resolve([]);
      // The snapshot only records a template's string as a type, so the one to expand has to
      // come from the server. Templates are listed once and cached by name for this wrapper.
      let templatesByName: Promise<Map<string, string>> | undefined;
      function templateFor(name: string): Promise<string> {
        templatesByName ??= listResourceTemplates().then(
          (templates) => new Map(templates.map((t) => [t.name, t.uriTemplate])),
        );
        return templatesByName.then((map) => {
          const template = map.get(name);
          if (template === undefined) {
            throw new Error(`mcp-tada: the server lists no resource template named "${name}"`);
          }
          return template;
        });
      }
      async function readResource<U extends ResourceUris<I> | (string & {})>(
        uri: U,
        options?: RequestOptions,
      ): Promise<ResourceResult<I, U>> {
        const result = await client.readResource({ uri }, options);
        return result as unknown as ResourceResult<I, U>;
      }
      async function readResourceTemplate<N extends ResourceTemplateNames<I>>(
        name: N,
        ...rest: ReadTemplateArgs<N, I>
      ): Promise<ResourceTemplateResult<I, N>> {
        const [params, options] = rest as unknown as [
          Record<string, string | string[]> | undefined,
          RequestOptions | undefined,
        ];
        const uri = expandUriTemplate(await templateFor(name), params);
        const result = await client.readResource({ uri }, options);
        return result as unknown as ResourceTemplateResult<I, N>;
      }
      return {
        client,
        listTools: () => listAllTools(client.listTools.bind(client)),
        listPrompts: () =>
          client.getServerCapabilities()?.prompts === undefined
            ? Promise.resolve([])
            : listAllPrompts(client.listPrompts.bind(client)),
        listResources,
        listResourceTemplates,
        callTool,
        getPrompt,
        readResource,
        readResourceTemplate,
        tools: toolMethods<ToolMethods<I>>(callTool as never),
      };
    },
  };
}
