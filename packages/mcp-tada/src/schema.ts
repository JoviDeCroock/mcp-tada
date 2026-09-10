// Purpose-built type-level JSON Schema -> TS mapper.
// Deliberately not a general-purpose json-schema-to-ts replacement: it supports the subset
// that shows up in real tool schemas (draft-07 and 2020-12), and stays cheap in instantiations.
//
// Spec-mapping decisions:
// - `additionalProperties` default (i.e. absent) in **input** mode: the object stays closed to
//   its declared `properties` (no stray index signature). This favors clean hover output and
//   excess-property checking for arguments *you* construct, over strict spec fidelity ("true"
//   is the JSON Schema default, which would add `[k: string]: unknown`).
// - `additionalProperties` default (i.e. absent) in **output** mode: the object stays open,
//   gaining `& { [k: string]: unknown }`. A tool's `structuredContent` is a value *the server*
//   constructed; it may legitimately include fields the schema didn't declare, and closing the
//   type there would make reading an undeclared-but-present key a compile error instead of the
//   `unknown` it actually is. `additionalProperties: false` still closes the object in both
//   modes, since that is the server explicitly opting into a closed contract. Use `FromSchema`
//   for input schemas (arguments) and `FromOutputSchema` for output schemas
//   (`structuredContent`); both share the same recursive mapper via an internal mode parameter.
// - `additionalProperties: false` with no `properties` at all -> `Record<string, never>`-ish
//   empty object (closed).
// - No `properties` and no `additionalProperties` restriction -> `[k: string]: unknown` index
//   signature, since the object is genuinely open.
// - A schema with `properties` but no `type` at all is still treated as an object (seen in the
//   wild: 7 of 23 surveyed servers omit `type` around `properties`).
// - `type` as an array (e.g. `["object", "null"]`) maps to the union of each named type mapped
//   individually (so `["object", "null"]` is `ObjectType | null`, not just a nullable wrapper).
// - `$ref` is resolved against the root schema passed as the second type parameter. Recursion
//   is capped at 8 levels; beyond that we bail to `unknown` rather than blow up the compiler.

type Prim = {
  string: string;
  number: number;
  integer: number;
  boolean: boolean;
  null: null;
};

// "input": arguments you construct, closed by default (excess-property checked).
// "output": structuredContent the server constructed, open by default.
type Mode = "input" | "output";

// Collapse intersections into a single flat object for nicer hover output.
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Keys<T> = T extends readonly (infer K)[] ? K & string : never;

// Resolve a "#/$defs/Foo" or "#/definitions/Foo" ref against the root schema.
type ResolveRef<Ref, Root> = Ref extends `#/$defs/${infer Name}`
  ? Name extends keyof (Root extends { $defs: infer D } ? D : never)
    ? (Root extends { $defs: infer D } ? D : never)[Name]
    : unknown
  : Ref extends `#/definitions/${infer Name}`
    ? Name extends keyof (Root extends { definitions: infer D } ? D : never)
      ? (Root extends { definitions: infer D } ? D : never)[Name]
      : unknown
    : unknown;

// Split declared properties into required (non-optional) and optional buckets.
type ObjOf<P, R, Root, Depth extends number, M extends Mode> = {
  [K in keyof P as K extends R ? K : never]: FromSchemaAt<P[K], Root, Depth, M>;
} & {
  [K in keyof P as K extends R ? never : K]?: FromSchemaAt<P[K], Root, Depth, M>;
};

// additionalProperties handling:
// - `false` -> closed, regardless of mode.
// - a schema -> index signature of it, regardless of mode.
// - absent -> closed in input mode, open (`{ [k: string]: unknown }`) in output mode.
type AdditionalProps<S, Root, Depth extends number, M extends Mode> = S extends {
  additionalProperties: false;
}
  ? {}
  : S extends { additionalProperties: infer AP }
    ? AP extends true
      ? { [k: string]: unknown }
      : { [k: string]: FromSchemaAt<AP, Root, Depth, M> }
    : M extends "output"
      ? { [k: string]: unknown }
      : {};

