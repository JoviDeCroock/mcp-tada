import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { initMcpTada } from "../src/index.js";
import { combineMcpTada } from "../src/combine.js";
import { listAllPrompts, listAllTools } from "../src/list.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

describe("listAllTools", () => {
  it("follows nextCursor until exhausted", async () => {
    const pages = [
      { tools: [tool("a"), tool("b")], nextCursor: "page-2" },
      { tools: [tool("c")], nextCursor: undefined },
    ];
    let calls = 0;
    const list = async (params?: { cursor?: string }) => {
      const page = pages[calls];
      calls++;
      if (calls === 1) expect(params?.cursor).toBeUndefined();
      if (calls === 2) expect(params?.cursor).toBe("page-2");
      return page ?? { tools: [] };
    };

    const tools = await listAllTools(list);
    expect(tools.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(calls).toBe(2);
  });

  it("returns a single page's tools when there is no nextCursor", async () => {
    const tools = await listAllTools(async () => ({ tools: [tool("only")] }));
    expect(tools.map((t) => t.name)).toEqual(["only"]);
  });
});

describe("listAllPrompts", () => {
  it("follows nextCursor until exhausted", async () => {
    const pages = [{ prompts: [{ name: "a" }], nextCursor: "2" }, { prompts: [{ name: "b" }] }];
    let calls = 0;
    const prompts = await listAllPrompts(async () => pages[calls++] ?? { prompts: [] });
    expect(prompts.map((p) => p.name)).toEqual(["a", "b"]);
    expect(calls).toBe(2);
  });
});

describe("typed client listTools() (stub)", () => {
  it("pages through every server's tools", async () => {
    const pages = [
      { tools: [tool("a"), tool("b")], nextCursor: "page-2" },
      { tools: [tool("c")], nextCursor: undefined },
    ];
    let calls = 0;
    const stub = {
      listTools: async () => {
        const page = pages[calls];
        calls++;
        return page ?? { tools: [] };
      },
      callTool: async () => ({ content: [] }),
    };

    const mcp = initMcpTada<introspection>().typed(stub as never);
    const tools = await mcp.listTools();
    expect(tools.map((t) => t.name)).toEqual(["a", "b", "c"]);
  });
});

describe("combined client listTools() (stub)", () => {
  it("pages every underlying server and prefixes names", async () => {
    function pagingStub(names: string[][]) {
      let calls = 0;
      return {
        listTools: async () => {
          const page = names[calls] ?? [];
          calls++;
          const nextCursor = calls < names.length ? `page-${calls + 1}` : undefined;
          return { tools: page.map(tool), nextCursor };
        },
        callTool: async () => ({ content: [] }),
      };
    }

    const one = initMcpTada<introspection>().typed(pagingStub([["a"], ["b"]]) as never);
    const two = initMcpTada<introspection>().typed(pagingStub([["x", "y"]]) as never);
    const combined = combineMcpTada({ one, two });

    const tools = await combined.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["one__a", "one__b", "two__x", "two__y"]);
  });
});
