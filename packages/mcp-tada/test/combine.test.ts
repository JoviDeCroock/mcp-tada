import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { combineMcpTada, initMcpTada } from "../src/index.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

const serverPath = fileURLToPath(
  new URL("../node_modules/@modelcontextprotocol/server-everything/dist/index.js", import.meta.url),
);
const serverAvailable = existsSync(serverPath);

describe.runIf(serverAvailable)("combineMcpTada (runtime, server-everything)", () => {
  let clientA: Client;
  let clientB: Client;
  let transportA: StdioClientTransport;
  let transportB: StdioClientTransport;

  beforeAll(async () => {
    transportA = new StdioClientTransport({ command: "node", args: [serverPath] });
    clientA = new Client({ name: "mcp-tada-test-a", version: "0.0.0" });
    await clientA.connect(transportA);

    transportB = new StdioClientTransport({ command: "node", args: [serverPath] });
    clientB = new Client({ name: "mcp-tada-test-b", version: "0.0.0" });
    await clientB.connect(transportB);
  });

  afterAll(async () => {
    await clientA.close();
    await clientB.close();
  });

  it("routes a prefixed call to the right server", async () => {
    const one = initMcpTada<introspection>().typed(clientA);
    const two = initMcpTada<introspection>().typed(clientB);
    const combined = combineMcpTada({ one, two });

    const result = await combined.callTool("two__get-sum", { a: 2, b: 3 });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("5");
  });

  it("gives direct access to each underlying typed client via servers", async () => {
    const one = initMcpTada<introspection>().typed(clientA);
    const two = initMcpTada<introspection>().typed(clientB);
    const combined = combineMcpTada({ one, two });

    expect(combined.servers.one).toBe(one);
    expect(combined.servers.two).toBe(two);
    const result = await combined.servers.one.callTool("get-sum", { a: 1, b: 1 });
    expect(JSON.stringify(result.content)).toContain("2");
  });

  it("lists every server's tools with prefixed names", async () => {
    const one = initMcpTada<introspection>().typed(clientA);
    const two = initMcpTada<introspection>().typed(clientB);
    const combined = combineMcpTada({ one, two });

    const tools = await combined.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("one__get-sum");
    expect(names).toContain("two__get-sum");
    expect(names.length).toBeGreaterThan(20);
  });

  it("resolves a custom separator", async () => {
    const one = initMcpTada<introspection>().typed(clientA);
    const two = initMcpTada<introspection>().typed(clientB);
    const combined = combineMcpTada({ one, two }, { separator: "." });

    const result = await combined.callTool("one.get-sum", { a: 4, b: 5 });
    expect(JSON.stringify(result.content)).toContain("9");

    const { server, tool } = combined.split("two.echo");
    expect(server).toBe("two");
    expect(tool).toBe("echo");
  });

  it("throws a clear error for an unknown server prefix", async () => {
    const one = initMcpTada<introspection>().typed(clientA);
    const two = initMcpTada<introspection>().typed(clientB);
    const combined = combineMcpTada({ one, two });

    // @ts-expect-error deliberately calling with an unregistered server prefix
    await expect(combined.callTool("nope__get-sum", { a: 1, b: 1 })).rejects.toThrow(
      /unknown server prefix/,
    );
  });
});

if (!serverAvailable) {
  describe("combineMcpTada (runtime)", () => {
    it.skip("server-everything binary not found, skipping runtime tests", () => {});
  });
}

describe("combineMcpTada validation", () => {
  const stub = { listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [] }) };

  it("throws for an empty alias", () => {
    expect(() => combineMcpTada({ "": stub } as never)).toThrow(/alias must not be empty/);
  });

  it("throws when an alias contains the separator", () => {
    expect(() => combineMcpTada({ a__b: stub } as never)).toThrow(/must not contain the separator/);
  });

  it("throws when an alias contains a custom separator", () => {
    expect(() => combineMcpTada({ "a.b": stub } as never, { separator: "." })).toThrow(
      /must not contain the separator/,
    );
  });

  it("throws for an empty separator", () => {
    expect(() => combineMcpTada({ a: stub } as never, { separator: "" })).toThrow(
      /separator must not be empty/,
    );
  });
});
