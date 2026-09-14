import type { Client } from "@modelcontextprotocol/client";
import { describe, expectTypeOf, test } from "vitest";
import { combineMcpTada, initMcpTada } from "../src/index.js";
import type { CombinedIntrospection, GetPromptResult, PromptNames } from "../src/index.js";
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
    if (r1.isError) throw new Error("unexpected error");
    expectTypeOf(r1.structuredContent.temperature).toEqualTypeOf<number>();

    const r2 = await combined.callTool("fs__search", { query: "readme" });
    if (r2.isError) throw new Error("unexpected error");
    expectTypeOf(r2.structuredContent.results).toEqualTypeOf<string[]>();

    // colliding tool name "echo" on both servers stays distinct once prefixed.
    await combined.callTool("gh__echo", { message: "hi" });
    await combined.callTool("fs__echo", { text: "hi" });
  });

  test("servers gives direct access to each underlying typed client", async () => {
    const combined = combineMcpTada({ gh, fs });
    const r = await combined.servers.gh.callTool("get-sum", { a: 1, b: 2 });
    if (r.isError) throw new Error("unexpected error");
    expectTypeOf(r.structuredContent).toEqualTypeOf<unknown>();
    expectTypeOf(combined.servers.fs).toEqualTypeOf<typeof fs>();
  });

  test("tools nests each server's methods under its alias", async () => {
    const combined = combineMcpTada({ gh, fs });
    const r1 = await combined.tools.gh["get-structured-content"]({ location: "Chicago" });
    if (r1.isError) throw new Error("unexpected error");
    expectTypeOf(r1.structuredContent.temperature).toEqualTypeOf<number>();

    const r2 = await combined.tools.fs.search({ query: "readme" });
    if (r2.isError) throw new Error("unexpected error");
    expectTypeOf(r2.structuredContent.results).toEqualTypeOf<string[]>();

    expectTypeOf(combined.tools.gh).toEqualTypeOf<typeof gh.tools>();
    expectTypeOf<keyof typeof combined.tools>().toEqualTypeOf<"gh" | "fs">();

    // @ts-expect-error unknown alias
    void combined.tools.nope;
    // @ts-expect-error prefixed names belong to callTool, not tools
    void combined.tools.gh["gh__get-sum"];
    // @ts-expect-error wrong type for fs's echo
    await combined.tools.fs.echo({ text: 42 });
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

  test("prompts are prefixed like tools; a server without prompts contributes none", async () => {
    const combined = combineMcpTada({ gh, fs });
    expectTypeOf<
      PromptNames<CombinedIntrospection<{ gh: everything; fs: second }>>
    >().toEqualTypeOf<
      "gh__args-prompt" | "gh__completable-prompt" | "gh__resource-prompt" | "gh__simple-prompt"
    >();

    const r = await combined.getPrompt("gh__args-prompt", { city: "Chicago" });
    expectTypeOf(r).toEqualTypeOf<GetPromptResult>();
    await combined.getPrompt("gh__simple-prompt");

    const { server } = combined.split("gh__args-prompt");
    expectTypeOf(server).toEqualTypeOf<"gh" | "fs">();

    // @ts-expect-error missing required argument city
    await combined.getPrompt("gh__args-prompt", {});
    // @ts-expect-error unprefixed prompt name
    await combined.getPrompt("args-prompt", { city: "Chicago" });
    // @ts-expect-error the second server has no prompts
    await combined.getPrompt("fs__args-prompt", { city: "Chicago" });
  });

  test("a combination of prompt-less servers has no prompt names", async () => {
    expectTypeOf<
      PromptNames<CombinedIntrospection<{ a: second; b: second }>>
    >().toEqualTypeOf<never>();
    const combined = combineMcpTada({ a: fs, b: fs });
    // @ts-expect-error nothing to get
    await combined.getPrompt("a__anything");
  });
});
