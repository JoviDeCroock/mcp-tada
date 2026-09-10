# MCP server survey: outputSchema, JSON Schema dialect, and capability flags

Date: 2026-09-10

Purpose: inform the design of mcp-tada's compile-time JSON Schema -> TypeScript
mapping by sampling how real, publicly installable MCP servers actually shape
their `tools/list` results.

## Method

A Node script (`survey.mjs`, plus a small follow-up `survey2.mjs`) using
`@modelcontextprotocol/sdk` (v1.x, installed fresh in a scratch dir) connects
to each server over stdio (via `npx -y` or `uvx`) or Streamable HTTP, calls
`tools/list` with pagination, and records:

- `client.getServerVersion()` (name/version) and `client.getServerCapabilities()`
- tool count and count of tools with `outputSchema`
- for every `inputSchema`/`outputSchema` seen: `$schema` value, presence of
  `$ref`, `$defs`, `definitions`, `oneOf`/`anyOf`/`allOf`, `nullable: true`,
  `type` arrays, `additionalProperties: false`, empty `properties: {}`,
  schema nodes with no `type` key, mixed-type `enum`, `required` entries not
  present in `properties`, and max nesting depth
- whether the **raw JSON** of the `tools/list` response (not the SDK's typed
  object) contains the strings `"ttlMs"` or `"cacheScope"` (the SDK's result
  schema is bypassed via `z.any()` as the result schema so nothing gets
  stripped by validation)

Each connection/list call has a 30s timeout (45s on one retry); failures are
recorded with their error rather than left hanging.

**Caveat on protocol version:** the installed SDK (`@modelcontextprotocol/sdk@1.x`)
negotiates up to protocol version `2025-11-25`; it does not yet know about the
`2026-07-28` release candidate that introduces `ttlMs`/`cacheScope` on
`tools/list`. Since the client advertises `2025-11-25` during `initialize`,
servers that only emit those fields when the negotiated version is
`2026-07-28` would not show them here even if they support the RC in
principle. Treat the "0 servers observed" result below as "not observed under
2025-11-25 negotiation," not proof the fields don't exist anywhere.

### Rerunning

```bash
cd /path/to/scratch
npm init -y
npm install @modelcontextprotocol/sdk zod
node survey.mjs > results.json 2> log.txt
node survey2.mjs > results2.json 2> log2.txt
```

Scripts: `survey.mjs` (main batch, 23 servers) and `survey2.mjs` (follow-up
batch: Slack, SQLite, Google Maps, Stripe retry). Both scripts are
self-contained (server list is inline) and print one JSON array to stdout.
`uvx` (from `pip install --user uv`) is required for the `mcp-server-git`,
`mcp-server-fetch`, `mcp-server-time`, and `mcp-server-sqlite` entries.

## Servers surveyed

27 servers attempted, 23 succeeded, 4 failed.

