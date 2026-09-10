import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expectTypeOf, test } from "vitest";
import { initMcpTada, readOnly } from "../src/index.js";
import type {
  NonDestructiveToolNames,
  ReadOnlyToolNames,
  ToolAnnotationsOf,
  ToolNames,
} from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

declare const client: Client;

// A hand-written snapshot mixing every annotation case, since server-everything annotates all
// of its tools and never leaves one out.
type Mixed = {
  tools: {
    read: {
      inputSchema: { type: "object" };
      annotations: { readOnlyHint: true; destructiveHint: false };
    };
    write_safe: {
      inputSchema: { type: "object" };
      annotations: { readOnlyHint: false; destructiveHint: false };
    };
    write_destructive: {
      inputSchema: { type: "object" };
      annotations: { readOnlyHint: false; destructiveHint: true };
    };
    write_default: {
      inputSchema: { type: "object" };
      annotations: { title: "no hints" };
    };
    unannotated: { inputSchema: { type: "object" } };
  };
};

describe("annotation filters", () => {
  test("ReadOnlyToolNames keeps only readOnlyHint: true", () => {
    expectTypeOf<ReadOnlyToolNames<Mixed>>().toEqualTypeOf<"read">();
  });

  test("NonDestructiveToolNames applies the spec default of destructiveHint: true", () => {
    expectTypeOf<NonDestructiveToolNames<Mixed>>().toEqualTypeOf<"read" | "write_safe">();
  });

  test("ToolAnnotationsOf is the literal entry, or undefined when the server sent none", () => {
    expectTypeOf<ToolAnnotationsOf<Mixed, "read">>().toEqualTypeOf<{
      readOnlyHint: true;
      destructiveHint: false;
    }>();
    expectTypeOf<ToolAnnotationsOf<Mixed, "unannotated">>().toEqualTypeOf<undefined>();
  });

  test("a snapshot without annotations is still a valid Introspection", () => {
    type Legacy = { tools: { echo: { inputSchema: { type: "object" } } } };
    expectTypeOf<ReadOnlyToolNames<Legacy>>().toEqualTypeOf<never>();
    initMcpTada<Legacy>();
  });
});

describe("readOnly view", () => {
  const mcp = initMcpTada<introspection>().typed(client);
  const safe = readOnly(mcp);

  test("keeps the prompts of the snapshot it narrows", async () => {
    await safe.getPrompt("args-prompt", { city: "Chicago" });
    // @ts-expect-error unknown prompt
    await safe.getPrompt("nope");
  });

  test("narrows callTool and tools to read-only names", async () => {
    expectTypeOf<ToolNames<introspection>>().toMatchTypeOf<string>();
    expectTypeOf<keyof typeof safe.tools>().toEqualTypeOf<ReadOnlyToolNames<introspection>>();

    const r = await safe.callTool("get-sum", { a: 1, b: 2 });
    if (r.isError) throw new Error("unexpected error");
    expectTypeOf(r.structuredContent).toEqualTypeOf<unknown>();

    // @ts-expect-error gzip-file-as-resource has readOnlyHint: false
    await safe.callTool("gzip-file-as-resource", { filePath: "x" });
    // @ts-expect-error same through the tools namespace
    void safe.tools["gzip-file-as-resource"];
  });
});
