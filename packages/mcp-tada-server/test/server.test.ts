import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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

  it("throws for an unknown tool (protocol-level error)", async () => {
    await expect(client.callTool({ name: "nope", arguments: {} })).rejects.toThrow();
  });

  it("rejects invalid input with isError instead of invoking the handler", async () => {
    const result = await client.callTool({ name: "sum", arguments: { a: "not a number", b: 2 } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("Invalid input") },
    ]);
  });

  it("rejects a missing required argument with isError", async () => {
    const result = await client.callTool({ name: "echo", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("Invalid input") },
    ]);
  });

  it("returns isError with the error message when a handler throws, not a protocol error", async () => {
    const throwing = defineTools([
      {
        name: "boom",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          throw new Error("kaboom");
        },
      },
    ]);
    const throwingServer = new McpServer({ name: "throwing-server", version: "0.0.0" });
    registerTools(throwingServer, throwing);
    const throwingClient = new Client({ name: "throwing-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      throwingClient.connect(clientTransport),
      throwingServer.connect(serverTransport),
    ]);

    const result = await throwingClient.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "kaboom" }]);

    await throwingClient.close();
    await throwingServer.close();
  });
});

describe("registerTools output validation", () => {
  const outputTools = defineTools([
    {
      name: "badOutput",
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: { total: { type: "number" } },
        required: ["total"],
      },
      // Deliberately returns a value that does not satisfy outputSchema.
      handler: async () => ({ total: "not a number" }) as unknown as { total: number },
    },
  ]);

  it("validateOutput defaults to false: a mismatched structuredContent goes through unchanged", async () => {
    const server = new McpServer({ name: "output-test-server", version: "0.0.0" });
    registerTools(server, outputTools);
    const client = new Client({ name: "output-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({ name: "badOutput", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ total: "not a number" });

    await client.close();
    await server.close();
  });

  it("validateOutput: true rejects a mismatched structuredContent with isError", async () => {
    const server = new McpServer({ name: "output-test-server-2", version: "0.0.0" });
    registerTools(server, outputTools, { validateOutput: true });
    const client = new Client({ name: "output-test-client-2", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({ name: "badOutput", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("Invalid output") },
    ]);

    await client.close();
    await server.close();
  });
});

describe("registerTools registration ordering", () => {
  it("throws a clear error when called after the server is already connected", async () => {
    const server = new McpServer({ name: "late-register-server", version: "0.0.0" });
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    expect(() => registerTools(server, tools)).toThrow(/registered before calling connect/);

    await server.close();
  });
});

describe("registerTools with a plain low-level Server", () => {
  it("registers and serves tools the same way as on an McpServer", async () => {
    const server = new Server({ name: "plain-server", version: "0.0.0" }, { capabilities: {} });
    registerTools(server, tools);

    const client = new Client({ name: "plain-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(["echo", "sum"]);

    const result = await client.callTool({ name: "sum", arguments: { a: 2, b: 3 } });
    expect(result.structuredContent).toEqual({ total: 5 });

    await client.close();
    await server.close();
  });
});
