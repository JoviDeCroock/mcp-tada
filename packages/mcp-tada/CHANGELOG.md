# mcp-tada

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
