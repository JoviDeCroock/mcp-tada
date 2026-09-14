// A stdio MCP server built with mcp-tada-server. Run with `node dist/server.js`.
// `serveStdio` lets the client's opening message pick the protocol era: a 2026-07-28 client
// gets that revision (and `ttlMs` / `cacheScope` on its tool list), a 2025-era client the
// `initialize` handshake. The factory runs once per connection.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { registerTools } from "mcp-tada-server";
import { tools } from "./tools.js";

serveStdio(() => {
  const server = new McpServer({ name: "notes", version: "0.1.0" });
  registerTools(server, tools, { validateOutput: true });
  return server;
});
