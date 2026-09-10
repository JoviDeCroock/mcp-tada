---
"mcp-tada": patch
---

`introspect` rejects `--json` with a `.d.ts` output path instead of corrupting the file, omits the `protocolVersion` header line when the transport does not expose it, and reports connection failures with the target and underlying cause instead of a bare `fetch failed`.
