# code-mode example

An LLM that programs against an MCP server instead of calling one tool at a time. The model gets a single `run_code` tool and a TypeScript declaration of the API; it writes a program that calls several tools, joins the results in a sandbox, and returns only what it needs. Fewer round trips, fewer tokens spent echoing tool results through the conversation.

mcp-tada supplies both halves with nothing extra to write:

- the `deepwiki.introspection.d.ts` snapshot from `mcp-tada introspect` is the API declaration the model reads;
- `mcp.tools.<name>(args)` from the typed client is the API the generated program calls.

```sh
pnpm introspect   # refresh src/deepwiki.introspection.d.ts from the live server
pnpm check        # exit 1 if DeepWiki changed a tool or schema
pnpm start        # needs ANTHROPIC_API_KEY or an `ant auth login` profile
```

The sandbox is `node:vm` with only `mcp.tools` and a capturing `console` in scope. That isolates scope, not privileges: for untrusted models or multi-tenant use, run the program in a real sandbox such as isolated-vm, a worker, or a container.
