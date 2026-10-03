# Roadmap

Action items agreed on 2026-09-10. Each entry says what to build and the condition that unblocks it.

## Snapshot freshness from `ttlMs` and `cacheScope`

The CLI supports both SDK families and defaults to the legacy handshake. With SDK v2,
`--protocol auto` or `--protocol 2026-07-28` opts into the new revision; `introspect` records the
negotiated version and `ttlMs` / `cacheScope` when present. The notes example serves both eras
and generates its snapshot through modern negotiation.

Remaining freshness work:

- Persist `ttlMs`, `cacheScope`, and the introspection timestamp in the snapshot header and expose them in `parseDtsSnapshot`.
- Make `check` warn when a snapshot is older than its `ttlMs`, and refuse with a clear message when `cacheScope` says the list is per-user and the snapshot is being treated as shared.
- Add `introspect --watch`: on 2026-07-28 connections, open `subscriptions/listen` with
  `toolsListChanged` / `promptsListChanged` filters for the advertised capabilities before
  relying on notifications. Use the SDK to handle legacy notification delivery, reconnect and
  cancellation; re-fetch the affected lists and re-emit the snapshot after changes.
- Re-run the survey scripts referenced in `survey.md` and update its `ttlMs` / `cacheScope` column.

## Server-side package

Shipped as `packages/mcp-tada-server`: `defineTool`/`defineTools` declare tools once from plain JSON Schema with a typed handler, `registerTools` installs them on an `McpServer` via the low-level `tools/list`/`tools/call` handlers (SDK v2's high-level `registerTool` takes JSON Schema through `fromJsonSchema`, but re-renders it, and the point is emitting the written schema verbatim), and `IntrospectionOf` produces the same introspection type `mcp-tada introspect` would generate, for a same-codebase client with no network round trip.

## SDK v1 and v2

Shipped: the typed client accepts a `Client` from either SDK through the structural `ClientLike` in `packages/mcp-tada/src/wire.ts`, and the CLI loads whichever SDK is installed through `packages/mcp-tada/src/cli/sdk.ts` (v2 first); only `mcp-tada-server` is v2-only. The v1 `callTool` arity is selected per client by the presence of `getProtocolEra`, which only v2's `Client` has. Drop v1 acceptance, the v1 loader, and the v1 devDependency that tests them, once `@modelcontextprotocol/sdk` 1.x stops being maintained; until then, a v1 release that grows a `getProtocolEra` method would need a different discriminator.

## Mapper coverage from the survey

Add a fixture per surveyed server shape and snapshot-test the emitted types. Partially shipped:
`type` omitted around `properties` is now mapped as an object (`src/schema.ts`, covered by
`test/schema.test-d.ts`), `type: [..., "null"]` unions each named type instead of only
handling primitives, `patternProperties` maps to one index signature over the union of its value
schemas, and `if` / `then` / `else` maps to the union of the base with each branch applied. Still
open: `$ref` cycles deeper than eight hops, and `dependentRequired` / `dependentSchemas`.

## Beyond tools

Shipped: tool `annotations` in the snapshot with `ReadOnlyToolNames` / `readOnly`, `prompts`
in the snapshot with a typed `getPrompt`, and prompts in `combineMcpTada` under the same alias
prefix as tools. Still open, in rough order of value:

- Resource templates: parse `uriTemplate` (RFC 6570) at the type level into a params object for a
  typed `readResource`, and narrow the result on `mimeType`. Needs a few lines of runtime template
  expansion, the first real runtime in the client, so it should be a deliberate exception like the
  `tools` Proxy.
- Server-side `definePrompts` / `defineResources` mirroring `defineTools`, feeding the same
  `IntrospectionOf`.
- Elicitation results on the server: `requestedSchema` is a flat subset of what the mapper already
  handles (plus the titled-enum `anyOf` of `const` + `title`), so a typed `elicit(schema)` in
  `mcp-tada-server` is mostly a mapper reuse.

## Skills over MCP

[SEP-2640](https://modelcontextprotocol.io/seps/2640-skills-extension) reached Final on
2026-09-13. The [Skills extension](https://modelcontextprotocol.io/extensions/skills/overview)
is optional; SDK and host support is still being implemented. It is not implemented by
mcp-tada. The September 10 server survey predates finalization and is not evidence of current
adoption.

The accepted design requires `resources` plus
`capabilities.extensions["io.modelcontextprotocol/skills"]`, and provides:

- `skills/list` for paginated discovery and `skills/get` for retrieval by URI, including skills
  absent from an empty or partial listing.
- Entries containing `uri`, `frontmatter` (including `name` and `description`), and `resources`:
  either a complete manifest of file URIs, SHA-256 digests and byte sizes, or `"dynamic"`.
- `resources/read` for file contents and optional `resources/directory/read`, gated by the
  extension's `directoryRead` capability.

Before adding support, verify the available SDK extension API and add a fixture from an
implementing server. Snapshot known skills by URI within each server, preserving frontmatter
and manifest metadata as JSON. Names are labels and can collide; cross-server identity must
retain both the server and URI. Keep direct URI retrieval available because a snapshot cannot
claim to enumerate every skill. Any snapshot extension must update the CLI writer/parser,
client types and server-side introspection contract together.

Reading a resource does not activate a skill. Content integrity checks, activation, approval and
execution belong to the host; the zero-runtime client must not imply that a typed snapshot
performs them.

## Protocol follow-ups

The [2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
is released. SDK v2 removes the wire-only `resultType` from completed results; do not promise
that discriminator on the typed client. Keep SDK multi-round-trip elicitation handling intact,
pass server-side `input_required` results through before output wrapping, and cover primitive,
array and null structured outputs in client / server integration tests. Transport metadata and
HTTP parameter headers should stay in the SDK.

The [August 22 roadmap](https://modelcontextprotocol.io/development/roadmap) also targets
progressive discovery, revised tool result semantics, ETags and HTTP over stdio. These are
planning directions, not shipped requirements. Revisit the assumption of a complete tool
catalog when a concrete discovery extension is available; do not change the snapshot contract
or add transports based on roadmap proposals alone.

## Multi-server composition

Shipped: `combineMcpTada` merges several typed clients into one, namespacing tool names by server alias (default separator `"__"`) so identically named tools on different servers no longer collide. See the `## API` section of the root README.md.

## Follow-ups from the 2026-09-10 hardening pass

- `mcp-tada-server` handler return types still use input-mode `FromSchema` for `outputSchema`; switch to `FromOutputSchema` from `mcp-tada` so handler return types match what clients see.
- The JSON Schema validator in `packages/mcp-tada-server/src/validate.ts` covers the mapper's subset. Lift it into `mcp-tada` behind a `validated(client)` entry point so clients can opt into checking `structuredContent` at runtime.

## Release setup (one-time, manual)

Provenance-based publishing mirrors pracht. Before the first release on `main`:

1. Create the `npm` environment in the GitHub repository settings.
2. Both packages were published by hand at 0.0.0 on 2026-09-10, so the package pages exist.
3. On npmjs.com, for each package, add a trusted publisher: repository `JoviDeCroock/mcp-tada`, workflow `release.yml`, environment `npm`.
4. After that, `release.yml` stages every unpublished version with `pnpm stage publish --provenance` under OIDC and prints the stage ids; approve them with `npm stage approve <id>`.
