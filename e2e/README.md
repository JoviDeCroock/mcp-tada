# e2e

End-to-end tests against real MCP servers: two published stdio servers spawned with `npx -y`
(`@modelcontextprotocol/server-filesystem`, `@modelcontextprotocol/server-memory`) and three
public Streamable HTTP servers (DeepWiki, Cloudflare docs, Context7). They need the network, so
they are not part of `pnpm run verify`; CI runs them on every pull request and nightly.

```sh
pnpm test:e2e                          # from the repo root
pnpm --filter @mcp-tada/e2e introspect # regenerate the committed snapshots after a server changes
```

What is covered, per server in `mcp-tada.config.json`:

- `test/snapshots.e2e.ts`: a live `introspect` round-trips through the `.d.ts` format, and `check`
  reports no drift against the committed snapshot in `snapshots/`. A failure here means the server
  changed its contract; regenerate and review the diff.
- `test/compile.e2e.ts`: the live snapshot compiles with every derived type (`ToolArgs`,
  `ToolOutput`, `PromptArgs`, the `readOnly` view) forced through declaration emit, in a bounded
  number of type instantiations.
- `test/stdio.e2e.ts` and `test/remote.e2e.ts`: typed calls against the running servers, with each
  `structuredContent` validated against the server's own `outputSchema` using the same validator
  `mcp-tada-server` runs on the wire, plus `readOnly` list filtering, a real prompt through
  `getPrompt`, and three servers behind `combineMcpTada`.
- `test/types.e2e-d.ts`: type assertions over the committed snapshots, no network.
