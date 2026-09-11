import { describe, expect, it } from "vitest";
import { combineMcpTada, readOnly } from "../src/index.js";
import { mockMcpTada } from "../src/testing.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

describe("mockMcpTada", () => {
  it("wraps a bare structuredContent the way a server would", async () => {
    const mcp = mockMcpTada<introspection>({
      tools: {
        "get-structured-content": ({ location }) => ({
          temperature: 20,
          conditions: `sunny in ${location}`,
          humidity: 40,
        }),
      },
    });
    const result = await mcp.callTool("get-structured-content", { location: "Chicago" });
    expect(result.isError).toBeUndefined();
    if (result.isError) throw new Error("unexpected");
    expect(result.structuredContent.conditions).toBe("sunny in Chicago");
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
  });

  it("passes a full result through untouched, including errors", async () => {
    const mcp = mockMcpTada<introspection>({
      tools: {
        "get-sum": { content: [{ type: "text", text: "boom" }], isError: true },
      },
    });
    const result = await mcp.tools["get-sum"]({ a: 1, b: 2 });
    expect(result).toEqual({ content: [{ type: "text", text: "boom" }], isError: true });
  });

  it("records calls with their args, and throws for an unmocked tool", async () => {
    const mcp = mockMcpTada<introspection>({
      tools: { echo: ({ message }) => ({ content: [{ type: "text", text: message }] }) },
    });
    await mcp.callTool("echo", { message: "hi" });
    await mcp.tools.echo({ message: "again" });
    expect(mcp.calls).toEqual([
      { name: "echo", args: { message: "hi" } },
      { name: "echo", args: { message: "again" } },
    ]);
    await expect(mcp.callTool("get-sum", { a: 1, b: 2 })).rejects.toThrow(
      'no mock handler for tool "get-sum"',
    );
    mcp.reset();
    expect(mcp.calls).toEqual([]);
  });

  it("lists only the mocked tools and prompts", async () => {
    const mcp = mockMcpTada<introspection>({
      tools: { echo: { content: [] } },
      prompts: {
        "args-prompt": ({ city }) => ({
          messages: [{ role: "user", content: { type: "text", text: `Weather in ${city}?` } }],
        }),
      },
    });
    expect((await mcp.listTools()).map((t) => t.name)).toEqual(["echo"]);
    expect((await mcp.listPrompts()).map((p) => p.name)).toEqual(["args-prompt"]);
    const prompt = await mcp.getPrompt("args-prompt", { city: "Chicago" });
    expect(JSON.stringify(prompt.messages)).toContain("Chicago");
    expect(mcp.promptCalls).toEqual([{ name: "args-prompt", args: { city: "Chicago" } }]);
  });

  it("explains itself when the code under test reaches for the SDK client", () => {
    const mcp = mockMcpTada<introspection>();
    expect(() => mcp.client.listTools()).toThrow("no underlying SDK Client");
  });

  it("works with readOnly and combineMcpTada like a real client", async () => {
    const mcp = mockMcpTada<introspection>({
      tools: { "get-sum": { content: [{ type: "text", text: "3" }] } },
    });
    const ro = readOnly(mcp);
    expect((await ro.listTools()).map((t) => t.name)).toEqual([]);
    const combined = combineMcpTada({ every: mcp });
    const result = await combined.callTool("every__get-sum", { a: 1, b: 2 });
    expect(JSON.stringify(result.content)).toContain("3");
    expect(mcp.calls).toEqual([{ name: "get-sum", args: { a: 1, b: 2 } }]);
  });
});