| # | Server | Transport | Result | Tools | w/ outputSchema | listChanged | `$schema` seen |
|---|---|---|---|---|---|---|---|
| 1 | `@modelcontextprotocol/server-everything` (mcp-servers/everything 2.0.0) | stdio | ok | 13 | 1 | true | draft-07 |
| 2 | `@modelcontextprotocol/server-filesystem` (secure-filesystem-server 0.2.0) | stdio | ok | 14 | 14 | true | draft-07 |
| 3 | `@modelcontextprotocol/server-memory` (memory-server 0.6.3) | stdio | ok | 9 | 9 | true | draft-07 |
| 4 | `@modelcontextprotocol/server-sequential-thinking` (2026.8.31) | stdio | ok | 1 | 1 | true | draft-07 |
| 5 | `mcp-server-git` via uvx (mcp-git 1.30.0) | stdio | ok | 12 | 0 | false | none declared |
| 6 | `mcp-server-fetch` via uvx (mcp-fetch 1.30.0) | stdio | ok | 1 | 0 | false | none declared |
| 7 | `mcp-server-time` via uvx (mcp-time 1.30.0) | stdio | ok | 2 | 0 | false | none declared |
| 8 | `@playwright/mcp` (Playwright 1.63.0-alpha) | stdio | ok | 24 | 0 | absent (no `tools` cap object) | 2020-12 |
| 9 | `@upstash/context7-mcp` (Context7 4.0.7) | stdio | ok | 2 | 0 | true | 2020-12 |
| 10 | `firecrawl-mcp` (firecrawl-fastmcp 3.24.0) | stdio, dummy key | ok | 27 | 0 | absent | draft-07 |
| 11 | `@notionhq/notion-mcp-server` (Notion API 1.0.0) | stdio, dummy token | ok | 24 | 0 | absent | none declared (but uses $ref/$defs) |
| 12 | `@supabase/mcp-server-supabase` (supabase 0.12.0) | stdio, dummy token | ok | 29 | 0 | absent | draft-07 |
| 13 | `@sentry/mcp-server` (Sentry MCP 0.39.0) | stdio, dummy token | ok | 9 | 3 | true | draft-07 |
| 14 | `@stripe/mcp` | stdio, dummy key | **fail** | - | - | - | connect timeout (30s, retried at 45s) |
| 15 | `@modelcontextprotocol/server-github` (github-mcp-server 0.6.2) | stdio, dummy PAT | ok | 26 | 0 | absent | draft-07 |
| 16 | `@modelcontextprotocol/server-brave-search` (0.1.0) | stdio, dummy key | ok | 2 | 0 | absent | none declared |
| 17 | `@modelcontextprotocol/server-puppeteer` (0.1.0) | stdio | ok | 7 | 0 | absent | none declared |
| 18 | Cloudflare docs MCP via `mcp-remote` (docs-ai-search 0.4.13) | stdio wrapping HTTP | ok | 2 | 1 | true | 2020-12 |
| 19 | Linear MCP via `mcp-remote` | stdio wrapping SSE | **fail** | - | - | - | connection closed (requires OAuth login) |
| 20 | DeepWiki (`https://mcp.deepwiki.com/mcp`) (DeepWiki 2.14.3) | Streamable HTTP | ok | 3 | 3 | true | none declared |
| 21 | Cloudflare docs (`https://docs.mcp.cloudflare.com/mcp`) (docs-ai-search 0.4.13) | Streamable HTTP | ok | 2 | 1 | true | 2020-12 |
| 22 | Hugging Face (`https://huggingface.co/mcp`) (0.4.18) | Streamable HTTP | ok | 4 | 2 | false | 2020-12 |
| 23 | Context7 (`https://mcp.context7.com/mcp`) (4.0.7) | Streamable HTTP | ok | 2 | 0 | true | 2020-12 |
| 24 | `@modelcontextprotocol/server-slack` (Slack MCP Server 1.0.0) | stdio, dummy token | ok | 8 | 0 | absent | none declared |
| 25 | `mcp-server-sqlite` via uvx | stdio | **fail** | - | - | - | connection closed (needs pre-existing db file) |
| 26 | `@modelcontextprotocol/server-google-maps` (0.1.0) | stdio, dummy key | ok | 7 | 0 | absent | none declared |
| 27 | `@stripe/mcp` retry, 45s | stdio, dummy key | **fail** | - | - | - | connect timeout again (package likely needs network egress to Stripe or a valid-format key it rejects before listing) |

"absent" for `listChanged` means the server's `capabilities.tools` object in
`initialize` either omitted the `listChanged` key or omitted the `tools`
capability object's boolean value (SDK reports it as `undefined`), not that
the server declared `tools: {}` explicitly vs. omitted `tools` entirely - both
collapse to the same observable value from this script.

## Aggregate numbers (23 successful servers)

- **Tools total: 230.** Tools with `outputSchema`: **35 (15.2%)**.
- Servers where *at least one* tool has `outputSchema`: 6 of 23 (26%) -
  filesystem (14/14, 100%), memory (9/9, 100%), everything (1/13),
  sequential-thinking (1/1), Sentry (3/9), DeepWiki (3/3, 100%), Cloudflare
  docs (1/2 on both stdio and HTTP transports), Hugging Face (2/4). The
  remaining 17 servers (mostly the larger third-party API wrappers: Notion,
  Supabase, GitHub, Firecrawl, Playwright, Slack, Google Maps, Brave, git,
  fetch, time, Puppeteer, Context7) declared `outputSchema` on **zero**
  tools.
- **`outputSchema` adoption is bimodal, not gradual**: a server either
  declares it on all/most tools (official reference servers, DeepWiki) or on
  none. Nobody in the sample declares it on a random subset except Sentry
  (3/9) and everything (1/13, clearly a demo/test tool) and Hugging Face
  (2/4) and Cloudflare docs (1/2).
