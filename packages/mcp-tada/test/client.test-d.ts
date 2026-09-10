import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expectTypeOf, test } from "vitest";
import { initMcpTada } from "../src/index.js";
import type { ToolResult } from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

declare const client: Client;
const mcp = initMcpTada<introspection>().typed(client);

describe("typed client", () => {
  test("good calls", async () => {
    const r1 = await mcp.callTool("get-structured-content", { location: "Chicago" });
    if (r1.isError) throw new Error("unexpected error");
    expectTypeOf(r1.structuredContent.temperature).toEqualTypeOf<number>();

    // A tool with no outputSchema still types structuredContent as `unknown` (never
    // `undefined`): the spec allows a server to send it anyway.
    const r2 = await mcp.callTool("get-sum", { a: 1, b: 2 });
    if (r2.isError) throw new Error("unexpected error");
    expectTypeOf(r2.structuredContent).toEqualTypeOf<unknown>();
  });

  test("isError narrows structuredContent", async () => {
    const r = await mcp.callTool("get-structured-content", { location: "Chicago" });
    if (r.isError) {
      expectTypeOf(r.isError).toEqualTypeOf<true>();
      expectTypeOf(r.structuredContent).toEqualTypeOf<unknown>();
      expectTypeOf(r.content).not.toBeUndefined();
    } else {
      expectTypeOf(r.structuredContent.temperature).toEqualTypeOf<number>();
    }
  });

  test("args are optional when the input schema has no required properties", async () => {
    // get-env has `properties: {}` and no `required`, so args can be omitted entirely.
    await mcp.callTool("get-env");
    await mcp.callTool("get-env", {});
  });

  test("bad calls", async () => {
    // @ts-expect-error unknown tool
    await mcp.callTool("nope", {});

    // @ts-expect-error missing required arg b
    await mcp.callTool("get-sum", { a: 1 });

    // @ts-expect-error wrong type for message
    await mcp.callTool("echo", { message: 42 });

    const r1 = await mcp.callTool("get-structured-content", { location: "Chicago" });
    if (r1.isError) throw new Error("unexpected error");
    // @ts-expect-error humidity is a number, not a string
    const bad: string = r1.structuredContent.humidity;
    void bad;
  });
});

describe("tools namespace", () => {
  test("mirrors callTool's args and result per tool", async () => {
    const r1 = await mcp.tools["get-structured-content"]({ location: "Chicago" });
    expectTypeOf(r1).toEqualTypeOf<ToolResult<introspection, "get-structured-content">>();
    if (r1.isError) throw new Error("unexpected error");
    expectTypeOf(r1.structuredContent.temperature).toEqualTypeOf<number>();

    const r2 = await mcp.tools["get-sum"]({ a: 1, b: 2 });
    if (r2.isError) throw new Error("unexpected error");
    expectTypeOf(r2.structuredContent).toEqualTypeOf<unknown>();

    // The key set is exactly the tool names.
    expectTypeOf<keyof typeof mcp.tools>().toEqualTypeOf<keyof introspection["tools"]>();
  });

  test("args stay optional when nothing is required", async () => {
    await mcp.tools["get-env"]();
    await mcp.tools["get-env"]({});
  });

  test("bad calls", async () => {
    // @ts-expect-error unknown tool
    void mcp.tools.nope;

    // @ts-expect-error missing required arg b
    await mcp.tools["get-sum"]({ a: 1 });

    // @ts-expect-error wrong type for message
    await mcp.tools.echo({ message: 42 });
  });
});

describe("result content stays typed", () => {
  test("content is the SDK content block array on both branches", async () => {
    const r = await mcp.callTool("get-sum", { a: 1, b: 2 });
    expectTypeOf(r.content).toEqualTypeOf<CallToolResult["content"]>();
    if (r.isError) expectTypeOf(r.content).toEqualTypeOf<CallToolResult["content"]>();
  });
});
