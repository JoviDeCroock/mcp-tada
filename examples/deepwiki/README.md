# deepwiki example

Typed client against a public server nobody in this repo controls. DeepWiki declares an `outputSchema` on all three tools, so this is the best case for typed outputs.

```sh
pnpm introspect   # refresh src/deepwiki.introspection.d.ts from the live server
pnpm check        # exit 1 if DeepWiki changed a tool or schema
pnpm start        # ask DeepWiki about gql.tada
```
