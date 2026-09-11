---
name: mcp-tada-snapshots
description: Regenerate or review an mcp-tada introspection.d.ts snapshot, and read a `mcp-tada check` drift report to decide whether drift means "regenerate the snapshot" or "fix the calling code". Use when a snapshot is stale, check fails in CI, or a snapshot diff shows up in a pull request.
---

# Snapshots and drift

A snapshot is what `mcp-tada introspect` writes: a `.d.ts` whose `export type introspection` is
strict quoted-key JSON, read back by `check` and by the typed client. It is generated, never
hand-edited. If a type looks wrong, the fix is on the server (or in how you read the type), not
in the file.

## Regenerating

```sh
npx mcp-tada introspect            # every server in mcp-tada.config.json
npx mcp-tada introspect <alias>    # one server
```

An unchanged file is left untouched (`unchanged: <path>`), so run it freely. Only the snapshot
of the server that changed should move; review its diff as a contract change and check whether
any call site relied on what went away. Commit the snapshot in the same change as the code that
adapts to it.

For a server you also author, regenerate whenever its tool definitions change. With
`mcp-tada-server`, `IntrospectionOf<typeof tools>` gives the same type with no snapshot, and the
two must agree.

## Reading a check report

`mcp-tada check` groups differences by severity, worst first, with reasons underneath.

- **breaking**. Code written against the snapshot can stop working: a removed tool or prompt, a
  newly required argument, a tightened `inputSchema`, a loosened or vanished `outputSchema`.
  Direction matters: the caller writes the input schema and reads the output schema, so the same
  edit is breaking on one side and additive on the other.
- **dangerous**. The contract holds but a promise was withdrawn: `readOnlyHint` or
  `idempotentHint` no longer `true`, `destructiveHint` or `openWorldHint` no longer `false`.
  Code still compiles, which is the problem. Check anything that routes the tool through
  `readOnly()` or `ReadOnlyToolNames`.
- **additive**. A new tool, a new optional property, a looser input schema, a reworded
  description.

Anything `check` cannot model (an unrecognized keyword, a changed `$ref`, two incomparable
`pattern`s) is reported as breaking rather than waved through. A breaking entry you cannot
explain from the diff is usually this; read the reason line before treating it as a regression.

Descriptions live in the JSDoc, which `check` strips, so a reworded description is not drift.
It still changes the snapshot file and still needs committing.

## Deciding what to do

- **Additive drift, nothing removed.** Regenerate, commit, done. `--fail-on dangerous` in CI
  makes this case pass without a regeneration.
- **Breaking or dangerous drift on a server you use.** Regenerate first so the compiler shows
  every affected call site, then fix those. Do not adapt code to a stale snapshot.
- **Breaking drift on a server you author.** Decide whether the server change was intended; if
  not, fix the server and re-run `check`.
- **A snapshot without a `prompts` key** against a server that offers prompts shows every prompt
  as added. Regenerate.
