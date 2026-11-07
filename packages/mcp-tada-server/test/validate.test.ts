import { describe, expect, it } from "vitest";
import { validate } from "../src/validate.js";

describe("validate", () => {
  it("type: string", () => {
    expect(validate({ type: "string" }, "hi")).toEqual([]);
    expect(validate({ type: "string" }, 1)).toHaveLength(1);
  });

  it("type: array of types", () => {
    expect(validate({ type: ["string", "number"] }, "hi")).toEqual([]);
    expect(validate({ type: ["string", "number"] }, 1)).toEqual([]);
    expect(validate({ type: ["string", "number"] }, true)).toHaveLength(1);
  });

  it("integer vs number", () => {
    expect(validate({ type: "integer" }, 1)).toEqual([]);
    expect(validate({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(validate({ type: "number" }, 1.5)).toEqual([]);
  });

  it("const", () => {
    expect(validate({ const: "fixed" }, "fixed")).toEqual([]);
    expect(validate({ const: "fixed" }, "other")).toHaveLength(1);
    expect(validate({ const: { a: 1 } }, { a: 1 })).toEqual([]);
  });

  it("enum", () => {
    expect(validate({ enum: ["a", "b"] }, "a")).toEqual([]);
    expect(validate({ enum: ["a", "b"] }, "c")).toHaveLength(1);
  });

  it("required", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    expect(validate(schema, { a: "x" })).toEqual([]);
    expect(validate(schema, {})).toEqual([{ path: "a", message: "required property is missing" }]);
  });

  it("properties", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(validate(schema, { a: "x" })).toEqual([]);
    expect(validate(schema, { a: 1 })).toHaveLength(1);
  });

  it("additionalProperties: false", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    };
    expect(validate(schema, { a: "x" })).toEqual([]);
    expect(validate(schema, { a: "x", b: 1 })).toHaveLength(1);
  });

  it("additionalProperties: schema", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: { type: "number" },
    };
    expect(validate(schema, { a: "x", b: 1 })).toEqual([]);
    expect(validate(schema, { a: "x", b: "not a number" })).toHaveLength(1);
  });

  it("items", () => {
    const schema = { type: "array", items: { type: "number" } };
    expect(validate(schema, [1, 2, 3])).toEqual([]);
    expect(validate(schema, [1, "x", 3])).toHaveLength(1);
  });

  it("prefixItems", () => {
    const schema = { type: "array", prefixItems: [{ type: "string" }, { type: "number" }] };
    expect(validate(schema, ["a", 1])).toEqual([]);
    expect(validate(schema, ["a", "b"])).toHaveLength(1);
  });

  it("anyOf", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(validate(schema, "a")).toEqual([]);
    expect(validate(schema, 1)).toEqual([]);
    expect(validate(schema, true).length).toBeGreaterThan(0);
  });

  it("oneOf: exactly one match required", () => {
    // A value matching zero or multiple branches is invalid.
    const schemaZero = { oneOf: [{ const: "a" }, { const: "b" }] };
    expect(validate(schemaZero, "c").length).toBeGreaterThan(0);

    const schemaMultiple = { oneOf: [{ type: "string" }, { type: "string" }] };
    expect(validate(schemaMultiple, "x")).toHaveLength(1);

    const schemaOne = { oneOf: [{ type: "string" }, { type: "number" }] };
    expect(validate(schemaOne, "x")).toEqual([]);
  });

  it("allOf", () => {
    const schema = {
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
      ],
    };
    expect(validate(schema, { a: "x", b: 1 })).toEqual([]);
    expect(validate(schema, { a: "x" })).toHaveLength(1);
  });

  it("nullable", () => {
    expect(validate({ type: "string", nullable: true }, null)).toEqual([]);
    expect(validate({ type: "string" }, null)).toHaveLength(1);
  });

  it("$ref to #/$defs", () => {
    const schema = {
      $defs: { Name: { type: "string" } },
      type: "object",
      properties: { name: { $ref: "#/$defs/Name" } },
      required: ["name"],
    };
    expect(validate(schema, { name: "hi" })).toEqual([]);
    expect(validate(schema, { name: 1 })).toHaveLength(1);
  });

  it("$ref to #/definitions", () => {
    const schema = {
      definitions: { Name: { type: "string" } },
      type: "object",
      properties: { name: { $ref: "#/definitions/Name" } },
    };
    expect(validate(schema, { name: "hi" })).toEqual([]);
    expect(validate(schema, { name: 1 })).toHaveLength(1);
  });

  it("$ref recursion cap does not blow the stack on a self-referencing schema", () => {
    const schema = {
      $defs: {
        Node: {
          type: "object",
          properties: { next: { $ref: "#/$defs/Node" } },
        },
      },
      $ref: "#/$defs/Node",
    };
    expect(() => validate(schema, { next: { next: { next: {} } } })).not.toThrow();
  });

  it("properties without type only constrains object values, per JSON Schema", () => {
    const schema = { properties: { a: { type: "string" } }, required: ["a"] };
    expect(validate(schema, { a: "x" })).toEqual([]);
    expect(validate(schema, "not an object")).toEqual([]);
    expect(validate(schema, {})).toHaveLength(1);
  });

  it("unknown keywords are ignored", () => {
    const schema = { type: "string", format: "email", "x-custom": true };
    expect(validate(schema, "anything")).toEqual([]);
  });

  it("reports a nested path for a deeply nested error", () => {
    const schema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            addresses: {
              type: "array",
              items: {
                type: "object",
                properties: { zip: { type: "string" } },
                required: ["zip"],
              },
            },
          },
        },
      },
    };
    const errors = validate(schema, { user: { addresses: [{ zip: 12345 }] } });
    expect(errors).toEqual([{ path: "user.addresses.0.zip", message: expect.any(String) }]);
  });
});

