import { describe, expectTypeOf, test } from "vitest";
import type { FromSchema } from "../src/schema.js";

describe("FromSchema", () => {
  test("primitive types", () => {
    expectTypeOf<FromSchema<{ type: "string" }>>().toEqualTypeOf<string>();
    expectTypeOf<FromSchema<{ type: "number" }>>().toEqualTypeOf<number>();
    expectTypeOf<FromSchema<{ type: "integer" }>>().toEqualTypeOf<number>();
    expectTypeOf<FromSchema<{ type: "boolean" }>>().toEqualTypeOf<boolean>();
    expectTypeOf<FromSchema<{ type: "null" }>>().toEqualTypeOf<null>();

    // @ts-expect-error number is not string
    expectTypeOf<FromSchema<{ type: "string" }>>().toEqualTypeOf<number>();
  });

  test("type as an array of primitives", () => {
    expectTypeOf<FromSchema<{ type: ["string", "null"] }>>().toEqualTypeOf<string | null>();

    // @ts-expect-error missing null branch
    expectTypeOf<FromSchema<{ type: ["string", "null"] }>>().toEqualTypeOf<string>();
  });

  test("const", () => {
    expectTypeOf<FromSchema<{ const: "fixed" }>>().toEqualTypeOf<"fixed">();

    // @ts-expect-error wrong literal
    expectTypeOf<FromSchema<{ const: "fixed" }>>().toEqualTypeOf<"other">();
  });

  test("enum", () => {
    expectTypeOf<FromSchema<{ enum: ["a", "b", "c"] }>>().toEqualTypeOf<"a" | "b" | "c">();

    // @ts-expect-error missing a member
    expectTypeOf<FromSchema<{ enum: ["a", "b", "c"] }>>().toEqualTypeOf<"a" | "b">();
  });

  test("anyOf / oneOf unions", () => {
    type AnyOf = FromSchema<{ anyOf: [{ type: "string" }, { type: "number" }] }>;
    expectTypeOf<AnyOf>().toEqualTypeOf<string | number>();

    type OneOf = FromSchema<{ oneOf: [{ type: "string" }, { type: "boolean" }] }>;
    expectTypeOf<OneOf>().toEqualTypeOf<string | boolean>();

    // @ts-expect-error missing boolean member
    expectTypeOf<OneOf>().toEqualTypeOf<string>();
  });

  test("allOf intersection", () => {
    type S = {
      allOf: [
        { type: "object"; properties: { a: { type: "string" } }; required: ["a"] },
        { type: "object"; properties: { b: { type: "number" } }; required: ["b"] },
      ];
    };
    type AllOf = FromSchema<S>;
    expectTypeOf<AllOf>().toEqualTypeOf<{ a: string; b: number }>();

    // @ts-expect-error missing required member b
    expectTypeOf<AllOf>().toEqualTypeOf<{ a: string }>();
  });

  test("object with required and optional properties", () => {
    type S = {
      type: "object";
      properties: { a: { type: "string" }; b: { type: "number" } };
      required: ["a"];
    };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<{ a: string; b?: number }>();

    // @ts-expect-error b must stay optional, not required
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<{ a: string; b: number }>();
  });

  test("additionalProperties: false closes the object", () => {
    type S = {
      type: "object";
      properties: { a: { type: "string" } };
      required: ["a"];
      additionalProperties: false;
    };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<{ a: string }>();

    const value: FromSchema<S> = { a: "hi" };
    // @ts-expect-error object is closed, no stray properties allowed
    const bad: FromSchema<S> = { a: "hi", extra: 1 };
    void value;
    void bad;
  });

  test("additionalProperties: <schema> adds an index signature", () => {
    type S = {
      type: "object";
      properties: { a: { type: "string" } };
      required: ["a"];
      additionalProperties: { type: "number" };
    };
    type R = FromSchema<S>;
    const value = null as unknown as R;
    expectTypeOf(value.a).toEqualTypeOf<string>();
    expectTypeOf(value["extra"]).toEqualTypeOf<number | undefined>();

    // @ts-expect-error additional values are number, not string
    expectTypeOf(value["extra"]).toEqualTypeOf<string | undefined>();
  });

  test("object with no properties stays open by default", () => {
    type S = { type: "object" };
    type R = FromSchema<S>;
    const value: R = { anything: 1 };
    expectTypeOf(value.anything).toEqualTypeOf<unknown>();
  });

  test("array with items", () => {
    type S = { type: "array"; items: { type: "string" } };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<string[]>();

    // @ts-expect-error number[] is wrong element type
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<number[]>();
  });

  test("array with prefixItems becomes a tuple", () => {
    type S = { type: "array"; prefixItems: [{ type: "string" }, { type: "number" }] };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<[string, number]>();

    // @ts-expect-error tuple order matters
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<[number, string]>();
  });

  test("array with items: false becomes an empty tuple", () => {
    type S = { type: "array"; items: false };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<[]>();
  });

  test("$ref resolves against #/$defs", () => {
    type Root = {
      $ref: "#/$defs/Point";
      $defs: { Point: { type: "object"; properties: { x: { type: "number" } }; required: ["x"] } };
    };
    expectTypeOf<FromSchema<Root>>().toEqualTypeOf<{ x: number }>();

    // @ts-expect-error wrong shape
    expectTypeOf<FromSchema<Root>>().toEqualTypeOf<{ x: string }>();
  });

  test("$ref resolves against #/definitions (draft-07)", () => {
    type Root = {
      $ref: "#/definitions/Point";
      definitions: {
        Point: { type: "object"; properties: { y: { type: "number" } }; required: ["y"] };
      };
    };
    expectTypeOf<FromSchema<Root>>().toEqualTypeOf<{ y: number }>();
  });

  test("recursive $ref is capped and falls back to unknown", () => {
    type Root = {
      $ref: "#/$defs/Node";
      $defs: {
        Node: {
          type: "object";
          properties: { value: { type: "number" }; next: { $ref: "#/$defs/Node" } };
          required: ["value"];
        };
      };
    };
    // Should not blow up the compiler; deep-enough levels collapse to unknown.
    type R = FromSchema<Root>;
    expectTypeOf<R["value"]>().toEqualTypeOf<number>();
  });

  test("nullable: true adds null", () => {
    type S = { anyOf: [{ type: "string" }]; nullable: true };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<string | null>();
  });

  test("default without required keeps property optional", () => {
    type S = {
      type: "object";
      properties: { count: { type: "number"; default: 3 } };
    };
    expectTypeOf<FromSchema<S>>().toEqualTypeOf<{ count?: number }>();
  });

  test("unknown/empty schema", () => {
    expectTypeOf<FromSchema<Record<string, never>>>().toEqualTypeOf<unknown>();
    expectTypeOf<FromSchema<unknown>>().toEqualTypeOf<unknown>();
  });
});
