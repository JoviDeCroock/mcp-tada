# combined example

Three public servers behind one typed client with `combineMcpTada`. Shows prefixed tool names, a flat `listTools()` for an LLM, typed output from Cloudflare's documentation search, untyped content from Context7 (no `outputSchema`), and routing a prefixed name back to its server with `split`.

```sh
pnpm introspect   # refresh the three snapshots in src/
pnpm check        # exit 1 if any of the servers drifted
pnpm start
```
