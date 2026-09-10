import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expectTypeOf, test } from "vitest";
import { initMcpTada } from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

declare const client: Client;
const mcp = initMcpTada<introspection>().typed(client);

describe("typed client", () => {
  test("good calls", async () => {
    const r1 = await mcp.callTool("get-structured-content", { location: "Chicago" });
    expectTypeOf(r1.structuredContent.temperature).toEqualTypeOf<number>();

    const r2 = await mcp.callTool("get-sum", { a: 1, b: 2 });
    expectTypeOf(r2.structuredContent).toEqualTypeOf<undefined>();
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
    // @ts-expect-error humidity is a number, not a string
    const bad: string = r1.structuredContent.humidity;
    void bad;
  });
});
