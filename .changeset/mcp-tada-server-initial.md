---
"mcp-tada-server": minor
---

Add `mcp-tada-server`, letting server authors declare tools once with `defineTool`/`defineTools`, register them on an `McpServer` with `registerTools` so the exact input/output JSON Schemas are emitted, and derive the same introspection type `mcp-tada introspect` would generate via `IntrospectionOf`.
