# mcp-tada

## 0.3.0

### Minor Changes

- [#14](https://github.com/JoviDeCroock/mcp-tada/pull/14) [`a38a46f`](https://github.com/JoviDeCroock/mcp-tada/commit/a38a46f885c4b67ec022d430773f84c1e1e43890) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - `mcp-tada check` now rates every difference as additive, dangerous (a tool withdrew a safety hint
  such as `readOnlyHint`), or breaking, groups the report by severity, and takes
  `--fail-on <any|dangerous|breaking>` to choose which of those exits 1. A schema difference is
  judged by direction: tightening an `inputSchema` or loosening an `outputSchema` breaks callers,
  the reverse is additive. `report.severity` and `report.changes` expose the same classification
  to the programmatic API, and `compareSchemas` is exported for diffing two schemas on their own.

- [#13](https://github.com/JoviDeCroock/mcp-tada/pull/13) [`9295ff4`](https://github.com/JoviDeCroock/mcp-tada/commit/9295ff4c3c0ae3fdd6ec6663096a49f94f7a8af2) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Show tool documentation on hover. `mcp.tools.<name>` (and the `readOnly` view) now maps homomorphically over the snapshot, so the tool's JSDoc reaches the editor instead of being dropped by the mapped type. `mcp-tada introspect` also emits each argument's `description` as a `@param args.<name>` tag, falls back to `annotations.title` when a tool has no top-level `title`, and prefixes every line of a multi-line description with ` * `. Regenerate snapshots to pick up the new comments; `check` ignores JSDoc, so existing snapshots keep passing.

- [#11](https://github.com/JoviDeCroock/mcp-tada/pull/11) [`2eb350c`](https://github.com/JoviDeCroock/mcp-tada/commit/2eb350c4f18d6cae8694532161d3ff86ac14975b) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Add `mockMcpTada` under `mcp-tada/testing`, a typed in-memory `TypedClient` whose handlers are checked against the snapshot and which records every call for assertions.

### Patch Changes

- [#16](https://github.com/JoviDeCroock/mcp-tada/pull/16) [`c189159`](https://github.com/JoviDeCroock/mcp-tada/commit/c189159f8b33cc9ebd4207048b8db608a1d84fb5) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - The package now ships agent skills under `skills/` (integration, CLI, snapshots, and type mapping) for copying or linking into a project's `.claude/skills/`.

## 0.2.0

### Minor Changes

- [#2](https://github.com/JoviDeCroock/mcp-tada/pull/2) [`16265a7`](https://github.com/JoviDeCroock/mcp-tada/commit/16265a7e293bdac9bfa86ba3d37f4d6ad5f2d082) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Add a `mcp-tada/cli` entry exporting `introspect`, `check`, and their building blocks for programmatic use, replacing the unreachable `dist/cli/*` deep imports.

- [#12](https://github.com/JoviDeCroock/mcp-tada/pull/12) [`058c5df`](https://github.com/JoviDeCroock/mcp-tada/commit/058c5dfaa12be683f4248044101094bdbce676a4) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Add `mcp-tada init`, which writes `mcp-tada.config.json` from a project's `.mcp.json`, Cursor, VS Code, or Claude Desktop server list, and `mcp-tada doctor`, which checks installed versions, the config, every snapshot, and whether each server answers.

- [#3](https://github.com/JoviDeCroock/mcp-tada/pull/3) [`cf8b8ce`](https://github.com/JoviDeCroock/mcp-tada/commit/cf8b8ce049cc22a6906a313e236466d40b80cc09) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Record tool `annotations` in the introspection snapshot, add `ReadOnlyToolNames`, `NonDestructiveToolNames`, `ToolAnnotationsOf`, `PickTools` and a `readOnly(client)` view that narrows a typed client to its read-only tools, and make `mcp-tada check` report annotation drift, calling out tools that stopped being read-only or non-destructive.

- [#4](https://github.com/JoviDeCroock/mcp-tada/pull/4) [`1a6d097`](https://github.com/JoviDeCroock/mcp-tada/commit/1a6d097d0804c21f60abbea94f9d51f7b34cfd0b) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Record `prompts/list` in the introspection snapshot when the server offers prompts, and add a typed `getPrompt(name, args?)` and `listPrompts()` to the client, with `PromptNames` and `PromptArgs` for naming the derived types; `mcp-tada check` now also reports added, removed and re-argued prompts.

### Patch Changes

- [#8](https://github.com/JoviDeCroock/mcp-tada/pull/8) [`3edce11`](https://github.com/JoviDeCroock/mcp-tada/commit/3edce1163317a00e17391b61a6225dbc8dcfd587) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - `introspect` rejects `--json` with a `.d.ts` output path instead of corrupting the file, omits the `protocolVersion` header line when the transport does not expose it, and reports connection failures with the target and underlying cause instead of a bare `fetch failed`.

- [#5](https://github.com/JoviDeCroock/mcp-tada/pull/5) [`dbb0e62`](https://github.com/JoviDeCroock/mcp-tada/commit/dbb0e6234f706a6174a2b59a5596c11cc04779cb) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Send `arguments: {}` when a tool is called without arguments, since servers built on the official SDK reject a missing arguments object.

- [#9](https://github.com/JoviDeCroock/mcp-tada/pull/9) [`8c7e5d4`](https://github.com/JoviDeCroock/mcp-tada/commit/8c7e5d40e049d994e96439a1c2870c3b3a0d424c) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Generated snapshots now start with `/* eslint-disable */` and carry a `/* prettier-ignore */` line, so a project formatter no longer unquotes the keys and breaks `mcp-tada check`.

## 0.1.0

### Minor Changes

- [`3849970`](https://github.com/JoviDeCroock/mcp-tada/commit/3849970a3546223d0394062c82307d3750809068) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - Add a `tools` namespace to typed and combined clients so every tool is callable as a method, `mcp.tools.read_file({ path })` or `combined.tools.gh.search({ query })`, with the same types as `callTool`.
