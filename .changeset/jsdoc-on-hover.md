---
"mcp-tada": minor
---

Show tool documentation on hover. `mcp.tools.<name>` (and the `readOnly` view) now maps homomorphically over the snapshot, so the tool's JSDoc reaches the editor instead of being dropped by the mapped type. `mcp-tada introspect` also emits each argument's `description` as a `@param args.<name>` tag, falls back to `annotations.title` when a tool has no top-level `title`, and prefixes every line of a multi-line description with ` * `. Regenerate snapshots to pick up the new comments; `check` ignores JSDoc, so existing snapshots keep passing.
