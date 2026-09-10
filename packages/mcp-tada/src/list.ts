// Shared `tools/list` pagination helper: several call sites (the typed client's `listTools()`,
// the combined client's `listTools()`, and `mcp-tada introspect`) need to page through
// `nextCursor` until it's exhausted and return every tool. This is that loop, written once.
import type { Prompt, Tool } from "@modelcontextprotocol/sdk/types.js";

/** The minimal shape of a `tools/list` result page: a `Tool[]` plus an optional cursor for the
 * next page. `ListToolsResult` from the SDK, and mcp-tada's own `RawToolListResult`, both
 * structurally satisfy this. */
export interface ListToolsResultLike {
  tools: Tool[];
  nextCursor?: string | undefined;
}

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

/** The minimal shape of a `prompts/list` result page, the `prompts/list` twin of
 * `ListToolsResultLike`. */
export interface ListPromptsResultLike {
  prompts: Prompt[];
  nextCursor?: string | undefined;
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
