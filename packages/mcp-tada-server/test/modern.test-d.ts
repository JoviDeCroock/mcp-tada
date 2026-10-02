import type { InputRequiredResult } from "@modelcontextprotocol/server";
import type { ToolOutput } from "mcp-tada";
import { expectTypeOf, test } from "vitest";
import { defineTool, defineTools, type IntrospectionOf } from "../src/define.js";

declare const inputRequired: InputRequiredResult;

const tools = defineTools([
  defineTool({
    name: "confirm",
    inputSchema: { type: "object" },
    outputSchema: { type: "boolean" },
    handler: (_args, ctx) => (ctx.mcpReq.inputResponses ? true : inputRequired),
  }),
  defineTool({
    name: "numbers",
    inputSchema: { type: "object" },
    outputSchema: { type: "array", items: { type: "number" } },
    handler: () => [1, 2],
  }),
  defineTool({
    name: "nullable",
    inputSchema: { type: "object" },
    outputSchema: { anyOf: [{ type: "string" }, { type: "null" }] },
    handler: () => null,
  }),
  defineTool({
    name: "unstructured",
    inputSchema: { type: "object" },
    handler: () => inputRequired,
  }),
]);

test("intermediate results do not widen the completed output types", () => {
  type Snapshot = IntrospectionOf<typeof tools>;
  expectTypeOf<ToolOutput<Snapshot, "confirm">>().toEqualTypeOf<boolean>();
  expectTypeOf<ToolOutput<Snapshot, "numbers">>().toEqualTypeOf<number[]>();
  expectTypeOf<ToolOutput<Snapshot, "nullable">>().toEqualTypeOf<string | null>();
  expectTypeOf<ToolOutput<Snapshot, "unstructured">>().toEqualTypeOf<unknown>();
});

defineTool({
  name: "invalid",
  inputSchema: { type: "object" },
  outputSchema: { type: "boolean" },
  // @ts-expect-error intermediate-result support must not permit invalid completed output
  handler: () => "not a boolean",
});
