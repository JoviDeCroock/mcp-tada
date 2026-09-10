import { initMcpTada } from "mcp-tada";
import { describe, expectTypeOf, test } from "vitest";
import { defineTool, defineTools } from "../src/define.js";
import type { IntrospectionOf } from "../src/define.js";

const echoInput = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
} as const;

const sumInput = {
  type: "object",
  properties: { a: { type: "number" }, b: { type: "number" } },
  required: ["a", "b"],
} as const;

const sumOutput = {
  type: "object",
  properties: { total: { type: "number" } },
  required: ["total"],
} as const;

const echo = defineTool({
  name: "echo",
  description: "Echoes a message back",
  inputSchema: echoInput,
  handler: async (args) => {
    expectTypeOf(args).toEqualTypeOf<{ readonly message: string }>();
    return { content: [{ type: "text" as const, text: args.message }] };
  },
});

const sum = defineTool({
  name: "sum",
  inputSchema: sumInput,
  outputSchema: sumOutput,
  handler: async (args) => {
    expectTypeOf(args).toEqualTypeOf<{ readonly a: number; readonly b: number }>();
    // The bare structured content is a valid return...
    return { total: args.a + args.b };
  },
});

const sumWrapped = defineTool({
  name: "sum-wrapped",
  inputSchema: sumInput,
  outputSchema: sumOutput,
  handler: async (args) => {
    // ...and so is the explicit wrapped shape, e.g. to customize `content`.
    const total = args.a + args.b;
    return {
      structuredContent: { total },
      content: [{ type: "text" as const, text: String(total) }],
    };
  },
});

const tools = defineTools([echo, sum, sumWrapped]);

describe("defineTool / defineTools types", () => {
  test("handler args and return are inferred from the schemas", () => {
    expectTypeOf(tools.echo.name).toEqualTypeOf<"echo">();
    expectTypeOf(tools.sum.name).toEqualTypeOf<"sum">();
  });

  test("IntrospectionOf matches the expected literal shape", () => {
    type Expected = {
      tools: {
        echo: { inputSchema: typeof echoInput };
        sum: { inputSchema: typeof sumInput; outputSchema: typeof sumOutput };
        "sum-wrapped": { inputSchema: typeof sumInput; outputSchema: typeof sumOutput };
      };
    };

    expectTypeOf<IntrospectionOf<typeof tools>>().toEqualTypeOf<Expected>();
  });

  test("plugs into initMcpTada with a correctly typed callTool, no network round trip", async () => {
    const mcp = initMcpTada<IntrospectionOf<typeof tools>>().typed(undefined as any);

    const r1 = await mcp.callTool("sum", { a: 1, b: 2 });
    // `total` comes through `readonly` here because `sumOutput` is declared `as const`;
    // a schema written inline without `as const` (or read from a generated .d.ts) infers
    // a mutable property instead. Either way the value itself is a plain number at runtime.
    expectTypeOf(r1.structuredContent).toEqualTypeOf<{ readonly total: number }>();

    const r2 = await mcp.callTool("echo", { message: "hi" });
    expectTypeOf(r2.structuredContent).toEqualTypeOf<undefined>();

    // @ts-expect-error unknown tool
    await mcp.callTool("nope", {});

    // @ts-expect-error missing required arg b
    await mcp.callTool("sum", { a: 1 });
  });
});
