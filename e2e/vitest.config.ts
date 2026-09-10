import { defineConfig } from "vitest/config";
// Every test here talks to a real MCP server over the network or through `npx -y`, so the
// timeouts are generous and the suite is kept out of `pnpm run verify`; run it with `pnpm test:e2e`.
export default defineConfig({
  test: {
    include: ["test/**/*.e2e.ts"],
    typecheck: { enabled: true, include: ["test/**/*.e2e-d.ts"], tsconfig: "./tsconfig.json" },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
