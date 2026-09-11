import { describe, expectTypeOf, it } from "vitest";
import type { TypedClient } from "../src/index.js";
import { mockMcpTada } from "../src/testing.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

describe("mockMcpTada types", () => {
  it("is a TypedClient of the same introspection", () => {
    const mcp = mockMcpTada<introspection>();
    expectTypeOf(mcp).toMatchTypeOf<TypedClient<introspection>>();
  });

  it("types handler args from inputSchema", () => {
    mockMcpTada<introspection>({
      tools: {
        "get-sum": ({ a, b }) => {
          expectTypeOf(a).toEqualTypeOf<number>();
          expectTypeOf(b).toEqualTypeOf<number>();
          return { content: [] };
        },
      },
    });
  });

  it("accepts a bare structuredContent only for tools with an outputSchema", () => {
    mockMcpTada<introspection>({
      tools: {
        "get-structured-content": () => ({ temperature: 1, conditions: "x", humidity: 2 }),
        // @ts-expect-error get-sum has no outputSchema, so only a full result is accepted
        "get-sum": () => ({ sum: 3 }),
      },
    });
    mockMcpTada<introspection>({
      tools: {
        // @ts-expect-error conditions must be a string
        "get-structured-content": () => ({ temperature: 1, conditions: 2, humidity: 2 }),
      },
    });
  });

  it("rejects unknown tool names", () => {
    mockMcpTada<introspection>({
      // @ts-expect-error not a tool in the snapshot
      tools: { nope: { content: [] } },
    });
  });

  it("narrows recorded calls on name", () => {
    const mcp = mockMcpTada<introspection>();
    const call = mcp.calls[0];
    if (call?.name === "get-sum") {
      expectTypeOf(call.args).toEqualTypeOf<{ a: number; b: number } | undefined>();
    }
  });
});
