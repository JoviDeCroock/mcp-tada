import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineTools } from "../src/define.js";
import { registerTools } from "../src/register.js";

const tools = defineTools([
  {
    name: "echo",
    description: "Echoes a message back",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    handler: async (args: { message: string }) => ({
      content: [{ type: "text" as const, text: args.message }],
    }),
  },
  {
    name: "sum",
    title: "Sum two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    outputSchema: {
      type: "object",
      properties: { total: { type: "number" } },
      required: ["total"],
    },
    handler: async (args: { a: number; b: number }) => ({ total: args.a + args.b }),
  },
]);

describe("registerTools", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: "mcp-tada-server-test", version: "0.0.0" });
    registerTools(server, tools);

    client = new Client({ name: "test-client", version: "0.0.0" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("lists tools with the exact input/output JSON Schemas", async () => {
    const { tools: listed } = await client.listTools();
    expect(listed).toHaveLength(2);

    const echo = listed.find((t) => t.name === "echo");
    expect(echo?.description).toBe("Echoes a message back");
    expect(echo?.inputSchema).toEqual({
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    });
    expect(echo?.outputSchema).toBeUndefined();

    const sum = listed.find((t) => t.name === "sum");
    expect(sum?.title).toBe("Sum two numbers");
    expect(sum?.inputSchema).toEqual({
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    });
    expect(sum?.outputSchema).toEqual({
      type: "object",
      properties: { total: { type: "number" } },
      required: ["total"],
    });
  });

  it("calls a tool without an outputSchema and gets a text content block back", async () => {
    const result = await client.callTool({ name: "echo", arguments: { message: "hi" } });
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("calls a tool with an outputSchema and gets structuredContent plus a JSON text block", async () => {
    const result = await client.callTool({ name: "sum", arguments: { a: 2, b: 3 } });
    expect(result.structuredContent).toEqual({ total: 5 });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ total: 5 }) }]);
  });

  it("throws for an unknown tool", async () => {
    await expect(client.callTool({ name: "nope", arguments: {} })).rejects.toThrow();
  });
});
