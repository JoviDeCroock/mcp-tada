import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

serveStdio(
  () => {
    const server = new Server(
      { name: "protocol-test", version: "1.0.0" },
      { capabilities: { tools: {}, prompts: {}, resources: {} } },
    );
    server.setRequestHandler("tools/list", async ({ params }) => ({
      tools: [{ name: params?.cursor ? "second" : "first", inputSchema: { type: "object" } }],
      ...(params?.cursor ? {} : { nextCursor: "page-2" }),
      ttlMs: 1234,
      cacheScope: "public",
    }));
    server.setRequestHandler("prompts/list", async ({ params }) => ({
      prompts: [{ name: params?.cursor ? "second-prompt" : "first-prompt" }],
      ...(params?.cursor ? {} : { nextCursor: "page-2" }),
      ttlMs: 5678,
      cacheScope: "private",
    }));
    server.setRequestHandler("resources/list", async () => ({
      resources: [],
      ttlMs: 9000,
      cacheScope: "private",
    }));
    server.setRequestHandler("resources/templates/list", async () => ({
      resourceTemplates: [],
      ttlMs: 10000,
      cacheScope: "public",
    }));
    return server;
  },
  process.env.MODERN_ONLY === "1" ? { legacy: "reject" } : {},
);
