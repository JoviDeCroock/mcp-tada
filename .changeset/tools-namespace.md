---
"mcp-tada": minor
---

Add a `tools` namespace to typed and combined clients so every tool is callable as a method, `mcp.tools.read_file({ path })` or `combined.tools.gh.search({ query })`, with the same types as `callTool`.
