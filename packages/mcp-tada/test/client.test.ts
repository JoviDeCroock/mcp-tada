import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandUriTemplate, initMcpTada, readOnly } from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";
import { connectEverything, sdks, serverAvailable, type SdkClient } from "./helpers.js";

// The typed client accepts a `Client` from either SDK, so the runtime suite runs once per SDK
// against the same server.
describe.runIf(serverAvailable).each(sdks)("typed client (runtime, $label)", ({ sdk }) => {
  let client: SdkClient;

  beforeAll(async () => {
    client = await connectEverything(sdk);
  });

  afterAll(async () => {
    await client.close();
  });

  it("forwards the request options to the SDK's callTool", async () => {
    // Each SDK puts `options` in a different argument slot (v1 third, v2 second). A signal that
    // is already aborted makes both reject before sending anything, so a call that resolves
    // instead means the options were dropped on the floor.
    const mcp = initMcpTada<introspection>().typed(client);
    const signal = AbortSignal.abort(new Error("aborted before send"));
    await expect(mcp.callTool("get-sum", { a: 2, b: 3 }, { signal })).rejects.toThrow();
    await expect(mcp.tools["get-sum"]({ a: 2, b: 3 }, { signal })).rejects.toThrow();
    // And the client is still usable afterwards.
    const result = await mcp.callTool("get-sum", { a: 2, b: 3 });
    expect(result.isError).not.toBe(true);
  });

  it("calls get-sum and gets an untyped structuredContent back as undefined", async () => {
    const mcp = initMcpTada<introspection>().typed(client);
    const result = await mcp.callTool("get-sum", { a: 2, b: 3 });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeUndefined();
    // The sum still comes back as text content even without a declared output schema.
    expect(JSON.stringify(result.content)).toContain("5");
  });

  it("exposes every tool as a method under tools", async () => {
    const mcp = initMcpTada<introspection>().typed(client);
    const result = await mcp.tools["get-sum"]({ a: 2, b: 3 });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("5");
  });

  it("gets a prompt with typed arguments and lists every prompt", async () => {
    const mcp = initMcpTada<introspection>().typed(client);
    const result = await mcp.getPrompt("args-prompt", { city: "Chicago" });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.messages)).toContain("Chicago");
    const prompts = await mcp.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("args-prompt");
  });

  it("reads a static resource and lists resources and templates", async () => {
    const mcp = initMcpTada<introspection>().typed(client);
    const result = await mcp.readResource("demo://resource/static/document/architecture.md");
    expect(result.contents[0]?.mimeType).toBe("text/markdown");
    expect("text" in result.contents[0]! && result.contents[0].text).toContain("Architecture");

    const resources = await mcp.listResources();
    expect(resources.map((r) => r.uri)).toContain(
      "demo://resource/static/document/architecture.md",
    );
    const templates = await mcp.listResourceTemplates();
    expect(templates.map((t) => t.name)).toContain("Dynamic Text Resource");
  });

  it("expands a resource template with typed params and reads it", async () => {
    const mcp = initMcpTada<introspection>().typed(client);
    const result = await mcp.readResourceTemplate("Dynamic Text Resource", { resourceId: "1" });
    expect(result.contents[0]?.uri).toBe("demo://resource/dynamic/text/1");
    expect(result.contents[0]?.mimeType).toBe("text/plain");

    // The template list is fetched once and cached per typed client.
    const blob = await mcp.readResourceTemplate("Dynamic Blob Resource", { resourceId: "2" });
    expect(blob.contents[0]?.uri).toBe("demo://resource/dynamic/blob/2");
    expect("blob" in blob.contents[0]!).toBe(true);
  });

  it("names the template when the server does not list it", async () => {
    type Stale = {
      tools: {};
      resourceTemplates: { Gone: { uriTemplate: "gone://{id}" } };
    };
    const mcp = initMcpTada<Stale>().typed(client);
    await expect(mcp.readResourceTemplate("Gone", { id: "1" })).rejects.toThrow(
      /no resource template named "Gone"/,
    );
  });

  it("calls get-structured-content and gets typed structuredContent back", async () => {
    const mcp = initMcpTada<introspection>().typed(client);
    const result = await mcp.callTool("get-structured-content", { location: "Chicago" });
    expect(result.isError).not.toBe(true);
    if (result.isError) throw new Error("unexpected error");
    expect(result.structuredContent).toBeDefined();
    expect(typeof result.structuredContent.temperature).toBe("number");
    expect(typeof result.structuredContent.conditions).toBe("string");
    expect(typeof result.structuredContent.humidity).toBe("number");
  });
});

