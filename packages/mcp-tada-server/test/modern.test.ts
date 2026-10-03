import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  createMcpHandler,
  InMemoryTransport,
  Server,
  type InputRequiredResult,
} from "@modelcontextprotocol/server";
import { initMcpTada } from "mcp-tada";
import { buildIntrospectionData, formatDts, parseDtsSnapshot } from "mcp-tada/cli";
import { describe, expect, it, vi } from "vitest";
import {
  defineTool,
  defineTools,
  type AnyToolDefinition,
  type IntrospectionOf,
} from "../src/define.js";
import { registerTools } from "../src/register.js";

const requestConfirmation: InputRequiredResult = {
  resultType: "input_required",
  inputRequests: {
    confirmation: {
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Continue?",
        requestedSchema: {
          type: "object",
          properties: { confirmed: { type: "boolean" } },
          required: ["confirmed"],
        },
      },
    },
  },
};

async function connectModern<T extends Record<string, AnyToolDefinition>>(tools: T) {
  const wireResults: unknown[] = [];
  const endpoint = createMcpHandler(
    () => {
      const server = new Server({ name: "modern-test", version: "1" });
      registerTools(server, tools, { validateOutput: true });
      return server;
    },
    { legacy: "reject", responseMode: "auto" },
  );
  const client = new Client(
    { name: "modern-test-client", version: "1" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
      capabilities: { elicitation: { form: {} } },
    },
  );
  const elicit = vi.fn(async () => ({ action: "accept" as const, content: { confirmed: true } }));
  client.setRequestHandler("elicitation/create", elicit);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://mcp.test/mcp"), {
      fetch: async (input, init) => {
        const response = await endpoint.fetch(new Request(input, init));
        if (response.headers.get("content-type")?.includes("application/json")) {
          const body = await response.clone().json();
          wireResults.push(body.result);
        }
        return response;
      },
    }),
  );
  return { client, mcp: initMcpTada<IntrospectionOf<T>>().typed(client), elicit, wireResults };
}

describe("modern tool results", () => {
  it("lets the SDK fulfill elicitation and retry a typed tool with output validation enabled", async () => {
    const rounds: unknown[] = [];
    const tool = defineTool({
      name: "confirm",
      inputSchema: { type: "object" },
      outputSchema: { type: "boolean" },
      handler: (_args, ctx) => {
        const response = ctx.mcpReq.inputResponses?.confirmation;
        rounds.push(response);
        if (response === undefined) return requestConfirmation;
        // Responses arrive unvalidated; check the fields this handler consumes.
        return (
          typeof response === "object" &&
          response !== null &&
          "action" in response &&
          response.action === "accept"
        );
      },
    });
    const { client, mcp, elicit, wireResults } = await connectModern(defineTools([tool]));
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const result = await mcp.tools.confirm();
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBe(true);
      expect(elicit).toHaveBeenCalledOnce();
      expect(rounds).toEqual([undefined, { action: "accept", content: { confirmed: true } }]);
      expect(wireResults).toContainEqual(expect.objectContaining(requestConfirmation));
      // The SDK consumes the wire discriminator; the typed wrapper must not invent one.
      expect(result.resultType).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("fulfills elicitation for tools without an output schema", async () => {
    const tools = defineTools([
      defineTool({
        name: "confirm",
        inputSchema: { type: "object" },
        handler: (_args, ctx) =>
          ctx.mcpReq.inputResponses
            ? { content: [{ type: "text" as const, text: "done" }] }
            : requestConfirmation,
      }),
    ]);
    const { client, mcp, elicit } = await connectModern(tools);
    try {
      expect((await mcp.callTool("confirm")).content).toEqual([{ type: "text", text: "done" }]);
      expect(elicit).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  it.each([true, false])("respects the SDK legacyShim setting (%s)", async (legacyShim) => {
    const tools = defineTools([
      defineTool({
        name: "confirm",
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          properties: { confirmed: { type: "boolean" } },
          required: ["confirmed"],
        },
        handler: (_args, ctx) =>
          ctx.mcpReq.inputResponses ? { confirmed: true } : requestConfirmation,
      }),
    ]);
    const server = new Server(
      { name: "legacy-test", version: "1" },
      { inputRequired: { legacyShim } },
    );
    registerTools(server, tools, { validateOutput: true });
    const client = new Client(
      { name: "legacy-client", version: "1" },
      { capabilities: { elicitation: { form: {} } } },
    );
    const elicit = vi.fn(async () => ({ action: "accept" as const, content: { confirmed: true } }));
    client.setRequestHandler("elicitation/create", elicit);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      const mcp = initMcpTada<IntrospectionOf<typeof tools>>().typed(client);
      if (legacyShim) {
        expect((await mcp.callTool("confirm")).structuredContent).toEqual({ confirmed: true });
        expect(elicit).toHaveBeenCalledOnce();
      } else {
        await expect(mcp.callTool("confirm")).rejects.toThrow(/input.required|2026-07-28/i);
        expect(elicit).not.toHaveBeenCalled();
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    { name: "string", schema: { type: "string" }, value: "ok" },
    { name: "number", schema: { type: "number" }, value: 42 },
    { name: "boolean", schema: { type: "boolean" }, value: false },
    { name: "null", schema: { type: "null" }, value: null },
    { name: "array", schema: { type: "array", items: { type: "number" } }, value: [1, 2] },
    { name: "union", schema: { anyOf: [{ type: "string" }, { type: "null" }] }, value: null },
    {
      name: "reference",
      schema: { $defs: { value: { type: "number" } }, $ref: "#/$defs/value" },
      value: 7,
    },
  ])("round-trips $name output schemas, snapshots and values", async ({ schema, value }) => {
    const tools = defineTools([
      {
        name: "value",
        inputSchema: { type: "object" },
        outputSchema: schema,
        handler: () => value,
      },
    ]);
    const { client, mcp } = await connectModern(tools);
    try {
      const listed = await mcp.listTools();
      expect(listed[0]?.outputSchema).toEqual(schema);
      const snapshot = buildIntrospectionData(listed);
      expect(parseDtsSnapshot(formatDts(listed, {}))).toEqual(snapshot);
      expect(snapshot.tools.value?.outputSchema).toEqual(schema);
      const result = await mcp.callTool("value");
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(value);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(value) }]);
    } finally {
      await client.close();
    }
  });

  it("keeps explicitly wrapped discriminator-shaped data as structured output", async () => {
    const tools = defineTools([
      {
        name: "data",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        handler: () => ({ structuredContent: requestConfirmation }),
      },
    ]);
    const { client, mcp, elicit } = await connectModern(tools);
    try {
      expect((await mcp.callTool("data")).structuredContent).toEqual(requestConfirmation);
      expect(elicit).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
