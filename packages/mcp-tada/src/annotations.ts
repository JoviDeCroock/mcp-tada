// Type-level filters over the tool annotations recorded in a snapshot, and a runtime view that
// applies the read-only filter to an existing typed client. Annotations are hints the server
// attaches to a tool (`readOnlyHint`, `destructiveHint`, ...); the snapshot keeps them so an
// agent harness can decide at compile time which tools it is willing to expose.
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Introspection, ToolNames, TypedClient } from "./index.js";

/** A tool's recorded `annotations`, or `undefined` when the server sent none. */
export type ToolAnnotationsOf<
  I extends Introspection,
  N extends ToolNames<I>,
> = I["tools"][N] extends { annotations: infer A } ? A : undefined;

/** Tool names whose annotations declare `readOnlyHint: true`. Unannotated tools are excluded:
 * the spec's default for `readOnlyHint` is `false`. */
export type ReadOnlyToolNames<I extends Introspection> = {
  [N in ToolNames<I>]: I["tools"][N] extends { annotations: { readOnlyHint: true } } ? N : never;
}[ToolNames<I>];

/** Tool names that are read-only, or that declare `destructiveHint: false`. Unannotated tools
 * are excluded: the spec's default for `destructiveHint` is `true`. */
export type NonDestructiveToolNames<I extends Introspection> = {
  [N in ToolNames<I>]: I["tools"][N] extends { annotations: { readOnlyHint: true } }
    ? N
    : I["tools"][N] extends { annotations: { destructiveHint: false } }
      ? N
      : never;
}[ToolNames<I>];

/** `I` narrowed to the tools named in `Names`, keeping its prompts (reading a prompt never
 * writes anything); still an `Introspection`, so every derived type (`ToolNames`, `ToolArgs`,
 * `ToolResult`, `PromptNames`, ...) works on it unchanged. */
export type PickTools<I extends Introspection, Names extends ToolNames<I>> = {
  tools: { [N in keyof I["tools"] as N extends Names ? N : never]: I["tools"][N] };
} & (I extends { prompts: infer P } ? { prompts: P } : {});

export type ReadOnlyIntrospection<I extends Introspection> = PickTools<I, ReadOnlyToolNames<I>>;

/**
 * A view of `mcp` that only knows the tools annotated `readOnlyHint: true`. `callTool` and
 * `tools` narrow to those names at compile time, and `listTools()` filters the live list on the
 * same annotation, so the result is safe to hand to an LLM as-is. The view forwards to the
 * same underlying client; it is a type-level restriction plus one runtime filter, not a sandbox.
 */
export function readOnly<I extends Introspection>(
  mcp: TypedClient<I>,
): TypedClient<ReadOnlyIntrospection<I>> {
  return {
    ...mcp,
    listTools: async () =>
      (await mcp.listTools()).filter((tool: Tool) => tool.annotations?.readOnlyHint === true),
  } as unknown as TypedClient<ReadOnlyIntrospection<I>>;
}