// server-everything has no tool that returns a tool-level `isError: true` result (it always
// throws a protocol error instead), so exercise that branch with a stub client per AGENTS.md's
// zero-runtime promise: this only needs `callTool`/`listTools` to look like the SDK's `Client`.
describe("typed client (isError result, stub client)", () => {
  it("keeps content and an optional structuredContent on an error result", async () => {
    const errorResult = {
      isError: true,
      content: [{ type: "text", text: "boom" }],
    };
    const stub = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => errorResult,
    };
    const mcp = initMcpTada<introspection>().typed(stub as never);
    const result = await mcp.callTool("get-structured-content", { location: "Chicago" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual(errorResult.content);
  });
});

describe("callTool argument slots (stub clients)", () => {
  it("passes options as the third argument to a v1-shaped client", async () => {
    const calls: unknown[][] = [];
    const stub = {
      listTools: async () => ({ tools: [] }),
      callTool: async (...args: unknown[]) => {
        calls.push(args);
        return { content: [] };
      },
    };
    const mcp = initMcpTada<introspection>().typed(stub as never);
    await mcp.callTool("echo", { message: "hi" }, { timeout: 5 });
    expect(calls).toEqual([
      [{ name: "echo", arguments: { message: "hi" } }, undefined, { timeout: 5 }],
    ]);
  });

  it("passes options as the second argument to a v2-shaped client (has getProtocolEra)", async () => {
    const calls: unknown[][] = [];
    const stub = {
      getProtocolEra: () => "legacy",
      listTools: async () => ({ tools: [] }),
      callTool: async (...args: unknown[]) => {
        calls.push(args);
        return { content: [] };
      },
    };
    const mcp = initMcpTada<introspection>().typed(stub as never);
    await mcp.callTool("echo", { message: "hi" }, { timeout: 5 });
    expect(calls).toEqual([[{ name: "echo", arguments: { message: "hi" } }, { timeout: 5 }]]);
  });
});

describe("tools namespace (stub client)", () => {
  function stubClient() {
    const calls: unknown[] = [];
    const stub = {
      listTools: async () => ({ tools: [] }),
      callTool: async (params: unknown, _schema: unknown, options: unknown) => {
        calls.push({ params, options });
        return { content: [] };
      },
    };
    return { calls, mcp: initMcpTada<introspection>().typed(stub as never) };
  }

  it("forwards the property name as the tool name, with args and options", async () => {
    const { calls, mcp } = stubClient();
    const options = { timeout: 5 };
    await mcp.tools.echo({ message: "hi" }, options);
    expect(calls).toEqual([{ params: { name: "echo", arguments: { message: "hi" } }, options }]);
  });

  it("forwards a call with no args as an empty arguments object", async () => {
    // The reference servers reject a missing `arguments` ("expected object, received undefined"),
    // so an omitted args must not be forwarded as `undefined`.
    const { calls, mcp } = stubClient();
    await mcp.tools["get-env"]();
    await mcp.callTool("get-env");
    expect(calls).toEqual([
      { params: { name: "get-env", arguments: {} }, options: undefined },
      { params: { name: "get-env", arguments: {} }, options: undefined },
    ]);
  });

  it("returns a stable function per tool name", () => {
    const { mcp } = stubClient();
    expect(mcp.tools.echo).toBe(mcp.tools.echo);
    expect(mcp.tools.echo).not.toBe(mcp.tools["get-env"]);
  });

  it("is not thenable and survives serialization probes", async () => {
    const { calls, mcp } = stubClient();
    const tools = mcp.tools as unknown as Record<string, unknown>;
    expect(tools.then).toBeUndefined();
    expect(tools.toJSON).toBeUndefined();
    // `await` on a non-thenable resolves to the object itself without invoking anything.
    expect(await mcp.tools).toBe(mcp.tools);
    expect(Object.keys(mcp.tools)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("getPrompt (stub client)", () => {
  it("forwards name, arguments and options to the SDK client", async () => {
    const calls: unknown[] = [];
    const stub = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      getPrompt: async (params: unknown, options: unknown) => {
        calls.push({ params, options });
        return { messages: [] };
      },
    };
    const mcp = initMcpTada<introspection>().typed(stub as never);
    await mcp.getPrompt("args-prompt", { city: "Chicago" }, { timeout: 5 });
    await mcp.getPrompt("simple-prompt");
    expect(calls).toEqual([
      { params: { name: "args-prompt", arguments: { city: "Chicago" } }, options: { timeout: 5 } },
      { params: { name: "simple-prompt", arguments: undefined }, options: undefined },
    ]);
  });
});

describe("listPrompts without the prompts capability (stub client)", () => {
  it("returns [] instead of asking a server that would reject the request", async () => {
    let asked = false;
    const stub = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools: async () => ({ tools: [] }),
      listPrompts: async () => {
        asked = true;
        return { prompts: [] };
      },
      callTool: async () => ({ content: [] }),
    };
    const mcp = initMcpTada<introspection>().typed(stub as never);
    expect(await mcp.listPrompts()).toEqual([]);
    expect(asked).toBe(false);
  });
});

describe("readOnly view (stub client)", () => {
  const tools = [
    { name: "a", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "b", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } },
    { name: "c", inputSchema: { type: "object" } },
  ];
  const calls: unknown[] = [];
  const stub = {
    listTools: async () => ({ tools }),
    callTool: async (params: unknown) => {
      calls.push(params);
      return { content: [] };
    },
  };
  const mcp = initMcpTada<introspection>().typed(stub as never);
  const safe = readOnly(mcp);

  it("filters listTools to tools annotated readOnlyHint: true", async () => {
    expect((await safe.listTools()).map((t) => t.name)).toEqual(["a"]);
    // The underlying client is untouched.
    expect((await mcp.listTools()).map((t) => t.name)).toEqual(["a", "b", "c"]);
  });

  it("forwards calls to the same client", async () => {
    await safe.callTool("echo", { message: "hi" });
    expect(calls).toEqual([{ name: "echo", arguments: { message: "hi" } }]);
    expect(safe.client).toBe(mcp.client);
  });
});

if (!serverAvailable) {
  describe("typed client (runtime)", () => {
    it.skip("server-everything binary not found, skipping runtime tests", () => {});
  });
}

describe("expandUriTemplate", () => {
  it("expands simple, reserved, path, and query expressions like the SDK", () => {
    expect(expandUriTemplate("file:///{path}", { path: "a/b" })).toBe("file:///a%2Fb");
    expect(expandUriTemplate("{+base}/x", { base: "http://h/p" })).toBe("http://h/p/x");
    expect(expandUriTemplate("repo://{owner}/{name}{?ref}", { owner: "o", name: "n" })).toBe(
      "repo://o/n",
    );
    expect(
      expandUriTemplate("repo://{owner}/{name}{?ref}", { owner: "o", name: "n", ref: "main" }),
    ).toBe("repo://o/n?ref=main");
    expect(expandUriTemplate("{/segments*}", { segments: ["a", "b"] })).toBe("/a/b");
  });

  it("needs no params for a template without variables", () => {
    expect(expandUriTemplate("static://thing")).toBe("static://thing");
  });
});