- **`$schema` dialect:** of the 23 servers, 8 declare `http://json-schema.org/draft-07/schema#`
  on every schema node that carries `$schema` (all official
  `@modelcontextprotocol/server-*` packages plus Firecrawl, Supabase, GitHub,
  Sentry), 6 declare `https://json-schema.org/draft/2020-12/schema` (Playwright,
  Context7 (both transports), Cloudflare docs (both transports), Hugging
  Face), and **9 servers never emit a `$schema` keyword at all** (git, fetch,
  time, Notion, Brave, Puppeteer, DeepWiki, Slack, Google Maps) - roughly
  39% of servers ship schemas with no explicit dialect tag, which in
  practice all still read as plain JSON Schema (Draft 7-ish: `type`,
  `properties`, `required`, `enum`, `items`) since MCP's spec-level
  `inputSchema`/`outputSchema` shape is defined as a JSON Schema object with
  `type: "object"`.
- **`$ref`/`$defs`/`definitions`:** only Notion uses `$ref` and `$defs`
  (nested union types like page-property values reference shared defs); no
  server in the sample uses old-style `definitions`. This is the strongest
  signal that a compile-time mapper needs `$ref`/`$defs` resolution even
  though it is rare (1/23 servers, 4%) - it is exactly the kind of tool
  (rich CRUD API with polymorphic payloads) mcp-tada is likely to be pointed
  at.
- **`oneOf`/`anyOf`/`allOf`:** `anyOf` appears in 7/23 servers (filesystem,
  git, GitHub, Sentry, Notion, DeepWiki, Hugging Face), mostly for "string or
  array of strings" / "id can be number or string" style union params.
  `oneOf` appears in only 2 (Notion, Hugging Face). `allOf` appears in 1
  (Hugging Face, used for `if`/`then`-adjacent nested composition in the
  input schema). None combine all three in one schema node.
- **`nullable: true`:** never observed (0/23). Every server that wants an
  optional-or-null field either uses a `type` array (`["string","null"]`,
  3 servers: sequential-thinking, Sentry, Notion) or just omits the field
  from `required` rather than making it schema-nullable. This is useful:
  mcp-tada likely does not need OpenAPI-style `nullable` support for its v1
  mapper, but does need `type` array support.
- **`additionalProperties: false`:** common - 13/23 servers set it somewhere
  (mostly on `outputSchema` object roots and on `items` of array
  parameters), suggesting closed-shape TS interfaces (no index signature)
  are the right default when `additionalProperties` is absent, and an
  explicit `false` should map to a sealed/exact object type if mcp-tada ever
  supports that.
- **Empty `properties: {}`:** seen in 9/23 servers, always on tools that take
  no arguments (e.g. `list_directory_roots`-style zero-arg tools, or
  parameterless "get current context" tools). A mapper needs to render this
  as `{}` (an empty object type), not `Record<string, never>` or `unknown`,
  to stay ergonomic.
- **Schema nodes with `type` omitted entirely:** 7/23 servers have at least
  one schema node with no `type` key while still having `properties`/`items`/
  `oneOf`/`anyOf` (filesystem, git, Notion, Sentry, GitHub, DeepWiki, Hugging
  Face) - almost always the *wrapper* node around an `anyOf`/`oneOf`, i.e.
  `{ "anyOf": [...] }` with no sibling `type`. A mapper must not assume every
  schema object carries `type`; it should fall back to structural inference
  (properties present -> object, items present -> array, oneOf/anyOf/allOf
  present -> union) when `type` is absent.
- **Mixed-type `enum` values:** none observed (0/23). All `enum`s in the
  sample are homogeneous (all strings, or all numbers).
- **`required` referencing a property not present in `properties`:** none
  observed (0/23) - every `required` array in the sample is a subset of that
  node's own `properties` keys. This is reassuring for a mapper that wants to
  assert `required[i] extends keyof properties` and treat any violation as a
  loud compile error rather than a silent widen.
- **Max nesting depth:** ranged from 2 (single flat-object schemas, e.g.
  Context7, Brave, puppeteer) to 17 (Hugging Face's `search`/`hub_repo`
  tools, which have deeply nested `allOf`/`anyOf` filter trees). Depth 5-9
  was typical for CRUD-API servers with nested object parameters (Notion,
  GitHub, filesystem, Firecrawl, git). A mapper needs to either handle
  unbounded recursion depth or have a documented, generous depth cap (17+
  is real, not hypothetical).
