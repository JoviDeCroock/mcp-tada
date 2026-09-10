# Roadmap

Action items agreed on 2026-09-10. Each entry says what to build and the condition that unblocks it.

## Snapshot freshness from `ttlMs` and `cacheScope`

The 2026-07-28 spec revision adds `ttlMs` and `cacheScope` to `tools/list` results. `introspect` already reads both defensively and records them in the file header when present, but no surveyed server sends them yet because `@modelcontextprotocol/sdk` 1.30 negotiates protocol 2025-11-25.

When the SDK negotiates 2026-07-28:

- Persist `ttlMs`, `cacheScope`, and the introspection timestamp in the snapshot header and expose them in `parseDtsSnapshot`.
- Make `check` warn when a snapshot is older than its `ttlMs`, and refuse with a clear message when `cacheScope` says the list is per-user and the snapshot is being treated as shared.
- Add `introspect --watch` for servers that declare `tools.listChanged`, re-emitting the file on each notification during development.
- Re-run the survey scripts referenced in `survey.md` and update its `ttlMs` / `cacheScope` column.

## Server-side package

Shipped as `packages/mcp-tada-server`: `defineTool`/`defineTools` declare tools once from plain JSON Schema with a typed handler, `registerTools` installs them on an `McpServer` via the low-level `tools/list`/`tools/call` handlers (the high-level `registerTool` only accepts Zod/Standard Schema input, not raw JSON Schema, in SDK 1.30), and `IntrospectionOf` produces the same introspection type `mcp-tada introspect` would generate, for a same-codebase client with no network round trip.

## Mapper coverage from the survey

Add a fixture per surveyed server shape and snapshot-test the emitted types. Partially shipped:
`type` omitted around `properties` is now mapped as an object (`src/schema.ts`, covered by
`test/schema.test-d.ts`), and `type: [..., "null"]` unions each named type instead of only
handling primitives. Still open: `patternProperties`, `if` / `then` / `else`, `$ref` cycles
deeper than eight hops.

## Multi-server composition

Shipped: `combineMcpTada` merges several typed clients into one, namespacing tool names by server alias (default separator `"__"`) so identically named tools on different servers no longer collide. See the `## API` section of the root README.md.

## Follow-ups from the 2026-09-10 hardening pass

- `mcp-tada-server` handler return types still use input-mode `FromSchema` for `outputSchema`; switch to `FromOutputSchema` from `mcp-tada` so handler return types match what clients see.
- The JSON Schema validator in `packages/mcp-tada-server/src/validate.ts` covers the mapper's subset. Lift it into `mcp-tada` behind a `validated(client)` entry point so clients can opt into checking `structuredContent` at runtime.

## Release setup (one-time, manual)

Provenance-based publishing mirrors pracht. Before the first release on `main`:

1. Create the `npm` environment in the GitHub repository settings.
2. Publish `mcp-tada@0.1.0` and `mcp-tada-server@0.1.0` once by hand so the package pages exist.
3. On npmjs.com, for each package, add a trusted publisher: repository `JoviDeCroock/mcp-tada`, workflow `release.yml`, environment `npm`.
4. After that, `release.yml` stages every unpublished version with `pnpm stage publish --provenance` under OIDC and prints the stage ids; approve them with `npm stage approve <id>`.
