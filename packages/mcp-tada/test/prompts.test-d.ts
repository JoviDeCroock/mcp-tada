import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expectTypeOf, test } from "vitest";
import { initMcpTada } from "../src/index.js";
import type { PromptArgs, PromptNames } from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

declare const client: Client;
const mcp = initMcpTada<introspection>().typed(client);

describe("prompt types", () => {
  test("PromptNames is the union of snapshot prompt names", () => {
    expectTypeOf<PromptNames<introspection>>().toEqualTypeOf<
      "args-prompt" | "completable-prompt" | "resource-prompt" | "simple-prompt"
    >();
  });

  test("PromptArgs makes required arguments string and the rest optional", () => {
    expectTypeOf<PromptArgs<introspection, "args-prompt">>().toEqualTypeOf<
      { city: string } & { state?: string }
    >();
    expectTypeOf<PromptArgs<introspection, "simple-prompt">>().toEqualTypeOf<{} & {}>();
  });

  test("a snapshot without prompts has no prompt names", async () => {
    type Legacy = { tools: { echo: { inputSchema: { type: "object" } } } };
    expectTypeOf<PromptNames<Legacy>>().toEqualTypeOf<never>();
    const legacy = initMcpTada<Legacy>().typed(client);
    // @ts-expect-error nothing to get
    await legacy.getPrompt("anything");
  });
});

describe("getPrompt", () => {
  test("good calls", async () => {
    const r = await mcp.getPrompt("args-prompt", { city: "Chicago" });
    expectTypeOf(r).toEqualTypeOf<GetPromptResult>();
    await mcp.getPrompt("args-prompt", { city: "Chicago", state: "IL" }, { timeout: 5 });
    // no required arguments: args can be omitted
    await mcp.getPrompt("simple-prompt");
    await mcp.getPrompt("simple-prompt", {});
  });

  test("bad calls", async () => {
    // @ts-expect-error unknown prompt
    await mcp.getPrompt("nope");
    // @ts-expect-error missing required city
    await mcp.getPrompt("args-prompt", { state: "IL" });
    // @ts-expect-error args are required when one is
    await mcp.getPrompt("args-prompt");
    // @ts-expect-error prompt arguments are strings
    await mcp.getPrompt("args-prompt", { city: 1 });
    // @ts-expect-error undeclared argument
    await mcp.getPrompt("args-prompt", { city: "x", country: "US" });
  });
});