describe("JSON Schema 2020-12 validation", () => {
  it.each([
    [{ type: "integer", minimum: 1 }, -1, false],
    [{ type: "string", minLength: 2, pattern: "^a" }, "b", false],
    [
      {
        type: "object",
        patternProperties: { "^x-": { type: "number" } },
        additionalProperties: false,
      },
      { "x-size": 1 },
      true,
    ],
    [
      {
        type: "object",
        patternProperties: { "^x-": { type: "number" } },
        additionalProperties: false,
      },
      { "x-size": "bad" },
      false,
    ],
    [
      {
        type: "object",
        properties: { mode: {}, token: {} },
        if: { properties: { mode: { const: "auth" } }, required: ["mode"] },
        // oxlint-disable-next-line unicorn/no-thenable -- JSON Schema conditional keyword.
        then: { required: ["token"] },
      },
      { mode: "auth" },
      false,
    ],
    [{ type: "object", dependentRequired: { a: ["b"] } }, { a: 1 }, false],
    [
      {
        type: "object",
        allOf: [{ properties: { a: { type: "number" } } }],
        unevaluatedProperties: false,
      },
      { a: 1 },
      true,
    ],
    [
      {
        type: "object",
        allOf: [{ properties: { a: { type: "number" } } }],
        unevaluatedProperties: false,
      },
      { a: 1, b: 2 },
      false,
    ],
    [{ type: "array", contains: { type: "number" }, minContains: 2 }, [1, "x"], false],
    [{ type: ["string", "null"] }, null, true],
    [{ $defs: { "a/b": { type: "number" } }, $ref: "#/$defs/a~1b" }, "bad", false],
    [
      {
        definitions: { name: { type: "number" } },
        $defs: { name: { type: "string" } },
        $ref: "#/definitions/name",
      },
      "bad",
      false,
    ],
  ])("validates %j against %j", (schema, value, valid) => {
    expect(validate(schema, value).length === 0).toBe(valid);
  });

  it.each([
    { $ref: "https://example.invalid/schema.json" },
    { $ref: "#/$defs/missing" },
    { $schema: "https://example.invalid/dialect" },
    { type: "not-a-json-type" },
    { $async: true, type: "string" },
  ])("rejects an invalid or unsupported schema without fetching: %j", (schema) => {
    expect(validate(schema, "anything")[0]?.message).toMatch(/Validation failed/);
  });

  it("supports explicit draft-07 tuples", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "string" }],
      additionalItems: false,
    };
    expect(validate(schema, ["ok"])).toEqual([]);
    expect(validate(schema, ["ok", 1]).length).toBeGreaterThan(0);
  });

  it("resolves a subschema against its supplied root", () => {
    const schema = { $ref: "#/$defs/number" };
    const root = { $defs: { number: { type: "number" }, target: schema } };
    expect(validate(schema, 1, root)).toEqual([]);
    expect(validate(schema, "bad", root).length).toBeGreaterThan(0);
  });

  it("does not coerce values, insert defaults or delete extra properties", () => {
    const value = { a: "1", extra: true };
    validate(
      {
        type: "object",
        properties: { a: { type: "integer" }, b: { default: 2 } },
        additionalProperties: false,
      },
      value,
    );
    expect(value).toEqual({ a: "1", extra: true });
  });

  it("bounds schema and value nesting and rejects cycles", () => {
    let schema: unknown = { type: "number" };
    let value: unknown = 1;
    for (let i = 0; i < 70; i++) {
      schema = { allOf: [schema] };
      value = { child: value };
    }
    expect(validate(schema, 1)[0]?.message).toMatch(/limits/);
    expect(validate({}, value)[0]?.message).toMatch(/limits/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(validate(cycle, 1)[0]?.message).toMatch(/limits/);
  });

  it("does not reuse validators for a changed schema", () => {
    const schema = { type: "number", minimum: 0 };
    expect(validate(schema, 1)).toEqual([]);
    schema.minimum = 2;
    expect(validate(schema, 1).length).toBeGreaterThan(0);
  });
});
