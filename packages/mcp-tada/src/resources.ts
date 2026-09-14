// Type-level view of the `resources` and `resourceTemplates` maps in a snapshot, and the one
// piece of runtime the client needs for them: expanding a URI template before `resources/read`.
//
// A static resource is keyed by its URI and records `{ name, mimeType? }`. A template is keyed
// by its name and records `{ uriTemplate, mimeType? }`. The template's variables are parsed out
// of the RFC 6570 string at the type level, so `readResourceTemplate(name, params)` knows which
// keys `params` needs; `expandUriTemplate` below is the matching runtime, written here so the
// library keeps importing nothing from either SDK.
import type { Introspection } from "./index.js";
import type { BlobResourceContents, ReadResourceResult, TextResourceContents } from "./wire.js";

/** One static resource as recorded in a snapshot, keyed by its URI. */
export type ResourceEntry = { name: string; mimeType?: string };
/** One resource template as recorded in a snapshot, keyed by its name. */
export type ResourceTemplateEntry = { uriTemplate: string; mimeType?: string };

type ResourcesOf<I extends Introspection> = I extends {
  resources: infer R extends Record<string, ResourceEntry>;
}
  ? R
  : {};

type TemplatesOf<I extends Introspection> = I extends {
  resourceTemplates: infer T extends Record<string, ResourceTemplateEntry>;
}
  ? T
  : {};

/** The URIs of the static resources a snapshot recorded. */
export type ResourceUris<I extends Introspection> = keyof ResourcesOf<I> & string;

/** The names of the resource templates a snapshot recorded. */
export type ResourceTemplateNames<I extends Introspection> = keyof TemplatesOf<I> & string;

/** One template's `uriTemplate` string, or `string` for a name the snapshot does not know. */
export type ResourceTemplateOf<I extends Introspection, N extends string> =
  TemplatesOf<I> extends infer T
    ? N extends keyof T
      ? T[N] extends { uriTemplate: infer U extends string }
        ? U
        : string
      : string
    : string;

// The recorded `mimeType` of an entry, or `string` when it has none (a server may still send one).
type MimeTypeOf<E> = E extends { mimeType: infer M extends string } ? M : string;

/** The `mimeType` a static resource was recorded with (`string` for an unknown URI). */
export type ResourceMimeType<I extends Introspection, U extends string> =
  ResourcesOf<I> extends infer R ? (U extends keyof R ? MimeTypeOf<R[U]> : string) : string;

/** The `mimeType` a resource template was recorded with (`string` for an unknown name). */
export type ResourceTemplateMimeType<I extends Introspection, N extends string> =
  TemplatesOf<I> extends infer T ? (N extends keyof T ? MimeTypeOf<T[N]> : string) : string;

// --- RFC 6570 at the type level -------------------------------------------------------------

// Each `{...}` expression in the template, as its inner text.
type Expressions<T extends string> = T extends `${string}{${infer E}}${infer Rest}`
  ? E | Expressions<Rest>
  : never;

// Operators whose variables are optional: a query (or continuation) that is simply omitted.
type OptionalOperator = "?" | "&";
type Operator = "+" | "#" | "." | "/" | ";" | OptionalOperator;

type StripOperator<E extends string> = E extends `${Operator}${infer Vars}` ? Vars : E;

type SplitVars<V extends string> = V extends `${infer A},${infer B}` ? A | SplitVars<B> : V;

// `name*` explodes a list; `name:3` truncates a string. Both are modifiers on the name.
type VarName<V extends string> = V extends `${infer N}*`
  ? N
  : V extends `${infer N}:${string}`
    ? N
    : V;

type VarValue<V extends string> = V extends `${string}*` ? string | string[] : string;

// Distributive over `E`, so each expression decides `optional` for its own variables only.
type VarsIn<E extends string> = E extends string
  ? {
      [V in SplitVars<StripOperator<E>>]: {
        name: VarName<V>;
        value: VarValue<V>;
        optional: E extends `${OptionalOperator}${string}` ? true : false;
      };
    }[SplitVars<StripOperator<E>>]
  : never;

type Vars<T extends string> = VarsIn<Expressions<T>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The parameters an RFC 6570 URI template needs, as an object type: one `string` key per
 * variable, `string | string[]` for an exploded (`{list*}`) one, and optional keys for query
 * (`{?page,limit}`) and continuation (`{&x}`) expressions, which can be left out.
 */
export type UriTemplateParams<T extends string> = Simplify<
  {
    [V in Vars<T> as V["optional"] extends false ? V["name"] : never]: V["value"];
  } & {
    [V in Vars<T> as V["optional"] extends true ? V["name"] : never]?: V["value"];
  }
>;

/** True when every variable of the template is optional, so `params` can be omitted. */
export type HasNoRequiredTemplateVars<T extends string> = [
  Extract<Vars<T>, { optional: false }>,
] extends [never]
  ? true
  : false;

