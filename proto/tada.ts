import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

// ---- minimal JSON-Schema → TS (the part you own, like gql.tada owns its GraphQL parser) ----
type Prim = { string: string; number: number; integer: number; boolean: boolean; null: null };
type Keys<T> = T extends readonly (infer K)[] ? K & string : never;

type ObjOf<P, R> = {
  [K in keyof P as K extends R ? K : never]: FromSchema<P[K]>
} & {
  [K in keyof P as K extends R ? never : K]?: FromSchema<P[K]>
};
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type FromSchema<S> =
  S extends { const: infer C } ? C :
  S extends { enum: readonly (infer E)[] } ? E :
  S extends { anyOf: readonly (infer A)[] } ? FromSchema<A> :
  S extends { oneOf: readonly (infer A)[] } ? FromSchema<A> :
  S extends { type: "array"; items: infer I } ? FromSchema<I>[] :
  S extends { type: "object"; properties: infer P }
    ? Simplify<ObjOf<P, S extends { required: infer R } ? Keys<R> : never>>
      & (S extends { additionalProperties: false } ? {} : { [k: string]: unknown }) :
  S extends { type: "object" } ? Record<string, unknown> :
  S extends { type: infer T extends keyof Prim } ? Prim[T] :
  unknown;

// ---- typed client ----
type Tools = Record<string, { inputSchema: unknown; outputSchema?: unknown }>;
type Introspection = { tools: Tools };
type Out<T> = T extends { outputSchema: infer S } ? FromSchema<S> : undefined;
type ToolResult<T> = { content: unknown[]; isError?: boolean; structuredContent: Out<T> };

export function initMcpTada<I extends Introspection>() {
  return {
    typed(client: Client) {
      return {
        async callTool<N extends keyof I["tools"] & string>(
          name: N,
          args: FromSchema<I["tools"][N]["inputSchema"]>
        ): Promise<ToolResult<I["tools"][N]>> {
          return (await client.callTool({ name, arguments: args as any })) as any;
        },
      };
    },
  };
}
