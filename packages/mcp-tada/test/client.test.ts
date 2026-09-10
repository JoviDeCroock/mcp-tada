import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initMcpTada } from "../src/index.js";
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

if (!serverAvailable) {
  describe("typed client (runtime)", () => {
    it.skip("server-everything binary not found, skipping runtime tests", () => {});
  });
}
