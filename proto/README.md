# mcp-tada prototype (2026-09-10)

Feasibility spike: gql.tada-style zero-runtime typing for MCP tool calls.

- `introspect.mjs` — connects to a server over stdio, pages `tools/list`, writes `introspection.d.ts`
  (name-keyed map of `{ inputSchema, outputSchema? }`).
- `tada.ts` — ~40-line purpose-built type-level JSON Schema → TS mapper + `initMcpTada<introspection>()`.
  `callTool(name, args)` narrows the name, infers args from `inputSchema`, types `structuredContent` from `outputSchema`.
- `usage.ts` — 4 positive cases + 4 `@ts-expect-error` negatives (unknown tool, missing required, wrong type, wrong output type).

Run: `npm i @modelcontextprotocol/sdk @modelcontextprotocol/server-everything typescript && node introspect.mjs && npx tsc -p tsconfig.json`

Note: `json-schema-to-ts`'s `FromSchema` hit "type instantiation excessively deep" (12M instantiations) on the real
schemas; the lean mapper checks the same file in 24k instantiations / 25ms. Own the mapper.
