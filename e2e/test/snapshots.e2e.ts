// The snapshot contract against real servers: what `introspect` writes for a live server parses
// back to the same data, and the committed snapshots still match what the servers serve today.
// A failure in the second block is a real server changing its contract; regenerate with
// `pnpm --filter @mcp-tada/e2e introspect` and review the diff.
import { check, introspect, parseDtsSnapshot } from "mcp-tada/cli";
import { describe, expect, it } from "vitest";
import { configuredServers } from "./helpers.js";

describe.each(configuredServers())("$alias", ({ alias, target, output }) => {
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
