// Shared `tools/list` pagination helper: several call sites (the typed client's `listTools()`,
// the combined client's `listTools()`, and `mcp-tada introspect`) need to page through
// `nextCursor` until it's exhausted and return every tool. This is that loop, written once.
//
// Since SDK v2, `listTools()` and `listPrompts()` called without a cursor already return every
// page in one result with no `nextCursor`, so against a v2 client the loop below runs exactly
// once; against v1 it pages as before.
import type {
  ListPromptsResultLike,
  ListResourceTemplatesResultLike,
  ListResourcesResultLike,
  ListToolsResultLike,
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from "./wire.js";

/** A `tools/list` call: given an optional cursor, returns the next page. Matches the shape of
 * `Client["listTools"]` (called with just the cursor param) closely enough to pass it directly. */
export type ListToolsFn<R extends ListToolsResultLike = ListToolsResultLike> = (params?: {
  cursor?: string;
}) => Promise<R>;

/**
 * Follows `nextCursor` until exhausted, returning every tool across every page. Pass an
 * `onPage` callback to observe each raw page (e.g. to keep the last one for its metadata)
 * without changing the accumulated `Tool[]` result.
 */
export async function listAllTools<R extends ListToolsResultLike>(
  list: ListToolsFn<R>,
  onPage?: (page: R) => void,
): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const params = cursor !== undefined ? { cursor } : undefined;
    const result = await list(params);
    onPage?.(result);
    tools.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor);
  return tools;
}

export type ListPromptsFn<R extends ListPromptsResultLike = ListPromptsResultLike> = (params?: {
  cursor?: string;
}) => Promise<R>;

/** `listAllTools` for `prompts/list`: follows `nextCursor` and returns every prompt. */
export async function listAllPrompts<R extends ListPromptsResultLike>(
  list: ListPromptsFn<R>,
  onPage?: (page: R) => void,
): Promise<Prompt[]> {
  const prompts: Prompt[] = [];
  let cursor: string | undefined;
  do {
    const params = cursor !== undefined ? { cursor } : undefined;
    const result = await list(params);
    onPage?.(result);
    prompts.push(...result.prompts);
    cursor = result.nextCursor;
  } while (cursor);
  return prompts;
}

export type ListResourcesFn<R extends ListResourcesResultLike = ListResourcesResultLike> =
  (params?: { cursor?: string }) => Promise<R>;

/** `listAllTools` for `resources/list`: follows `nextCursor` and returns every static resource. */
export async function listAllResources<R extends ListResourcesResultLike>(
  list: ListResourcesFn<R>,
  onPage?: (page: R) => void,
): Promise<Resource[]> {
  const resources: Resource[] = [];
  let cursor: string | undefined;
  do {
    const params = cursor !== undefined ? { cursor } : undefined;
    const result = await list(params);
    onPage?.(result);
    resources.push(...result.resources);
    cursor = result.nextCursor;
  } while (cursor);
  return resources;
}

export type ListResourceTemplatesFn<
  R extends ListResourceTemplatesResultLike = ListResourceTemplatesResultLike,
> = (params?: { cursor?: string }) => Promise<R>;

/** `listAllTools` for `resources/templates/list`: follows `nextCursor` and returns every template. */
export async function listAllResourceTemplates<R extends ListResourceTemplatesResultLike>(
  list: ListResourceTemplatesFn<R>,
  onPage?: (page: R) => void,
): Promise<ResourceTemplate[]> {
  const templates: ResourceTemplate[] = [];
  let cursor: string | undefined;
  do {
    const params = cursor !== undefined ? { cursor } : undefined;
    const result = await list(params);
    onPage?.(result);
    templates.push(...result.resourceTemplates);
    cursor = result.nextCursor;
  } while (cursor);
  return templates;
}
