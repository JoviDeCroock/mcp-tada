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
- Add `introspect --watch` for servers that declare `tools.listChanged`, re-emitting the file on each notification during development.
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

Shipped: tool `annotations` in the snapshot with `ReadOnlyToolNames` / `readOnly`; `prompts`
in the snapshot with a typed `getPrompt` (and, in `combineMcpTada`, under the same alias prefix as
tools); and `resources` / `resourceTemplates` in the snapshot
with `readResource` (URIs completed, `contents[].mimeType` narrowed) and `readResourceTemplate`
(`params` parsed from the RFC 6570 `uriTemplate` at the type level, expanded at runtime by
mcp-tada's own small RFC 6570 expander, the one deliberate runtime step beyond forwarding,
alongside the `tools` Proxy; the library still imports nothing from either SDK). The template string itself is fetched from the live server on first use, since the
snapshot is type-only. Still open, in rough order of value:

- Server-side `definePrompts` / `defineResources` mirroring `defineTools`, feeding the same
  `IntrospectionOf`.
- Resources in `combineMcpTada`: a URI carries no alias to route on, so the combined client omits
  `readResource`; reach resources through `servers.<alias>`. Templates could be prefixed like
  tools.
- Elicitation results on the server: `requestedSchema` is a flat subset of what the mapper already
  handles (plus the titled-enum `anyOf` of `const` + `title`), so a typed `elicit(schema)` in
  `mcp-tada-server` is mostly a mapper reuse.

## Skills over MCP

SEP-2640 (Extensions Track, draft as of 2026-09) exposes agent skills over existing resources:
each skill file is a resource under `skill://<path>/<file>`, servers declare the extension as
`capabilities.extensions["io.modelcontextprotocol/skills"]`, and a `skills/list` method returns
entries with `uri`, `name`, `description`, `frontmatter` (the SKILL.md YAML as JSON) and
`resources`. It is not in `@modelcontextprotocol/sdk` 1.30 and no surveyed server implements it.

When the SDK ships it: snapshot `skills/list` into a `skills` map keyed by name with the
frontmatter as a JSON type literal, so an agent harness can type which skills a server offers and
read `SKILL.md` through a typed `readResource`. Until then it is reachable with
`client.request({ method: "skills/list" })` and no types.

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
