---
name: mcp-tada-cli
description: Run the mcp-tada CLI - init, doctor, introspect, check - or drive the same commands from a script through the mcp-tada/cli subpath. Use when generating or checking a snapshot, wiring mcp-tada into CI, or interpreting an exit code, warning, or rejected flag combination.
---

# The mcp-tada CLI

Four commands. `--help` and `--version` are the only others.

| Command | Does | Exits 1 when |
| --- | --- | --- |
| `init` | writes `mcp-tada.config.json` from `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, or Claude Desktop (`--from <path>` to pick) | no source config found (it prints every path it tried); config exists and no `--force` |
| `doctor` | one `ok` / `warn` / `fail` line per setup check: SDK and TypeScript versions, config, snapshots, live servers (`--offline` skips connecting) | any check is `fail`. Warnings never fail, so it runs before the first `introspect` |
| `introspect [alias]` | connects, pages `tools/list` and `prompts/list`, writes the snapshot | connection or timeout failure, naming the target |
| `check [alias]` | re-introspects and diffs against the snapshot (`--against <path>` for an explicit file) | any difference at or above `--fail-on` (`any`, default; `dangerous`; `breaking`) |

## Targets

With a config, commands take an optional alias and default to every server. Without one, pick
a target: `--command "node server.js"` / `--stdio "npx -y pkg args"` (plus repeatable `--arg`
and `--env K=V`), or `--url https://... --header "Name: Value"`. HTTP falls back to legacy SSE
on a 4xx. `--timeout <ms>` (default 30000) covers connect and each list request and overrides a
server's `timeoutMs` in the config.

## Output

- `--out <path>` sets the snapshot path (config `output` otherwise; `introspection.d.ts` in cwd
  with no config). `--json` writes the raw data instead of a `.d.ts`. `--name <TypeName>` adds
  an alias export for projects with several snapshots.
- An unchanged file is not rewritten: `unchanged: <path>` instead of `wrote: <path>`, so a clean
  `git status` after `introspect` is the pass condition.
- `introspect` warns to stderr about tools with external `$ref`s (types may be incomplete) and
  tools without `outputSchema` (`structuredContent` is `unknown`). `--verbose` lists them.

## Rejected on purpose

- `--out` with a config and more than one server selected. Give each server an `output`, or
  pass one alias.
- `--json` aimed at a `.d.ts` path, or a `.d.ts` snapshot aimed at `.json`.
- Two servers sharing an `output` (a `doctor` `fail`).

## From a script

```ts
import { check, introspect, loadConfig } from "mcp-tada/cli";

const target = { command: "node", args: ["server.js"], timeoutMs: 5000 };
await introspect({ target, out: "src/introspection.d.ts" });          // { data, text, wrote }
const { report, text } = await check({ target, against: "src/introspection.d.ts" });
if (!report.identical) throw new Error(text);
```

The subpath exposes what the CLI runs minus argv parsing: `init`, `doctor`, `introspect`,
`check`, `loadConfig`, and the building blocks (`connectClient`, `introspectTarget`,
`diffIntrospection`, `formatReport`, `compareSchemas`, `parseDtsSnapshot`, ...). Unlike the CLI,
no default timeout is applied unless `timeoutMs` is set. Exit codes are yours to decide.
`report.changes` is the flat list of differences, each with `severity` and `reasons`, worst first.