- **`tools.listChanged`:** declared `true` by 10/23 servers (43%,
  overwhelmingly the official reference servers plus the hosted HTTP
  services that dynamically add tools), `false` by 4/23 (17%, the uvx
  Python servers: git, fetch, time - `mcp-server-sqlite` would likely match
  but it failed to connect - plus Hugging Face), and the `tools` capability
  either omitted the key or was absent from `capabilities` entirely for the
  remaining 9/23 (39%, mostly larger commercial-API wrapper servers:
  Playwright, Firecrawl, Notion, Supabase, GitHub, Brave, Puppeteer, Slack,
  Google Maps). So a caller cannot assume `listChanged` is present at all;
  it must be treated as optional/absent-means-false.
- **`ttlMs` / `cacheScope` on `tools/list`:** **0/23 servers** show either
  field in the raw JSON response. This is expected given the protocol
  version caveat above - the SDK used here negotiates `2025-11-25`, one
  version before the `2026-07-28` RC that reportedly introduces these
  fields, so no currently-shipping server implementation would emit them
  under this negotiation. mcp-tada should treat `ttlMs`/`cacheScope` as
  forward-looking/optional fields to parse defensively (ignore if absent)
  rather than something to rely on today.

## Failures and why they matter

- `@stripe/mcp` timed out twice (30s and 45s) even with a syntactically
  well-formed dummy `sk_test_...` key - it appears to validate the key
  against Stripe's API (network call) before it will respond to
  `initialize`/`tools/list`, so it cannot be surveyed without a real test
  key. Not included in tool-count aggregates.
- Linear's MCP endpoint requires interactive OAuth even via `mcp-remote`;
  skipped per the task's "skip anything that needs a browser login" rule.
- `mcp-server-sqlite` (uvx) closed the connection immediately - it likely
  needs the db file to already exist with a valid SQLite header rather than
  an empty placeholder path. Not pursued further given time budget.

## Observations most relevant to a JSON Schema -> TypeScript mapper

1. Plan for `outputSchema` to be **absent** on the large majority of tools in
   the wild today (85% of tools, 74% of servers in this sample) - the
   generated client type for a tool's result must gracefully fall back to a
   generic `CallToolResult`/`unknown content` shape, not assume a typed
   result is always derivable.
2. When `outputSchema` is present, it tends to be present on *every* tool of
   that server, so a per-server "fully typed" fast path (all tools typed, or
   none) is a reasonable design target even though the spec allows mixing.
3. `$schema` is frequently absent (39% of servers) or inconsistent
   (draft-07 vs 2020-12 split roughly 8:6 among those who declare it) -
   don't dialect-sniff to change parsing behavior; treat all incoming
   schemas as the same permissive JSON-Schema-ish subset MCP actually uses
   (Draft 7 core keywords plus `$ref`/`$defs` when present), since real
   servers don't consistently declare which dialect they're using anyway.
4. `$ref`/`$defs` resolution, while rare (1/23 servers here), is exercised
   by exactly the kind of rich, polymorphic API (Notion) that makes a
   type-level mapper valuable in the first place - it should not be treated
   as a nice-to-have edge case.
5. Structural type inference (object vs array vs union) must not depend on
   a `type` keyword being present - 7/23 servers have schema nodes that omit
   `type` while still being clearly structured via `properties`/`anyOf`/etc.
6. No server in the sample uses OpenAPI's `nullable: true`; optionality is
   expressed via `type` arrays (`["T","null"]`) or simply omitting a key from
   `required`. `nullable` support can be deprioritized for v1.
7. `additionalProperties: false` is common enough (57% of servers) that
   mcp-tada's default object-type generation should probably treat "no
   `additionalProperties` key" and "`additionalProperties: true`" the same
   (open/extensible), and only special-case `false` if/when exact object
   types are added.
8. `tools.listChanged` and the RC's `ttlMs`/`cacheScope` should both be
   modeled as optional at the type level - `listChanged` is omitted by 39%
   of currently-shipping servers, and `ttlMs`/`cacheScope` were not observed
   at all under the protocol version this SDK currently negotiates.
9. Max schema nesting hit 17 levels on a real, popular server (Hugging
   Face) - any recursive-type generation in mcp-tada needs either genuine
   recursion (not a fixed unroll depth under ~10) or a documented, tested
   cutoff with a clear fallback (e.g. `unknown`) past that depth.