/** The typed `params` object for one of a snapshot's resource templates. */
export type ResourceTemplateParams<
  I extends Introspection,
  N extends ResourceTemplateNames<I>,
> = UriTemplateParams<ResourceTemplateOf<I, N>>;

// --- results ----------------------------------------------------------------------------------

/**
 * `ReadResourceResult` with each content item's `mimeType` narrowed to what the snapshot
 * recorded for the resource (or template). Text and blob contents stay a union: the recorded
 * `mimeType` says what the bytes are, not how the server chose to encode them.
 */
export type TypedReadResourceResult<M extends string = string> = {
  contents: Array<(TextResourceContents | BlobResourceContents) & { mimeType?: M }>;
  _meta?: ReadResourceResult["_meta"];
  [key: string]: unknown;
};

/** `ReadResourceResult` for one of the snapshot's static resources. */
export type ResourceResult<I extends Introspection, U extends string> = TypedReadResourceResult<
  ResourceMimeType<I, U>
>;

/** `ReadResourceResult` for one of the snapshot's resource templates. */
export type ResourceTemplateResult<
  I extends Introspection,
  N extends string,
> = TypedReadResourceResult<ResourceTemplateMimeType<I, N>>;

// --- runtime ----------------------------------------------------------------------------------

// One RFC 6570 operator: the prefix it emits, the separator between its variables, whether each
// value is written `name=value`, what an empty named value becomes, and whether reserved
// characters (`/`, `?`, `:` ...) pass through unencoded.
type Op = { first: string; sep: string; named: boolean; ifEmpty: string; reserved: boolean };
const OPS: Record<string, Op> = {
  "": { first: "", sep: ",", named: false, ifEmpty: "", reserved: false },
  "+": { first: "", sep: ",", named: false, ifEmpty: "", reserved: true },
  "#": { first: "#", sep: ",", named: false, ifEmpty: "", reserved: true },
  ".": { first: ".", sep: ".", named: false, ifEmpty: "", reserved: false },
  "/": { first: "/", sep: "/", named: false, ifEmpty: "", reserved: false },
  ";": { first: ";", sep: ";", named: true, ifEmpty: "", reserved: false },
  "?": { first: "?", sep: "&", named: true, ifEmpty: "=", reserved: false },
  "&": { first: "&", sep: "&", named: true, ifEmpty: "=", reserved: false },
};

function encode(value: string, reserved: boolean): string {
  // `encodeURI` keeps the reserved set and, unlike a hand-rolled table, already-percent-encoded
  // triplets stay as they are once `%25` is folded back.
  return reserved
    ? encodeURI(value).replace(/%25([0-9A-Fa-f]{2})/g, "%$1")
    : encodeURIComponent(value);
}

function expandExpression(expression: string, params: Record<string, unknown>): string {
  const op = OPS[expression[0] ?? ""] ? (expression[0] as string) : "";
  const spec = OPS[op] as Op;
  const parts: string[] = [];
  for (const varSpec of (op ? expression.slice(1) : expression).split(",")) {
    const explode = varSpec.endsWith("*");
    const [rawName, prefix] = (explode ? varSpec.slice(0, -1) : varSpec).split(":");
    const name = rawName ?? "";
    const value = params[name];
    if (value === undefined || value === null) continue;
    const key = encode(name, true);
    if (Array.isArray(value)) {
      const items = value.map((v) => encode(String(v), spec.reserved));
      if (items.length === 0) continue;
      if (explode) {
        parts.push(...items.map((v) => (spec.named ? `${key}=${v}` : v)));
      } else {
        parts.push(spec.named ? `${key}=${items.join(",")}` : items.join(","));
      }
      continue;
    }
    let text = String(value);
    if (prefix !== undefined) text = text.slice(0, Number(prefix));
    const encoded = encode(text, spec.reserved);
    parts.push(
      spec.named ? (text === "" ? `${key}${spec.ifEmpty}` : `${key}=${encoded}`) : encoded,
    );
  }
  return parts.length === 0 ? "" : spec.first + parts.join(spec.sep);
}

/**
 * Expands an RFC 6570 URI template with the given variables, e.g.
 * `expandUriTemplate("file:///{path}{?ref}", { path: "a/b" })` is `"file:///a%2Fb"`. Covers
 * the operators `+ # . / ; ? &`, the `*` explode and `:n` prefix modifiers, and list values,
 * which is what MCP servers' `uriTemplate`s use; a variable that is missing from `params`
 * expands to nothing, so an optional query part is simply absent.
 */
export function expandUriTemplate(
  template: string,
  params: Record<string, string | string[]> = {},
): string {
  return template.replace(/\{([^{}]*)\}/g, (_, expression: string) =>
    expandExpression(expression, params),
  );
}
