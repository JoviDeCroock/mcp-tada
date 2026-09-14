# mcp-tada-server

## 0.2.0

### Minor Changes

- [#21](https://github.com/JoviDeCroock/mcp-tada/pull/21) [`1394e22`](https://github.com/JoviDeCroock/mcp-tada/commit/1394e22f58d60b9ec0c708db824ad2c2d100499c) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - `mcp-tada-server` now targets MCP SDK v2: it peer-depends on `@modelcontextprotocol/server` instead of `@modelcontextprotocol/sdk`, and tool handlers receive v2's `ServerContext` as their second argument. Replace the dependency, import `McpServer` from `@modelcontextprotocol/server`, and read `ctx.mcpReq.signal` where a handler read `extra.signal`.

### Patch Changes

- Updated dependencies [[`a7bafc9`](https://github.com/JoviDeCroock/mcp-tada/commit/a7bafc9a480bc44df4d94b205535f3de03119d20), [`a7bafc9`](https://github.com/JoviDeCroock/mcp-tada/commit/a7bafc9a480bc44df4d94b205535f3de03119d20), [`a7bafc9`](https://github.com/JoviDeCroock/mcp-tada/commit/a7bafc9a480bc44df4d94b205535f3de03119d20), [`1394e22`](https://github.com/JoviDeCroock/mcp-tada/commit/1394e22f58d60b9ec0c708db824ad2c2d100499c)]:
  - mcp-tada@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`a38a46f`](https://github.com/JoviDeCroock/mcp-tada/commit/a38a46f885c4b67ec022d430773f84c1e1e43890), [`9295ff4`](https://github.com/JoviDeCroock/mcp-tada/commit/9295ff4c3c0ae3fdd6ec6663096a49f94f7a8af2), [`c189159`](https://github.com/JoviDeCroock/mcp-tada/commit/c189159f8b33cc9ebd4207048b8db608a1d84fb5), [`2eb350c`](https://github.com/JoviDeCroock/mcp-tada/commit/2eb350c4f18d6cae8694532161d3ff86ac14975b)]:
  - mcp-tada@0.3.0

## 0.1.0

### Minor Changes

- [#3](https://github.com/JoviDeCroock/mcp-tada/pull/3) [`cf8b8ce`](https://github.com/JoviDeCroock/mcp-tada/commit/cf8b8ce049cc22a6906a313e236466d40b80cc09) Thanks [@JoviDeCroock](https://github.com/JoviDeCroock)! - `IntrospectionOf` now carries each tool's `annotations` with literal values, so `readOnly` and `ReadOnlyToolNames` from `mcp-tada` work on a same-codebase client.

### Patch Changes

- Updated dependencies [[`16265a7`](https://github.com/JoviDeCroock/mcp-tada/commit/16265a7e293bdac9bfa86ba3d37f4d6ad5f2d082), [`3edce11`](https://github.com/JoviDeCroock/mcp-tada/commit/3edce1163317a00e17391b61a6225dbc8dcfd587), [`dbb0e62`](https://github.com/JoviDeCroock/mcp-tada/commit/dbb0e6234f706a6174a2b59a5596c11cc04779cb), [`058c5df`](https://github.com/JoviDeCroock/mcp-tada/commit/058c5dfaa12be683f4248044101094bdbce676a4), [`cf8b8ce`](https://github.com/JoviDeCroock/mcp-tada/commit/cf8b8ce049cc22a6906a313e236466d40b80cc09), [`8c7e5d4`](https://github.com/JoviDeCroock/mcp-tada/commit/8c7e5d40e049d994e96439a1c2870c3b3a0d424c), [`1a6d097`](https://github.com/JoviDeCroock/mcp-tada/commit/1a6d097d0804c21f60abbea94f9d51f7b34cfd0b)]:
  - mcp-tada@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [[`3849970`](https://github.com/JoviDeCroock/mcp-tada/commit/3849970a3546223d0394062c82307d3750809068)]:
  - mcp-tada@0.1.0
