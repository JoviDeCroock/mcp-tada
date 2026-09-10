// Purpose-built type-level JSON Schema -> TS mapper.
// Deliberately not a general-purpose json-schema-to-ts replacement: it supports the subset
// that shows up in real tool schemas (draft-07 and 2020-12), and stays cheap in instantiations.
//
// Spec-mapping decisions:
// - `additionalProperties` default (i.e. absent): the object stays closed to its declared
//   `properties` (no stray index signature). This favors clean hover output over strict spec
//   fidelity ("true" is the JSON Schema default, which would add `[k: string]: unknown`).
// - `additionalProperties: false` with no `properties` at all -> `Record<string, never>`-ish
//   empty object (closed).
// - No `properties` and no `additionalProperties` restriction -> `[k: string]: unknown` index
//   signature, since the object is genuinely open.
// - `$ref` is resolved against the root schema passed as the second type parameter. Recursion
//   is capped at 8 levels; beyond that we bail to `unknown` rather than blow up the compiler.

type Prim = {
  string: string;
  number: number;
  integer: number;
  boolean: boolean;
  null: null;
};

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
type ObjOf<P, R, Root, Depth extends number> = {
  [K in keyof P as K extends R ? K : never]: FromSchemaAt<P[K], Root, Depth>;
} & {
  [K in keyof P as K extends R ? never : K]?: FromSchemaAt<P[K], Root, Depth>;
};

// additionalProperties handling: false/absent -> closed; a schema -> index signature of it.
type AdditionalProps<S, Root, Depth extends number> = S extends { additionalProperties: false }
  ? {}
  : S extends { additionalProperties: infer AP }
    ? AP extends true
      ? { [k: string]: unknown }
      : { [k: string]: FromSchemaAt<AP, Root, Depth> }
    : {};

type ObjectType<S, Root, Depth extends number> = S extends { properties: infer P }
  ? Simplify<
      ObjOf<P, S extends { required: infer R } ? Keys<R> : never, Root, Depth> &
        AdditionalProps<S, Root, Depth>
    >
  : S extends { additionalProperties: false }
    ? Record<string, never>
    : { [k: string]: unknown };

// Tuple/array type: prefixItems -> tuple, items -> element type, items: false -> [].
type ArrayType<S, Root, Depth extends number> = S extends { prefixItems: infer PI }
  ? PI extends readonly unknown[]
    ? { [K in keyof PI]: FromSchemaAt<PI[K], Root, Depth> }
    : unknown[]
  : S extends { items: false }
    ? []
    : S extends { items: infer I }
      ? FromSchemaAt<I, Root, Depth>[]
      : unknown[];

type TypeOf<T> = T extends readonly (infer E)[]
  ? E extends keyof Prim
    ? Prim[E]
    : unknown
  : T extends keyof Prim
    ? Prim[T]
    : unknown;

type WithNullable<S, T> = S extends { nullable: true } ? T | null : T;

type Prev8 = [never, 0, 1, 2, 3, 4, 5, 6, 7];

// The recursive worker, threading the root schema (for $ref) and a recursion depth cap.
type FromSchemaAt<S, Root, Depth extends number> = [Depth] extends [never]
  ? unknown
  : S extends { $ref: infer R extends string }
    ? FromSchemaAt<ResolveRef<R, Root>, Root, Prev8[Depth]>
    : S extends { const: infer C }
      ? C
      : S extends { enum: readonly (infer E)[] }
        ? E
        : S extends { allOf: readonly (infer A)[] }
          ? Simplify<UnionToIntersection<FromSchemaAt<A, Root, Depth>>>
          : S extends { anyOf: readonly (infer A)[] }
            ? WithNullable<S, FromSchemaAt<A, Root, Depth>>
            : S extends { oneOf: readonly (infer A)[] }
              ? WithNullable<S, FromSchemaAt<A, Root, Depth>>
              : S extends { type: "array" }
                ? WithNullable<S, ArrayType<S, Root, Depth>>
                : S extends { type: "object" }
                  ? WithNullable<S, ObjectType<S, Root, Depth>>
                  : S extends { type: infer T }
                    ? WithNullable<S, TypeOf<T>>
                    : unknown;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never;

/**
 * Maps a JSON Schema (draft-07 or 2020-12 flavored) to its TypeScript type.
 * Pass the root schema as the second type parameter so `$ref` can resolve against it;
 * defaults to `S` itself, which is correct for a schema that only refs its own `$defs`.
 */
export type FromSchema<S, Root = S> = FromSchemaAt<S, Root, 8>;
