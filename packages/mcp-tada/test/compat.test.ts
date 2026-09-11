// The severity classification `mcp-tada check --fail-on` decides on. All of it is pure data, so
// these run without a server.
import { describe, expect, it } from "vitest";
import { compareSchemas, worstOf } from "../src/cli/compat.js";
import { diffIntrospection, formatReport } from "../src/cli/check.js";
import type { IntrospectionData } from "../src/cli/snapshot.js";

/** The worst `compareSchemas` verdict for a pair that must differ. */
function verdict(before: unknown, after: unknown, direction: "input" | "output"): string {
  const changes = compareSchemas(before, after, direction);
  expect(changes.length, JSON.stringify(changes)).toBeGreaterThan(0);
  return worstOf(changes);
}

const OBJ = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

describe("compareSchemas: input schemas are contravariant", () => {
  const base = OBJ({ a: { type: "string" }, b: { type: "number" } }, ["a"]);

  it("reports nothing when only documentation changed", () => {
    const after = OBJ({ a: { type: "string", description: "the a" }, b: { type: "number" } }, [
      "a",
    ]);
    expect(compareSchemas(base, after, "input")).toEqual([]);
  });

  it("treats a newly required property as breaking", () => {
    const changes = compareSchemas(base, OBJ(base.properties, ["a", "b"]), "input");
    expect(changes).toEqual([{ path: ".b", severity: "breaking", message: "is now required" }]);
  });

  it("treats a relaxed requirement as additive", () => {
    expect(verdict(base, OBJ(base.properties, []), "input")).toBe("additive");
  });

  it("treats a new optional property as additive, and a removed one as breaking", () => {
    const withC = OBJ({ ...base.properties, c: { type: "boolean" } }, ["a"]);
    expect(verdict(base, withC, "input")).toBe("additive");
    expect(verdict(base, OBJ({ a: { type: "string" } }, ["a"]), "input")).toBe("breaking");
  });

  it("treats a narrowed type as breaking and a widened one as additive", () => {
    expect(
      verdict(base, OBJ({ ...base.properties, a: { type: ["string", "null"] } }, ["a"]), "input"),
    ).toBe("additive");
    expect(verdict(OBJ({ a: {} }), OBJ({ a: { type: "string" } }), "input")).toBe("breaking");
  });

  it("treats a shrunk enum as breaking and a grown one as additive", () => {
    const before = OBJ({ mode: { enum: ["fast", "slow"] } });
    expect(verdict(before, OBJ({ mode: { enum: ["fast"] } }), "input")).toBe("breaking");
    expect(verdict(before, OBJ({ mode: { enum: ["fast", "slow", "auto"] } }), "input")).toBe(
      "additive",
    );
    // Reordering the same values constrains nothing differently.
    expect(compareSchemas(before, OBJ({ mode: { enum: ["slow", "fast"] } }), "input")).toEqual([]);
  });

  it("treats a tightened bound as breaking and a loosened one as additive", () => {
    const before = OBJ({ n: { type: "number", minimum: 0, maximum: 10 } });
    expect(verdict(before, OBJ({ n: { type: "number", minimum: 1, maximum: 10 } }), "input")).toBe(
      "breaking",
    );
    expect(verdict(before, OBJ({ n: { type: "number", minimum: 0, maximum: 20 } }), "input")).toBe(
      "additive",
    );
    expect(verdict(before, OBJ({ n: { type: "number", minimum: 0 } }), "input")).toBe("additive");
    expect(
      verdict(
        OBJ({ s: { type: "string" } }),
        OBJ({ s: { type: "string", pattern: "^a" } }),
        "input",
      ),
    ).toBe("breaking");
  });

  it("follows nested objects and arrays", () => {
    const before = OBJ({ files: { type: "array", items: OBJ({ path: { type: "string" } }, []) } });
    const after = OBJ({
      files: { type: "array", items: OBJ({ path: { type: "string" } }, ["path"]) },
    });
    expect(compareSchemas(before, after, "input")).toEqual([
      { path: ".files[].path", severity: "breaking", message: "is now required" },
    ]);
  });

  it("treats closing an open object as breaking, and opening a closed one as additive", () => {
    const open = { ...OBJ({ a: { type: "string" } }), additionalProperties: true };
    const closed = { ...OBJ({ a: { type: "string" } }), additionalProperties: false };
    expect(verdict(open, closed, "input")).toBe("breaking");
    expect(verdict(closed, open, "input")).toBe("additive");
  });

  it("ignores a server spelling out a default it already had", () => {
    const before = OBJ({ a: { type: "string" } });
    const after = {
      ...OBJ({ a: { type: "string" } }),
      additionalProperties: true,
      uniqueItems: false,
    };
    expect(compareSchemas(before, after, "input")).toEqual([]);
    expect(compareSchemas(before, after, "output")).toEqual([]);
  });

  it("reports an unmodelled keyword as breaking rather than ignoring it", () => {
    expect(verdict(OBJ({}), { ...OBJ({}), unevaluatedProperties: false }, "input")).toBe(
      "breaking",
    );
    expect(verdict({ $ref: "#/$defs/a" }, { $ref: "#/$defs/b" }, "input")).toBe("breaking");
    // Whichever direction: not comparable is never waved through.
    expect(verdict(OBJ({}), { ...OBJ({}), unevaluatedProperties: false }, "output")).toBe(
      "breaking",
    );
  });

  it("classifies combinators by which way a branch moves the schema", () => {
    const base = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(verdict(base, { anyOf: [{ type: "string" }] }, "input")).toBe("breaking");
    expect(verdict(base, { anyOf: [...base.anyOf, { type: "null" }] }, "input")).toBe("additive");
    const all = { allOf: [{ minLength: 1 }] };
    expect(verdict(all, { allOf: [{ minLength: 1 }, { maxLength: 9 }] }, "input")).toBe("breaking");
    // A new `oneOf` branch that overlaps an old one rejects values that used to match once.
    const one = { oneOf: [{ type: "string" }] };
    expect(verdict(one, { oneOf: [{ type: "string" }, { enum: ["x"] }] }, "input")).toBe(
      "breaking",
    );
    expect(verdict(one, { oneOf: [{ type: "string" }, { enum: ["x"] }] }, "output")).toBe(
      "breaking",
    );
  });

  it("keeps direction for boolean sub-schemas and prefixItems", () => {
    const anyItems = { type: "array", items: true };
    const strItems = { type: "array", items: { type: "string" } };
    expect(verdict(anyItems, strItems, "input")).toBe("breaking");
    expect(verdict(anyItems, strItems, "output")).toBe("additive");
    expect(verdict(strItems, { type: "array", items: false }, "output")).toBe("additive");
    const tuple = { type: "array", prefixItems: [{ type: "string" }] };
    expect(verdict({ type: "array" }, tuple, "input")).toBe("breaking");
    expect(verdict({ type: "array" }, tuple, "output")).toBe("additive");
    expect(verdict(tuple, { type: "array", prefixItems: [{ type: "number" }] }, "output")).toBe(
      "breaking",
    );
  });

  it("walks items, additionalProperties schemas and definitions", () => {
    expect(
      compareSchemas(
        { type: "object", additionalProperties: { type: "string" } },
        { type: "object", additionalProperties: { type: ["string", "null"] } },
        "output",
      ),
    ).toEqual([{ path: "[key]", severity: "breaking", message: "type string -> null|string" }]);
    expect(
      compareSchemas(
        { $defs: { a: { type: "string" } }, $ref: "#/$defs/a" },
        { $defs: { a: { type: "string", minLength: 1 } }, $ref: "#/$defs/a" },
        "input",
      ),
    ).toEqual([{ path: "#a", severity: "breaking", message: "minLength added (1)" }]);
    expect(verdict({ type: "array" }, { type: "array", items: { type: "string" } }, "input")).toBe(
      "breaking",
    );
  });
});

