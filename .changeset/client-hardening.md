---
"mcp-tada": patch
---

`callTool`'s result type now narrows `structuredContent` correctly on `isError`, the typed and combined clients' `listTools()` now return every tool across paginated servers, `combineMcpTada` validates its server aliases and separator up front, the mapper treats a schema with `properties` but no `type` as an object, and `mcp-tada introspect`/`check` gain a `--timeout` flag (also settable per server as `timeoutMs` in the config file).
