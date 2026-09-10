---
"mcp-tada": minor
---

Record tool `annotations` in the introspection snapshot, add `ReadOnlyToolNames`, `NonDestructiveToolNames`, `ToolAnnotationsOf`, `PickTools` and a `readOnly(client)` view that narrows a typed client to its read-only tools, and make `mcp-tada check` report annotation drift, calling out tools that stopped being read-only or non-destructive.
