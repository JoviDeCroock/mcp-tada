// The type-level mapper against real schemas: a snapshot generated from each live server must
// compile with every derived type fully evaluated, and must do so in a bounded number of type
// instantiations. The bound is far above what any surveyed server needs and far below the
// millions an off-the-shelf mapper was measured at, so it catches a blow-up, not a drift.
import { introspect } from "mcp-tada/cli";
import { describe, expect, it } from "vitest";
import { compileSnapshot, configuredServers } from "./helpers.js";

const MAX_INSTANTIATIONS = 400_000;

describe.each(configuredServers())("$alias", ({ alias, target }) => {
  it("compiles the live snapshot with all derived types evaluated", async () => {
    const { text } = await introspect({ target, write: false });
    const { diagnostics, instantiations } = await compileSnapshot(alias, text);
    expect(diagnostics).toBe("");
    expect(instantiations).toBeGreaterThan(0);
    expect(instantiations).toBeLessThan(MAX_INSTANTIATIONS);
  });
});
