// The snapshot contract against real servers: what `introspect` writes for a live server parses
// back to the same data, and the committed snapshots still match what the servers serve today.
// A failure in the second block is a real server changing its contract; regenerate with
// `pnpm --filter @mcp-tada/e2e introspect` and review the diff.
import { check, introspect, parseDtsSnapshot, SDK_ENV } from "mcp-tada/cli";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { configuredServers } from "./helpers.js";

const servers = configuredServers();

describe.each(servers)("$alias", ({ alias, target, output }) => {
  it("introspects live and round-trips through the .d.ts format", async () => {
    const result = await introspect({ target, write: false });
    expect(Object.keys(result.data.tools).length).toBeGreaterThan(0);
    expect(parseDtsSnapshot(result.text)).toEqual(result.data);

    // Every tool is a strict JSON object with an inputSchema; every prompt has an argument list.
    for (const tool of Object.values(result.data.tools)) {
      expect(tool.inputSchema).toBeTypeOf("object");
    }
    for (const prompt of Object.values(result.data.prompts ?? {})) {
      expect(Array.isArray(prompt.arguments)).toBe(true);
    }
  });

  it(`still matches the committed snapshot (${alias})`, async () => {
    const { report, text } = await check({ target, against: output });
    expect(text, text).toContain("no differences");
    expect(report.identical).toBe(true);
  });
});

// The stdio servers again through the v1 SDK, which the CLI falls back to when only
// `@modelcontextprotocol/sdk` is installed: the snapshot it produces must be the committed one.
describe.each(servers.filter((s) => s.target.command !== undefined))(
  "$alias through the v1 SDK",
  ({ target, output }) => {
    beforeAll(() => vi.stubEnv(SDK_ENV, "v1"));
    afterAll(() => vi.unstubAllEnvs());

    it("still matches the committed snapshot", async () => {
      const { report, text } = await check({ target, against: output });
      expect(text, text).toContain("no differences");
      expect(report.identical).toBe(true);
    });
  },
);
