---
name: mcp-tada-type-mapper
description: Understand or debug the TypeScript types mcp-tada derives from a JSON Schema - why an argument is required or closed, why structuredContent is open or unknown, which keywords are unsupported. Use when an inferred tool argument or result type looks wrong, or when deciding whether a schema shape will type well.
---

# How mcp-tada maps JSON Schema to types

`FromSchema` (arguments) and `FromOutputSchema` (`structuredContent`) share one small
type-level mapper covering the subset seen in real tool schemas, draft-07 and 2020-12. There is
no runtime and no schema library; the snapshot is the only input. Most "the type is wrong"
reports are one of the decisions below working as intended.

## Input and output are not symmetric

- **Arguments are closed by default.** An object with no `additionalProperties` accepts only its
  declared `properties`, so a typo in an argument name is a compile error.
- **Results are open by default.** The same object in `structuredContent` gains
  `& { [k: string]: unknown }`, because the server may send fields it did not declare. Reading
  an undeclared key gives `unknown`, not an error.
- `additionalProperties: false` closes the object in both modes. A schema-valued
  `additionalProperties` becomes an index signature. No `properties` and no restriction is
  `{ [k: string]: unknown }`.
- A tool with no `outputSchema` has `structuredContent: unknown` on success. Narrow on
  `result.isError` first; on an error result it is optional `unknown` either way.

## Supported shapes

- `type` as an array (`["string", "null"]`) is the union of each member.
- `properties` with no `type` is still an object (common in the wild).
- `enum`, `const`, `nullable`, `anyOf`, `oneOf`, `allOf`, `items`, `prefixItems` (tuple),
  `required`, `$ref` to `#/$defs/...` or `#/definitions/...` on the same schema.
- `$ref` resolution stops after 8 levels and yields `unknown`. External `$ref` URIs are
  `unknown`; `introspect` warns about them.
- Descriptions inside the schema are not visible on hover; only the tool's own
  description and `@param` tags in the snapshot's JSDoc are, and only through `mcp.tools.<name>`.

Not supported, deliberately: `patternProperties`, `if` / `then` / `else`, `$ref` cycles deeper
than eight hops. These map to `unknown` or are ignored. If you author the server, prefer a
shape the mapper handles.

## Naming the types

```ts
import type { ToolArgs, ToolOutput, ToolResult, ToolNames, ReadOnlyToolNames } from "mcp-tada";
import type { introspection } from "./fs.introspection.js";

type ReadArgs = ToolArgs<introspection, "read_file">;
type ReadOutput = ToolOutput<introspection, "read_file">; // success-case structuredContent
```

`PromptNames` / `PromptArgs`, `NonDestructiveToolNames`, `ToolAnnotationsOf`, and
`PickTools<I, Names>` (narrow a snapshot to some tools) exist for the same purpose.
