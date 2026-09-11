---
name: mcp-tada-cli
description: Add or change an mcp-tada CLI command, flag, or output - init, doctor, introspect, check - including the programmatic mcp-tada/cli subpath, exit codes, and the docs that must move with it. Use when touching anything under packages/mcp-tada/src/cli.
---

# Changing the CLI

Four commands, dispatched in `packages/mcp-tada/src/cli/main.ts`: `init`, `doctor`,
`introspect`, `check`. `bin/mcp-tada.js` is two lines and imports `../dist/cli/main.js`.

## The layering rule

`main.ts` owns argv parsing, stderr output, and exit codes. Nothing else does. Each command's
logic lives in its own module (`init.ts`, `doctor.ts`, `introspect.ts`, `check.ts`) as a function
taking an options object, and `src/cli/index.ts` re-exports those as the published `mcp-tada/cli`
subpath. A new flag therefore lands in two places: the parser in `main.ts`, and the option it
sets on the underlying function. If a flag can only be reached through argv, the programmatic
entry has a hole in it.

`mcp-tada/cli` is a separate export from `mcp-tada` because it imports `node:fs` and the SDK
transports. The client entry is zero-runtime and must never reach either. Do not shortcut this by
importing a CLI module from `src/index.ts`.

`test/cli-entry.test.ts` asserts the subpath's surface and that `package.json` exports it; extend
it when you add a public function.

## Exit codes are contract

- `introspect` exits 1 on a connection or timeout failure, naming the target. It writes nothing
  and prints `unchanged: <path>` when the output is byte-identical.
- `check` exits 1 on any difference at or above `--fail-on` (default `any`; also `dangerous` and
  `breaking`). Milder differences are still printed, and the run says it passed because of the
  flag.
- `doctor` exits 1 when any check is `fail`. Warnings never change the exit code, which is what
  lets it run before the first `introspect`.
- `init` exits 1 when no source config exists, printing every path it looked at, and refuses an
  existing config without `--force`.

Anything that makes a previously-passing invocation exit nonzero is a breaking change to
someone's CI. Say so in the changeset.

## Rejections that exist on purpose

Don't relax these without a reason in the PR description:

- `--out` with `--config` and more than one server selected — every server would overwrite the
  same file. The fix is an `output` per server, or a single alias positional.
- `--json` aimed at a `.d.ts` path, or a `.d.ts` snapshot aimed at a `.json` path — either leaves
  a file its extension misdescribes.
- Two servers sharing an `output` (a `doctor` `fail`).

## Tests

`test/cli.test.ts` drives `introspect`/`check` and the `runIntrospectWith` / `runCheckWith`
helpers from `main.ts` against `@modelcontextprotocol/server-everything` running from
`node_modules`, and writes to a tmpdir. `test/init-doctor.test.ts` covers config discovery and
the check list. `test/compat.test.ts` covers severity classification. Add to the one that matches
the layer you changed, and prefer driving the real command function over asserting on a string.

## Docs move with the code

`docs/cli.md` is the full reference and must describe every flag, default, warning, and exit
code. `README.md` carries the shorter user-facing version — per `AGENTS.md`, a user-facing change
is not finished until README covers it. Add a changeset for anything that changes observable CLI
behaviour. Then `pnpm run verify` from the root.
