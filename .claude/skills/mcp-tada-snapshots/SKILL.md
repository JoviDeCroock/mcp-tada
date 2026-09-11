---
name: mcp-tada-snapshots
description: Regenerate, review, or debug the committed introspection.d.ts snapshots in this repo, and read a `mcp-tada check` drift report. Use when a snapshot is stale, an e2e snapshot test reports drift, a change to introspect's output touches every generated file, or you need to decide whether drift means "regenerate" or "fix the code".
---

# Committed snapshots

A snapshot is the output of `mcp-tada introspect`: a `.d.ts` whose `export type introspection`
is strict quoted-key JSON, read back by `check` and by the test suite. It is generated, never
hand-edited. Its header says so. If you find yourself typing inside one, you are fixing the
wrong file: the generator is `packages/mcp-tada/src/cli/introspect.ts`.

The one exception is `packages/mcp-tada/test/fixtures/second.introspection.d.ts`, which is
hand-written on purpose (a second server whose `echo` collides with the `everything` fixture's,
to exercise `combineMcpTada` namespacing). Its comment says so. Do not regenerate it.

## Where they live and how to regenerate

Build first — the examples and `e2e` resolve the `mcp-tada` binary and types through its `dist`.

```sh
pnpm install && pnpm run build
```

| Snapshot | Source server | Regenerate |
| --- | --- | --- |
| `e2e/snapshots/*.introspection.d.ts` | 2 pinned stdio servers from `node_modules`, 3 public HTTP servers | `pnpm --filter @mcp-tada/e2e introspect` (network) |
| `examples/notes/src/notes.introspection.d.ts` | the example server in the same package | `pnpm --filter @mcp-tada/example-notes introspect` |
| `examples/{deepwiki,combined,code-mode}/src/*.introspection.d.ts` | public HTTP servers | `pnpm --filter @mcp-tada/example-<name> introspect` (network) |
| `packages/mcp-tada/test/fixtures/everything.introspection.d.ts` | `@modelcontextprotocol/server-everything` devDependency | see below |
| `packages/mcp-tada/test/fixtures/second.introspection.d.ts` | none, hand-written | never |

The `everything` fixture has no package script; run the built binary against the installed
server from inside `packages/mcp-tada`:

```sh
cd packages/mcp-tada && node bin/mcp-tada.js introspect \
  --stdio "node node_modules/@modelcontextprotocol/server-everything/dist/index.js" \
  --out test/fixtures/everything.introspection.d.ts
```

`introspect` prints `unchanged: <path>` and leaves the file alone when the output is
byte-identical, so running these is cheap and a clean `git status` afterwards is the pass
condition.

## Two different reasons a snapshot goes stale

Tell them apart before regenerating, because they need opposite reviews.

**The generator changed.** You edited `introspect.ts` — a new recorded field, a JSDoc change, a
sort order. Then *every* snapshot in the table is stale at once, including the fixtures, and the
diff should be mechanical and identical in shape across all of them. Regenerate them all in the
same commit as the generator change. A snapshot that does not move when you expected it to move
is a bug in the generator, not luck.

**A server changed.** Only that server's snapshot moves. The diff is the review artifact: read
it as a contract change and check whether any code in the repo relied on what went away. For the
public servers behind `e2e` and the examples, this is upstream drift and the diff is the news.

## Reading a check report

`mcp-tada check` groups differences by severity, worst first, with the reason underneath.

- **breaking** — code written against the snapshot can stop working: a removed tool or prompt, a
  newly required argument, a tightened `inputSchema`, a loosened or vanished `outputSchema`.
  Direction matters, because an input schema is written by the caller and an output schema is
  read by it, so the same edit is breaking on one side and additive on the other.
- **dangerous** — the contract holds but a promise was withdrawn: `readOnlyHint` or
  `idempotentHint` no longer `true`, `destructiveHint` or `openWorldHint` no longer `false`.
  Code that trusted the hint still compiles, which is the whole problem. Check whether anything
  passes that tool through `readOnly()` or `ReadOnlyToolNames`.
- **additive** — a new tool, a new optional property, a reworded description.

Anything `check` cannot model — an unrecognized keyword, a changed `$ref`, two incomparable
`pattern`s — is reported as breaking rather than waved through. A breaking entry you cannot
explain from the diff is usually this, not a real regression; confirm against
`packages/mcp-tada/src/cli/compat.ts` before treating it as one.

JSDoc is not data. `check` strips comments before parsing, so a reworded `description` or a new
`@param` tag is not drift — but it *is* a real snapshot diff, and it still has to be committed.

## After regenerating

Run `pnpm run verify` from the root. If the snapshot feeds a published package's behaviour or
you changed the generator, add a changeset; see `AGENTS.md`. The `e2e` suite is not part of
`verify` — run `pnpm test:e2e` yourself when you touched anything under `e2e/`.
