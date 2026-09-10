// A stdio MCP server built with mcp-tada-server. Run with `node dist/server.js`.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "mcp-tada-server";
import { tools } from "./tools.js";

const server = new McpServer({ name: "notes", version: "0.1.0" });
registerTools(server, tools, { validateOutput: true });
await server.connect(new StdioServerTransport());
