import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initMcpTada, readOnly } from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

const serverPath = fileURLToPath(
  new URL("../node_modules/@modelcontextprotocol/server-everything/dist/index.js", import.meta.url),
);
const serverAvailable = existsSync(serverPath);

describe.runIf(serverAvailable)("typed client (runtime, server-everything)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({ command: "node", args: [serverPath] });
    client = new Client({ name: "mcp-tada-test", version: "0.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
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

  it("forwards a call with no args", async () => {
    const { calls, mcp } = stubClient();
    await mcp.tools["get-env"]();
    expect(calls).toEqual([
      { params: { name: "get-env", arguments: undefined }, options: undefined },
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
