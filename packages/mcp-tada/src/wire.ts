// The wire shapes mcp-tada reads and hands back, spelled structurally so the library imports
// nothing from either MCP SDK. A v1 `Client` (`@modelcontextprotocol/sdk`) and a v2 `Client`
// (`@modelcontextprotocol/client`) both satisfy `ClientLike`, and their `Tool`, `Prompt`,
// `GetPromptResult` and content types are assignable to the ones here (checked in
// `test/wire.test-d.ts` against both SDKs). Only spec-defined fields are named; anything else a
// server sends passes through untouched at runtime.
//
// Every optional field is spelled `?: T | undefined` on purpose: both SDKs infer their types from
// Zod, which produces that shape, and under `exactOptionalPropertyTypes` a plain `?: T` would
// reject it.

/** Optional display metadata a server may attach to content or resources. */
export type ContentAnnotations = {
  audience?: ("user" | "assistant")[] | undefined;
  priority?: number | undefined;
  lastModified?: string | undefined;
};

export type TextContent = {
  type: "text";
  text: string;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

export type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

export type AudioContent = {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

export type ResourceLink = {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

export type TextResourceContents = {
  uri: string;
  mimeType?: string | undefined;
  text: string;
  _meta?: Record<string, unknown> | undefined;
};

export type BlobResourceContents = {
  uri: string;
  mimeType?: string | undefined;
  blob: string;
  _meta?: Record<string, unknown> | undefined;
};

/** One `resources/list` entry. */
export type Resource = {
  uri: string;
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

/** One `resources/templates/list` entry. */
export type ResourceTemplate = {
  uriTemplate: string;
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  mimeType?: string | undefined;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

/** What `resources/read` returns. */
export type ReadResourceResult = {
  contents: (TextResourceContents | BlobResourceContents)[];
  _meta?: Record<string, unknown> | undefined;
};

export type EmbeddedResource = {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;
  annotations?: ContentAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

/** One entry of a tool result's `content` or a prompt message's `content`. */
export type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink
  | EmbeddedResource;

/** The behavioural hints a server may attach to a tool. */
export type ToolAnnotations = {
  title?: string | undefined;
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
  idempotentHint?: boolean | undefined;
  openWorldHint?: boolean | undefined;
};

/** A tool's `inputSchema`: the spec pins it to a JSON Schema object schema. */
export type ToolInputSchema = {
  type: "object";
  properties?: Record<string, unknown> | undefined;
  required?: string[] | undefined;
};

/** A tool's `outputSchema`: an object schema up to the 2025-11-25 revision, any JSON Schema
 * since 2026-07-28 (SEP-2106), which is how SDK v2 types it. */
export type ToolOutputSchema = {
  type?: string | undefined;
  properties?: Record<string, unknown> | undefined;
  required?: string[] | undefined;
  [key: string]: unknown;
};

/** One `tools/list` entry. */
export type Tool = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema: ToolInputSchema;
  outputSchema?: ToolOutputSchema | undefined;
  annotations?: ToolAnnotations | undefined;
  _meta?: Record<string, unknown> | undefined;
};

export type PromptArgument = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  required?: boolean | undefined;
};

/** One `prompts/list` entry. */
export type Prompt = {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  arguments?: PromptArgument[] | undefined;
  _meta?: Record<string, unknown> | undefined;
};

export type PromptMessage = {
  role: "user" | "assistant";
  content: ContentBlock;
};

/** What `prompts/get` returns. */
export type GetPromptResult = {
  description?: string | undefined;
  messages: PromptMessage[];
  _meta?: Record<string, unknown> | undefined;
};

export type Progress = {
  progress: number;
  total?: number | undefined;
  message?: string | undefined;
};

/** Per-request options forwarded to the SDK client. The fields both SDKs share; an SDK-specific
 * extra (v2's `cacheMode`, say) still reaches the client at runtime, cast at the call site. */
export type RequestOptions = {
  timeout?: number | undefined;
  signal?: AbortSignal | undefined;
  onprogress?: ((progress: Progress) => void) | undefined;
  resetTimeoutOnProgress?: boolean | undefined;
  maxTotalTimeout?: number | undefined;
};

/** The minimal shape of a `tools/list` result page: a `Tool[]` plus an optional cursor for the
 * next page. Both SDKs' `ListToolsResult`, and mcp-tada's own `RawToolListResult`, structurally
 * satisfy this. */
export interface ListToolsResultLike {
  tools: Tool[];
  nextCursor?: string | undefined;
}

/** The minimal shape of a `prompts/list` result page, the `prompts/list` twin of
 * `ListToolsResultLike`. */
export interface ListPromptsResultLike {
  prompts: Prompt[];
  nextCursor?: string | undefined;
}

/** The minimal shape of a `resources/list` result page. */
export interface ListResourcesResultLike {
  resources: Resource[];
  nextCursor?: string | undefined;
}

/** The minimal shape of a `resources/templates/list` result page. */
export interface ListResourceTemplatesResultLike {
  resourceTemplates: ResourceTemplate[];
  nextCursor?: string | undefined;
}

/**
 * What mcp-tada needs from an SDK client: the eight methods it forwards to. A v1 and a v2 `Client`
 * both satisfy it, so `initMcpTada<I>().typed(client)` accepts either without the library
 * depending on one. The methods are declared as methods (not function-typed properties) so their
 * parameters compare bivariantly, which is what lets both SDKs' richer parameter types match.
 *
 * `callTool` takes a rest parameter because the two SDKs disagree on its arity: v1 is
 * `(params, resultSchema?, options?)`, v2 is `(params, options?)`. `typed()` picks the right
 * form at runtime.
 */
export interface ClientLike {
  callTool(
    params: { name: string; arguments?: Record<string, unknown> | undefined },
    ...rest: unknown[]
  ): Promise<unknown>;
  getPrompt(
    params: { name: string; arguments?: Record<string, string> | undefined },
    options?: RequestOptions,
  ): Promise<GetPromptResult>;
  listTools(
    params?: { cursor?: string | undefined },
    options?: RequestOptions,
  ): Promise<ListToolsResultLike>;
  listPrompts(
    params?: { cursor?: string | undefined },
    options?: RequestOptions,
  ): Promise<ListPromptsResultLike>;
  readResource(params: { uri: string }, options?: RequestOptions): Promise<ReadResourceResult>;
  listResources(
    params?: { cursor?: string | undefined },
    options?: RequestOptions,
  ): Promise<ListResourcesResultLike>;
  listResourceTemplates(
    params?: { cursor?: string | undefined },
    options?: RequestOptions,
  ): Promise<ListResourceTemplatesResultLike>;
  getServerCapabilities():
    | {
        tools?: { listChanged?: boolean | undefined } | undefined;
        prompts?: { listChanged?: boolean | undefined } | undefined;
        resources?:
          | { listChanged?: boolean | undefined; subscribe?: boolean | undefined }
          | undefined;
      }
    | undefined;
}