describe("compareSchemas: output schemas are covariant", () => {
  const base = OBJ({ a: { type: "string" }, b: { type: "number" } }, ["a"]);

  it("inverts the requirement rules", () => {
    expect(verdict(base, OBJ(base.properties, ["a", "b"]), "output")).toBe("additive");
    expect(verdict(base, OBJ(base.properties, []), "output")).toBe("breaking");
  });

  it("inverts the type and enum rules", () => {
    expect(
      verdict(base, OBJ({ ...base.properties, a: { type: ["string", "null"] } }, ["a"]), "output"),
    ).toBe("breaking");
    const before = OBJ({ mode: { enum: ["fast", "slow"] } });
    expect(verdict(before, OBJ({ mode: { enum: ["fast"] } }), "output")).toBe("additive");
    expect(verdict(before, OBJ({ mode: { enum: ["fast", "slow", "auto"] } }), "output")).toBe(
      "breaking",
    );
  });

  it("still treats a removed property as breaking", () => {
    expect(verdict(base, OBJ({ a: { type: "string" } }, ["a"]), "output")).toBe("breaking");
    expect(
      verdict(base, OBJ({ ...base.properties, c: { type: "boolean" } }, ["a"]), "output"),
    ).toBe("additive");
  });
});

describe("diffIntrospection classification", () => {
  const snapshot: IntrospectionData = {
    tools: {
      keep: { inputSchema: OBJ({ a: { type: "string" } }, ["a"]) },
      tighten: { inputSchema: OBJ({ a: { type: "string" }, b: { type: "number" } }, ["a"]) },
      loosen: { inputSchema: OBJ({ a: { type: "string" } }, ["a"]) },
      gone: { inputSchema: OBJ({}) },
      safe: { inputSchema: OBJ({}), annotations: { readOnlyHint: true } },
      titled: { inputSchema: OBJ({}), annotations: { title: "Before", readOnlyHint: true } },
      structured: { inputSchema: OBJ({}), outputSchema: OBJ({ x: { type: "string" } }, ["x"]) },
    },
    prompts: {
      stable: { arguments: [{ name: "city", required: true }] },
      widened: { arguments: [{ name: "city", required: true }] },
      narrowed: { arguments: [{ name: "city", required: false }] },
      retired: { arguments: [] },
    },
  };

  const live: IntrospectionData = {
    tools: {
      keep: { inputSchema: OBJ({ a: { type: "string" } }, ["a"]) },
      tighten: { inputSchema: OBJ({ a: { type: "string" }, b: { type: "number" } }, ["a", "b"]) },
      loosen: { inputSchema: OBJ({ a: { type: "string" }, c: { type: "string" } }, []) },
      fresh: { inputSchema: OBJ({}) },
      safe: { inputSchema: OBJ({}), annotations: { readOnlyHint: false } },
      titled: { inputSchema: OBJ({}), annotations: { title: "After", readOnlyHint: true } },
      structured: {
        inputSchema: OBJ({}),
        outputSchema: OBJ({ x: { type: "string" }, y: { type: "string" } }, ["x"]),
      },
    },
    prompts: {
      stable: { arguments: [{ name: "city", required: true }] },
      widened: { arguments: [{ name: "city", required: false }] },
      narrowed: { arguments: [{ name: "city", required: true }] },
      added: { arguments: [] },
    },
  };

  const report = diffIntrospection(snapshot, live);

  function kindOf(subject: string) {
    return report.changes.find((c) => c.subject === subject);
  }

  it("flags the report as breaking and keeps the per-category lists", () => {
    expect(report.identical).toBe(false);
    expect(report.severity).toBe("breaking");
    expect(report.added).toEqual(["fresh"]);
    expect(report.removed).toEqual(["gone"]);
    expect(report.inputChanged).toEqual(["loosen", "tighten"]);
    expect(report.safetyWeakened).toEqual(["safe"]);
    expect(report.annotationsChanged).toEqual(["safe", "titled"]);
    expect(report.outputChanged).toEqual(["structured"]);
    expect(report.promptsChanged).toEqual(["narrowed", "widened"]);
  });

  it("splits tool changes by whether they can break a caller", () => {
    expect(kindOf("fresh")).toMatchObject({ kind: "toolAdded", severity: "additive" });
    expect(kindOf("gone")).toMatchObject({ kind: "toolRemoved", severity: "breaking" });
    expect(kindOf("tighten")).toMatchObject({
      kind: "inputSchema",
      severity: "breaking",
      reasons: [".b: is now required"],
    });
    expect(kindOf("loosen")).toMatchObject({ kind: "inputSchema", severity: "additive" });
    expect(kindOf("structured")).toMatchObject({ kind: "outputSchema", severity: "additive" });
  });

  it("rates a lost safety hint dangerous, not breaking, and other annotation drift additive", () => {
    expect(kindOf("safe")).toMatchObject({
      kind: "annotations",
      severity: "dangerous",
      summary: "lost a safety guarantee",
      reasons: ["readOnlyHint is no longer true"],
    });
    expect(kindOf("titled")).toMatchObject({ kind: "annotations", severity: "additive" });
    const hints = diffIntrospection(
      {
        tools: {
          t: {
            inputSchema: OBJ({}),
            annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
          },
        },
      },
      { tools: { t: { inputSchema: OBJ({}), annotations: {} } } },
    );
    expect(hints.severity).toBe("dangerous");
    expect(hints.changes[0]?.reasons).toEqual([
      "destructiveHint is no longer false",
      "idempotentHint is no longer true",
      "openWorldHint is no longer false",
    ]);
  });

  it("splits prompt changes by whether a caller's arguments still fit", () => {
    expect(kindOf("added")).toMatchObject({ kind: "promptAdded", severity: "additive" });
    expect(kindOf("retired")).toMatchObject({ kind: "promptRemoved", severity: "breaking" });
    expect(kindOf("widened")).toMatchObject({
      kind: "promptArguments",
      severity: "additive",
      reasons: ["city: is no longer required"],
    });
    expect(kindOf("narrowed")).toMatchObject({ kind: "promptArguments", severity: "breaking" });
    expect(kindOf("stable")).toBeUndefined();
  });

  it("orders worst first and counts each severity in the header", () => {
    const text = formatReport(report, "snap.d.ts");
    expect(text).toContain("differences from snap.d.ts (4 breaking, 1 dangerous, 6 additive)");
    expect(text.indexOf("  breaking:")).toBeLessThan(text.indexOf("  dangerous:"));
    expect(text.indexOf("  dangerous:")).toBeLessThan(text.indexOf("  additive:"));
    expect(text).toContain("    tighten: inputSchema changed");
    expect(text).toContain("      .b: is now required");
    expect(text).toContain("    safe: lost a safety guarantee");
    const breakingSection = text.slice(text.indexOf("  breaking:"), text.indexOf("  dangerous:"));
    expect(breakingSection).not.toContain("fresh: added tool");
    expect(breakingSection).not.toContain("safe:");
  });

  it("reports a documentation-only schema edit as an additive change", () => {
    const before: IntrospectionData = { tools: { a: { inputSchema: OBJ({}) } } };
    const after: IntrospectionData = {
      tools: { a: { inputSchema: { ...OBJ({}), description: "now documented" } } },
    };
    const docs = diffIntrospection(before, after);
    expect(docs.identical).toBe(false);
    expect(docs.severity).toBe("additive");
    expect(docs.changes[0]).toMatchObject({
      severity: "additive",
      reasons: ["documentation or ordering only"],
    });
  });

  it("has no changes and no breaking flag for identical data", () => {
    const same = diffIntrospection(snapshot, snapshot);
    expect(same.identical).toBe(true);
    expect(same.severity).toBe("additive");
    expect(same.changes).toEqual([]);
    expect(formatReport(same, "snap.d.ts")).toBe("mcp-tada check: no differences from snap.d.ts\n");
  });
});
