---
name: mcp-tada-type-mapper
description: Change the type-level JSON Schema mapper or any derived type in mcp-tada - schema.ts, index.ts, annotations.ts, prompts.ts, combine.ts. Use when adding JSON Schema keyword support, fixing an inferred argument or structuredContent type, or when a type change risks the compiler instantiation budget.
---

# Changing the type-level mapper

`packages/mcp-tada/src/schema.ts` is a purpose-built mapper, about 170 lines, with no type-level
library dependency. That is the product, not an implementation detail: off-the-shelf mappers were
measured at over 12 million type instantiations on real server schemas and this one does the same
work in a fraction of that, which is why editor feedback stays instant. Every change is judged
against that budget first and expressiveness second.

Read the comment block at the top of `schema.ts` before editing. It records the spec-mapping
decisions already made and why, and most "the type is wrong" reports are one of those decisions
working as intended.

## The three rules

**Zero runtime.** `packages/mcp-tada/src/index.ts` may only forward to the SDK `Client`. If a
feature needs runtime work, it is a deliberate exception that gets argued for, not slipped in.
The `tools` Proxy is the existing one; URI template expansion for resources would be the next.

**Input mode and output mode are not symmetric.** `FromSchema` maps arguments the caller
constructs, so an object with no `additionalProperties` stays closed and gets excess-property
checking. `FromOutputSchema` maps `structuredContent` the server constructed, so the same object
stays open with `& { [k: string]: unknown }`, because an undeclared-but-present key is `unknown`,
not a compile error. `additionalProperties: false` closes both. Any new keyword has to answer
"what does this mean in each mode" before it is implemented.

**Every change adds a case to `packages/mcp-tada/test/schema.test-d.ts`.** Positive assertion
plus a `// @ts-expect-error` negative, matching the file's existing style. Type tests run through
vitest's typecheck mode (`test/**/*.test-d.ts`), so `pnpm --filter mcp-tada test` covers them.

## The instantiation budget

The real gate is `e2e/test/compile.e2e.ts`: each live server's snapshot must compile with every
derived type forced through declaration emit in under `MAX_INSTANTIATIONS` (400,000). It needs
the network and is not part of `pnpm run verify`, so run it deliberately:

```sh
pnpm test:e2e
```

For a fast local signal while iterating, measure before and after your change and compare:

```sh
pnpm typecheck --extendedDiagnostics | grep -E "typecheck:|Instantiations"
```

That reports per package; `packages/mcp-tada` is the one to watch, and it sits around 217k today.
The number covers the sources plus the whole test suite, not the mapper alone, so treat it as a
delta instrument rather than an absolute budget. A few thousand either way is noise. A jump of an
order of magnitude means the change is quadratic in schema size — usually a mapped type that
re-resolves a `$ref` per property, or a conditional that distributes over a union it should not.
Fix the shape rather than raising a cap.

`$ref` resolution is capped at 8 levels and bails to `unknown` past that. Keep any new recursion
bounded the same way.

## Keep the differ in step

`packages/mcp-tada/src/cli/compat.ts` classifies schema differences for `check` and is a separate
implementation from the mapper. Anything it does not recognize is reported as **breaking** by
design. So when the mapper learns a keyword, decide whether `compareSchemas` should learn it too;
otherwise a schema the types now handle still fails `check` as unmodelled. Add the case to
`packages/mcp-tada/test/compat.test.ts` in the same change.

## Known open gaps

From `docs/roadmap.md`, deliberately unimplemented: `patternProperties`, `if` / `then` / `else`,
and `$ref` cycles deeper than eight hops. `docs/survey.md` is the evidence base — 23 public
servers, 230 tools — and is the right place to check how common a shape actually is before
spending instantiations on it.

## Finishing

`pnpm run verify` from the root, a changeset for any user-visible type change, and README
coverage if the change alters what users see on hover or in an inferred type. See `AGENTS.md`.
