import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expectTypeOf, test } from "vitest";
import { combineMcpTada, initMcpTada } from "../src/index.js";
import type { introspection as everything } from "./fixtures/everything.introspection.d.ts";
import type { introspection as second } from "./fixtures/second.introspection.d.ts";

declare const client: Client;
declare const dynamicName: string;
const gh = initMcpTada<everything>().typed(client);
const fs = initMcpTada<second>().typed(client);

describe("combineMcpTada", () => {
  test("prefixed union of tool names, args/result resolve through", async () => {
    const combined = combineMcpTada({ gh, fs });

    const r1 = await combined.callTool("gh__get-structured-content", { location: "Chicago" });
    expectTypeOf(r1.structuredContent.temperature).toEqualTypeOf<number>();

    const r2 = await combined.callTool("fs__search", { query: "readme" });
    expectTypeOf(r2.structuredContent.results).toEqualTypeOf<string[]>();

    // colliding tool name "echo" on both servers stays distinct once prefixed.
    await combined.callTool("gh__echo", { message: "hi" });
    await combined.callTool("fs__echo", { text: "hi" });
  });

  test("servers gives direct access to each underlying typed client", async () => {
    const combined = combineMcpTada({ gh, fs });
    const r = await combined.servers.gh.callTool("get-sum", { a: 1, b: 2 });
    expectTypeOf(r.structuredContent).toEqualTypeOf<undefined>();
    expectTypeOf(combined.servers.fs).toEqualTypeOf<typeof fs>();
  });

  test("split resolves a prefixed name to its server and tool", () => {
    const combined = combineMcpTada({ gh, fs });
    const { server, tool } = combined.split("gh__echo");
    expectTypeOf(server).toEqualTypeOf<"gh" | "fs">();
    expectTypeOf(tool).toEqualTypeOf<string>();

    // split also accepts a plain (dynamic, e.g. LLM-supplied) string.
    combined.split(dynamicName);
  });

  test("custom separator keeps prefixed names literal", async () => {
    const combined = combineMcpTada({ gh, fs }, { separator: "." as const });
    await combined.callTool("gh.get-sum", { a: 1, b: 2 });

    // @ts-expect-error wrong separator: default "__" no longer applies
    await combined.callTool("gh__get-sum", { a: 1, b: 2 });
  });

  test("bad calls", async () => {
    const combined = combineMcpTada({ gh, fs });

    // @ts-expect-error unknown server prefix
    await combined.callTool("nope__get-sum", { a: 1, b: 2 });

    // @ts-expect-error unprefixed tool name
    await combined.callTool("get-sum", { a: 1, b: 2 });

    // @ts-expect-error missing required arg b
    await combined.callTool("gh__get-sum", { a: 1 });

    // @ts-expect-error wrong type for fs__echo's text
    await combined.callTool("fs__echo", { text: 42 });
  });
});
