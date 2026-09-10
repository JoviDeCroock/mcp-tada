import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import * as cli from "../src/cli/index.js";

describe("mcp-tada/cli entry", () => {
  it("exposes the introspect and check surface", () => {
    expect(typeof cli.introspect).toBe("function");
    expect(typeof cli.introspectTarget).toBe("function");
    expect(typeof cli.check).toBe("function");
    expect(typeof cli.diffIntrospection).toBe("function");
    expect(typeof cli.formatReport).toBe("function");
    expect(typeof cli.connectClient).toBe("function");
    expect(typeof cli.loadConfig).toBe("function");
    expect(typeof cli.formatDts).toBe("function");
    expect(typeof cli.formatJson).toBe("function");
    expect(typeof cli.parseSnapshotText).toBe("function");
    expect(typeof cli.detectFormat).toBe("function");
    expect(cli.DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it("is published as the ./cli subpath of the package", () => {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as {
      exports: Record<string, { types: string; import: string }>;
    };
    expect(pkg.exports["./cli"]).toEqual({
      types: "./dist/cli/index.d.ts",
      import: "./dist/cli/index.js",
    });
  });

  it("does not pull the CLI's argv handling into the entry", () => {
    expect("runIntrospectWith" in cli).toBe(false);
    expect("runCheckWith" in cli).toBe(false);
  });
});
