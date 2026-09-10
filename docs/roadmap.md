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

A sub-package that lets server authors declare tools once, emit `outputSchema`, and produce the same introspection type without a network round trip. See the discussion in AGENTS.md history for scope.

## Mapper coverage from the survey

Add a fixture per surveyed server shape and snapshot-test the emitted types. Known gaps: `type` omitted around `properties`, `patternProperties`, `if` / `then` / `else`, `$ref` cycles deeper than eight hops.

## Multi-server composition

Namespacing when several introspections are combined and tool names collide.
