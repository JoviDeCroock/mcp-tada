import type { Introspection, ToolEntry, ToolNames, TypedClient } from "./index.js";
import type { PromptEntry, PromptNames } from "./prompts.js";
import type { GetPromptResult, Prompt, RequestOptions, Tool } from "./wire.js";

/** Any client produced by `initMcpTada<I>().typed(client)`, with its introspection and its
 * underlying SDK client type erased. */
export type AnyTypedClient = TypedClient<any, any>;

// Recovers the `Introspection` a `TypedClient` was built from. `TypedClient<I, C>` and
// `TypedClient<infer I, any>` are instantiations of the same alias, so this matches by comparing
// type arguments rather than expanding and structurally unifying the whole shape.
type IntrospectionOf<T> = T extends TypedClient<infer I, any> ? I : never;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer R,
) => void
  ? R
  : never;

// Forces a generic (possibly unresolved) type to appear assignable to `U` to the checker, so
// `CombinedIntrospection<Map, Sep>` can satisfy `Introspection` even while `Map` is still a
// bare type parameter. Standard workaround for constraint checks on nested generic aliases.
type Cast<T, U> = T extends U ? T : U;

// Prefixes one server's tool names, e.g. `{ read_file: ... }` -> `{ "fs__read_file": ... }`.
type PrefixedTools<Alias extends string, I extends Introspection, Sep extends string> = {
  [N in ToolNames<I> as `${Alias}${Sep}${N}`]: I["tools"][N];
};

// Same for prompts: `{ summarize: ... }` -> `{ "fs__summarize": ... }`. A server without the
// `prompts` capability contributes nothing.
type PrefixedPrompts<
  Alias extends string,
  I extends Introspection,
  Sep extends string,
> = I extends { prompts: infer P extends Record<string, PromptEntry> }
  ? { [N in keyof P & string as `${Alias}${Sep}${N}`]: P[N] }
  : {};

/**
 * A plain `Introspection` whose tool and prompt maps are the union of every server's, each
 * name prefixed with its server alias and separator. Since the result is itself `Introspection`
 * shaped, `ToolNames`/`ToolArgs`/`ToolResult`/`PromptNames`/`PromptArgs` keep working on it
 * unmodified.
 */
export type CombinedIntrospection<
  Map extends Record<string, Introspection>,
  Sep extends string = "__",
> = {
  tools: Cast<
    UnionToIntersection<
      { [K in keyof Map & string]: PrefixedTools<K, Map[K], Sep> }[keyof Map & string]
    >,
    Record<string, ToolEntry>
  >;
  prompts: Cast<
    UnionToIntersection<
      { [K in keyof Map & string]: PrefixedPrompts<K, Map[K], Sep> }[keyof Map & string]
    >,
    Record<string, PromptEntry>
  >;
};

type ServersOf<M extends Record<string, AnyTypedClient>> = {
  [K in keyof M]: IntrospectionOf<M[K]>;
};

// Resources are not namespaced by the combined client (a resource URI carries no alias to route
// on); reach them through `servers.<alias>`.
export type CombinedClient<M extends Record<string, AnyTypedClient>, Sep extends string> = Omit<
  TypedClient<CombinedIntrospection<ServersOf<M>, Sep>>,
  | "listTools"
  | "client"
  | "tools"
  | "listPrompts"
  | "readResource"
  | "readResourceTemplate"
  | "listResources"
  | "listResourceTemplates"
> & {
  /** Direct access to each underlying typed client, keyed by its alias. */
  servers: M;
  /** Each server's tools as methods under its alias: `combined.tools.gh.search({ ... })` is
   * `combined.servers.gh.tools.search({ ... })`, with no prefixed string to spell. */
  tools: { [K in keyof M]: M[K]["tools"] };
  /** Every server's tools, each named `<alias><separator><tool>`, ready for an LLM tool list. */
  listTools(): Promise<Tool[]>;
  /** Every server's prompts, each named `<alias><separator><prompt>`. Servers without the
   * `prompts` capability contribute nothing. */
  listPrompts(): Promise<Prompt[]>;
  /** Splits a prefixed tool or prompt name back into its server alias and original name. */
  split: (
    name:
      | ToolNames<CombinedIntrospection<ServersOf<M>, Sep>>
      | PromptNames<CombinedIntrospection<ServersOf<M>, Sep>>
      | (string & {}),
  ) => {
    server: keyof M & string;
    tool: string;
  };
};

/**
 * Combines several typed clients into one, namespacing every tool and prompt name as
 * `<alias><separator><name>` (default separator `"__"`, matching how tool names get forwarded
 * into an LLM's tool list) so identically named tools on different servers never collide.
 */
export function combineMcpTada<M extends Record<string, AnyTypedClient>, Sep extends string = "__">(
  clients: M,
  options?: { separator?: Sep },
): CombinedClient<M, Sep> {
  const separator = (options?.separator ?? "__") as Sep;

  if (separator === "") {
    throw new Error("mcp-tada: combineMcpTada separator must not be empty");
  }
  for (const alias of Object.keys(clients)) {
    if (alias === "") {
      throw new Error("mcp-tada: combineMcpTada server alias must not be empty");
    }
    if (alias.includes(separator)) {
      throw new Error(
        `mcp-tada: combineMcpTada server alias "${alias}" must not contain the separator ${JSON.stringify(separator)}`,
      );
    }
  }

  function split(name: string): { server: keyof M & string; tool: string } {
    const at = name.indexOf(separator);
    const server = at === -1 ? name : name.slice(0, at);
    if (!Object.hasOwn(clients, server)) {
      throw new Error(
        `mcp-tada: unknown server prefix in tool name "${name}" (expected "<server>${separator}<tool>")`,
      );
    }
    const tool = at === -1 ? "" : name.slice(at + separator.length);
    return { server: server as keyof M & string, tool };
  }

  async function callTool(name: string, args?: unknown, callOptions?: RequestOptions) {
    const { server, tool } = split(name);
    const target = clients[server] as AnyTypedClient;
    return target.callTool(tool as never, args as never, callOptions);
  }

  async function getPrompt(
    name: string,
    args?: Record<string, string>,
    callOptions?: RequestOptions,
  ): Promise<GetPromptResult> {
    const { server, tool: prompt } = split(name);
    const target = clients[server] as AnyTypedClient;
    return target.getPrompt(prompt as never, args as never, callOptions);
  }

  async function listTools(): Promise<Tool[]> {
    // Each server's typed `listTools()` already pages through `nextCursor` (see `./list.ts`),
    // so this only needs to fan out across servers and merge, not paginate itself.
    const lists = await Promise.all(
      Object.entries(clients).map(async ([alias, client]) => {
        const tools = await client.listTools();
        return tools.map((tool) => ({ ...tool, name: `${alias}${separator}${tool.name}` }));
      }),
    );
    return lists.flat();
  }

  async function listPrompts(): Promise<Prompt[]> {
    const lists = await Promise.all(
      Object.entries(clients).map(async ([alias, client]) => {
        const prompts = await client.listPrompts();
        return prompts.map((prompt) => ({ ...prompt, name: `${alias}${separator}${prompt.name}` }));
      }),
    );
    return lists.flat();
  }

  const tools = Object.fromEntries(
    Object.entries(clients).map(([alias, client]) => [alias, client.tools]),
  );

  return {
    servers: clients,
    split,
    callTool,
    getPrompt,
    listTools,
    listPrompts,
    tools,
  } as unknown as CombinedClient<M, Sep>;
}
