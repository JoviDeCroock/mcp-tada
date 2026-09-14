---
"mcp-tada-server": minor
---

`mcp-tada-server` now targets MCP SDK v2: it peer-depends on `@modelcontextprotocol/server` instead of `@modelcontextprotocol/sdk`, and tool handlers receive v2's `ServerContext` as their second argument. Replace the dependency, import `McpServer` from `@modelcontextprotocol/server`, and read `ctx.mcpReq.signal` where a handler read `extra.signal`.
