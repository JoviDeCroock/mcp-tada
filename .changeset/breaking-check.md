---
"mcp-tada": minor
---

`mcp-tada check` now rates every difference as additive, dangerous (a tool withdrew a safety hint
such as `readOnlyHint`), or breaking, groups the report by severity, and takes
`--fail-on <any|dangerous|breaking>` to choose which of those exits 1. A schema difference is
judged by direction: tightening an `inputSchema` or loosening an `outputSchema` breaks callers,
the reverse is additive. `report.severity` and `report.changes` expose the same classification
to the programmatic API, and `compareSchemas` is exported for diffing two schemas on their own.
