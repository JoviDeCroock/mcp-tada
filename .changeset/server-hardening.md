---
"mcp-tada-server": patch
---

`registerTools` now validates tool arguments (and, when opted in with `validateOutput: true`, structured output) against their JSON Schemas and reports handler errors as `isError` tool results instead of protocol errors, accepts a plain low-level `Server` in addition to `McpServer`, and gives a clear error when called after the server has already connected.
