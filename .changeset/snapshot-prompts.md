---
"mcp-tada": minor
---

Record `prompts/list` in the introspection snapshot when the server offers prompts, and add a typed `getPrompt(name, args?)` and `listPrompts()` to the client, with `PromptNames` and `PromptArgs` for naming the derived types; `mcp-tada check` now also reports added, removed and re-argued prompts.