type ObjectType<S, Root, Depth extends number, M extends Mode> = S extends { properties: infer P }
  ? Simplify<
      ObjOf<P, S extends { required: infer R } ? Keys<R> : never, Root, Depth, M> &
        AdditionalProps<S, Root, Depth, M>
    >
  : S extends { additionalProperties: false }
    ? Record<string, never>
    : { [k: string]: unknown };

// Tuple/array type: prefixItems -> tuple, items -> element type, items: false -> [].
type ArrayType<S, Root, Depth extends number, M extends Mode> = S extends { prefixItems: infer PI }
  ? PI extends readonly unknown[]
    ? { [K in keyof PI]: FromSchemaAt<PI[K], Root, Depth, M> }
    : unknown[]
  : S extends { items: false }
    ? []
    : S extends { items: infer I }
      ? FromSchemaAt<I, Root, Depth, M>[]
      : unknown[];

// Maps a single named type (an element of `type` or a `type` array) to its TS type, given the
// enclosing schema `S` for the "object" and "array" cases which need to see `properties`/`items`.
type MapType<T, S, Root, Depth extends number, M extends Mode> = T extends "object"
  ? ObjectType<S, Root, Depth, M>
  : T extends "array"
    ? ArrayType<S, Root, Depth, M>
    : T extends keyof Prim
      ? Prim[T]
      : unknown;

// Union over every type named in a `type: [...]` array.
type TypeArrayUnion<
  Ts,
  S,
  Root,
  Depth extends number,
  M extends Mode,
> = Ts extends readonly (infer T)[] ? MapType<T, S, Root, Depth, M> : never;

type WithNullable<S, T> = S extends { nullable: true } ? T | null : T;

type Prev8 = [never, 0, 1, 2, 3, 4, 5, 6, 7];

// The recursive worker, threading the root schema (for $ref), a recursion depth cap, and the
// input/output mode (for additionalProperties defaulting).
type FromSchemaAt<S, Root, Depth extends number, M extends Mode> = [Depth] extends [never]
  ? unknown
  : S extends { $ref: infer R extends string }
    ? FromSchemaAt<ResolveRef<R, Root>, Root, Prev8[Depth], M>
    : S extends { const: infer C }
      ? C
      : S extends { enum: readonly (infer E)[] }
        ? E
        : S extends { allOf: readonly (infer A)[] }
          ? Simplify<UnionToIntersection<FromSchemaAt<A, Root, Depth, M>>>
          : S extends { anyOf: readonly (infer A)[] }
            ? WithNullable<S, FromSchemaAt<A, Root, Depth, M>>
            : S extends { oneOf: readonly (infer A)[] }
              ? WithNullable<S, FromSchemaAt<A, Root, Depth, M>>
              : S extends { type: infer T extends readonly unknown[] }
                ? WithNullable<S, TypeArrayUnion<T, S, Root, Depth, M>>
                : S extends { type: "array" }
                  ? WithNullable<S, ArrayType<S, Root, Depth, M>>
                  : S extends { type: "object" }
                    ? WithNullable<S, ObjectType<S, Root, Depth, M>>
                    : S extends { type: infer T }
                      ? WithNullable<S, MapType<T, S, Root, Depth, M>>
                      : S extends { properties: unknown }
                        ? WithNullable<S, ObjectType<S, Root, Depth, M>>
                        : unknown;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

/**
 * Maps a JSON Schema (draft-07 or 2020-12 flavored) to its TypeScript type, in **input** mode:
 * objects are closed to their declared `properties` unless `additionalProperties` says
 * otherwise. Use this for a tool's `inputSchema` (arguments you construct).
 * Pass the root schema as the second type parameter so `$ref` can resolve against it;
 * defaults to `S` itself, which is correct for a schema that only refs its own `$defs`.
 */
export type FromSchema<S, Root = S> = FromSchemaAt<S, Root, 8, "input">;

/**
 * Same mapping as `FromSchema`, in **output** mode: objects with no `additionalProperties`
 * declared stay open (`& { [k: string]: unknown }`) rather than closed, since a server's
 * `structuredContent` may legitimately include fields its `outputSchema` didn't declare. Use
 * this for a tool's `outputSchema`.
 */
export type FromOutputSchema<S, Root = S> = FromSchemaAt<S, Root, 8, "output">;
