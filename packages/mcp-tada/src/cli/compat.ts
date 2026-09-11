// Classifying a JSON Schema difference as breaking or additive, from the point of view of code
// written against the older schema.
//
// Direction decides which way compatibility runs. An `inputSchema` is written by the caller, so
// it is contravariant: loosening it (fewer required properties, a wider `type`, a looser bound)
// keeps existing calls valid, tightening it breaks them. An `outputSchema` is read by the
// caller, so it is covariant: the rules invert. Everything unrecognized is reported as breaking,
// so a schema keyword this does not model can only ever make `check` stricter, never quieter.
//
// Each keyword has one entry in `KEYWORDS`; that table is also the list of what is understood,
// so supporting a new keyword is a single line.

/** Which side of the call the schema describes: `"input"` is contravariant, `"output"` covariant. */
export type SchemaDirection = "input" | "output";

/**
 * How much a difference can hurt code written against the older snapshot. `additive` cannot;
 * `dangerous` keeps the contract but weakens a behavioural guarantee (a tool that stopped
 * promising to be read-only); `breaking` means calls or reads can stop working.
 */
export type Severity = "additive" | "dangerous" | "breaking";

const RANK: Record<Severity, number> = { additive: 0, dangerous: 1, breaking: 2 };

/** True when `severity` is at least as bad as `threshold`. */
export function atLeast(severity: Severity, threshold: Severity): boolean {
  return RANK[severity] >= RANK[threshold];
}

/** The worst severity in `items`, `additive` when there are none. */
export function worstOf(items: readonly { severity: Severity }[]): Severity {
  let worst: Severity = "additive";
  for (const item of items) if (RANK[item.severity] > RANK[worst]) worst = item.severity;
  return worst;
}

/** Sort key: worst first. */
export function bySeverity(a: { severity: Severity }, b: { severity: Severity }): number {
  return RANK[b.severity] - RANK[a.severity];
}

export interface SchemaChange {
  /** Where in the schema the change is, as a dotted path (`""` for the root, `.a[].b` inside). */
  path: string;
  severity: Severity;
  /** One line, without the path: `type string -> number`, `property "b" is now required`. */
  message: string;
}

/**
 * Diff two JSON Schemas, classifying each difference for `direction`. An empty result means the
 * schemas are equivalent apart from documentation keywords.
 */
export function compareSchemas(
  before: unknown,
  after: unknown,
  direction: SchemaDirection,
): SchemaChange[] {
  const out: SchemaChange[] = [];
  walk(before, after, new Scope(direction, out, ""));
  return out;
}

/** Keywords that carry documentation rather than constraints; a change to one is never breaking. */
const ANNOTATION_KEYWORDS = new Set([
  "$comment",
  "$id",
  "$schema",
  "default",
  "deprecated",
  "description",
  "examples",
  "title",
]);

/** One schema node being compared: where it is, and how to report what differs at it. */
class Scope {
  constructor(
    private readonly direction: SchemaDirection,
    private readonly out: SchemaChange[],
    readonly path: string,
  ) {}

  /** Recurse into a sub-schema at `path`. */
  walk(before: unknown, after: unknown, path: string): void {
    walk(before, after, new Scope(this.direction, this.out, path));
  }

  /** A change that rejects values the old schema accepted: breaking for what we send. */
  tightened(message: string, path = this.path): void {
    this.constrained(true, message, path);
  }

  /** A change that admits values the old schema rejected: breaking for what we receive. */
  loosened(message: string, path = this.path): void {
    this.constrained(false, message, path);
  }

  /** Report a tightening or loosening; the direction decides which of those breaks. */
  constrained(tighter: boolean, message: string, path = this.path): void {
    const breaks = tighter ? this.direction === "input" : this.direction === "output";
    this.emit(breaks ? "breaking" : "additive", message, path);
  }

  /** Breaking whichever way the schema is used, or not comparable at all. */
  broken(message: string, path = this.path): void {
    this.emit("breaking", message, path);
  }

  additive(message: string, path = this.path): void {
    this.emit("additive", message, path);
  }

  private emit(severity: Severity, message: string, path: string): void {
    this.out.push({ path, severity, message });
  }
}

/** Compares one keyword's value on both sides; only called when the two differ. */
type Handler = (before: unknown, after: unknown, keyword: string, cx: Scope) => void;

/**
 * The common shape: a constraint that appears tightens, one that disappears loosens, and
 * `whenBoth` decides the rest.
 */
function presence(whenBoth: Handler): Handler {
  return (before, after, keyword, cx) => {
    if (before === undefined) cx.tightened(`${keyword} added (${show(after)})`);
    else if (after === undefined) cx.loosened(`${keyword} removed`);
    else whenBoth(before, after, keyword, cx);
  };
}

/** Two concrete values that cannot be ordered against each other. */
const incomparable: Handler = (before, after, keyword, cx) =>
  cx.broken(`${keyword} ${show(before)} -> ${show(after)}`);

/** `minimum: 5` allows less than `minimum: 1`, so for a lower bound the larger value is tighter. */
const bound = (side: "lower" | "upper"): Handler =>
  presence((before, after, keyword, cx) => {
    if (typeof before !== "number" || typeof after !== "number") {
      return incomparable(before, after, keyword, cx);
    }
    const tighter = side === "lower" ? after > before : after < before;
    cx.constrained(tighter, `${keyword} ${before} -> ${after}`);
  });

/**
 * A branch added to `anyOf` widens the schema and one added to `allOf` narrows it. `oneOf` is
 * neither: a new branch that overlaps an old one turns a previously valid value into a
 * two-match rejection, so its changes are breaking either way.
 */
const combinator = (addingWidens: boolean | "unknown"): Handler =>
  presence((before, after, keyword, cx) => {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return cx.broken(`${keyword} changed`);
    }
    const { added, removed } = diffValues(before, after);
    const report = (tighter: boolean, message: string): void =>
      addingWidens === "unknown" ? cx.broken(message) : cx.constrained(tighter, message);
    if (added.length > 0) {
      report(addingWidens === false, `${keyword}: ${added.length} branch(es) added`);
    }
    if (removed.length > 0) {
      report(addingWidens === true, `${keyword}: ${removed.length} branch(es) removed`);
    }
  });

const definitions: Handler = (before, after, keyword, cx) => {
  if (!isRecord(before) || !isRecord(after)) return cx.broken(`${keyword} changed`);
  const { common, removed } = diffKeys(before, after);
  for (const name of common) cx.walk(before[name], after[name], `${cx.path}#${name}`);
  for (const name of removed) cx.broken("definition removed", `${cx.path}#${name}`);
};

const KEYWORDS: Record<string, Handler> = {
  type(before, after, _keyword, cx) {
    const b = typeSet(before);
    const a = typeSet(after);
    if (setEqual(b, a)) return;
    const message = `type ${formatTypes(b)} -> ${formatTypes(a)}`;
    // A missing `type` means "any type", so it is the widest set there is.
    const bWidest = b.size === 0;
    const aWidest = a.size === 0;
    if (bWidest && !aWidest) cx.tightened(message);
    else if (!bWidest && aWidest) cx.loosened(message);
    else if (isSubset(b, a)) cx.loosened(message);
    else if (isSubset(a, b)) cx.tightened(message);
    else cx.broken(message);
  },

  required(before, after, _keyword, cx) {
    const { added, removed } = diffValues(stringArray(before), stringArray(after));
    for (const name of added) cx.tightened("is now required", child(cx.path, name));
    for (const name of removed) cx.loosened("is no longer required", child(cx.path, name));
  },

  properties(before, after, _keyword, cx) {
    const b = isRecord(before) ? before : {};
    const a = isRecord(after) ? after : {};
    const { added, removed, common } = diffKeys(b, a);
    for (const name of common) cx.walk(b[name], a[name], child(cx.path, name));
    // Gone from the schema in either direction: a caller that passed it no longer type-checks,
    // and a caller that read it no longer gets it.
    for (const name of removed) cx.broken("property removed", child(cx.path, name));
    // Whether this is safe to ignore is decided by `required`, which is compared separately.
    for (const name of added) cx.additive("property added", child(cx.path, name));
  },

  additionalProperties(before, after, _keyword, cx) {
    if (isRecord(before) && isRecord(after)) return cx.walk(before, after, `${cx.path}[key]`);
    // Absent means "allowed", so only an explicit `false` narrows, and `undefined` -> `true` is
    // a server spelling out what it already meant.
    const closed = after === false;
    if (closed !== (before === false)) {
      const message = closed
        ? "no longer allows additional properties"
        : "now allows additional properties";
      return cx.constrained(closed, message);
    }
    // One side constrains the extra properties and the other does not.
    const constrained = isRecord(after);
    if (constrained || isRecord(before)) {
      const message = constrained
        ? "additional properties are now constrained"
        : "additional properties are no longer constrained";
      cx.constrained(constrained, message);
    }
  },

  items: presence((before, after, _keyword, cx) => cx.walk(before, after, `${cx.path}[]`)),

  prefixItems: presence((before, after, keyword, cx) => {
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      for (const [i, b] of before.entries()) cx.walk(b, after[i], `${cx.path}[${i}]`);
    } else {
      cx.broken(`${keyword} changed`);
    }
  }),

  const: presence(incomparable),

  enum: presence((before, after, keyword, cx) => {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return incomparable(before, after, keyword, cx);
    }
    const { added, removed } = diffValues(before, after);
    if (removed.length > 0) cx.tightened(`enum no longer accepts ${formatValues(removed)}`);
    if (added.length > 0) cx.loosened(`enum now includes ${formatValues(added)}`);
    // Neither list populated means the values were only reordered, which changes nothing.
  }),

  anyOf: combinator(true),
  oneOf: combinator("unknown"),
  allOf: combinator(false),

  minimum: bound("lower"),
  exclusiveMinimum: bound("lower"),
  minLength: bound("lower"),
  minItems: bound("lower"),
  minProperties: bound("lower"),
  maximum: bound("upper"),
  exclusiveMaximum: bound("upper"),
  maxLength: bound("upper"),
  maxItems: bound("upper"),
  maxProperties: bound("upper"),

  // Two concrete patterns are not comparable without deciding regex containment.
  pattern: presence(incomparable),
  format: presence(incomparable),
  multipleOf: presence(incomparable),

  uniqueItems(before, after, _keyword, cx) {
    // `undefined` and `false` both mean "duplicates allowed", so only a flip to `true` matters.
    const unique = after === true;
    if (unique === (before === true)) return;
    cx.constrained(unique, unique ? "items must now be unique" : "items need no longer be unique");
  },

  $ref: (before, after, keyword, cx) =>
    cx.broken(`${keyword} ${String(before)} -> ${String(after)}`),
  $defs: definitions,
  definitions,
};

/** `true` (or `{}`) accepts everything and `false` nothing; any other schema sits in between. */
function width(schema: unknown): number {
  if (schema === true || (isRecord(schema) && Object.keys(schema).length === 0)) return 2;
  return schema === false ? 0 : 1;
}

function walk(before: unknown, after: unknown, cx: Scope): void {
  if (deepEqual(before, after)) return;
  // A boolean schema can only be compared whole, but its direction is still known.
  if (typeof before === "boolean" || typeof after === "boolean") {
    return cx.constrained(width(after) < width(before), `schema ${show(before)} -> ${show(after)}`);
  }
  if (!isRecord(before) || !isRecord(after)) return cx.broken("schema changed");
  // Table order first so the report reads top-down; unknown keywords after.
  const keys = new Set([...Object.keys(KEYWORDS), ...Object.keys(before), ...Object.keys(after)]);
  for (const keyword of keys) {
    if (ANNOTATION_KEYWORDS.has(keyword) || deepEqual(before[keyword], after[keyword])) continue;
    const handler = Object.hasOwn(KEYWORDS, keyword) ? KEYWORDS[keyword] : undefined;
    // Anything this module does not model is reported as breaking rather than silently accepted.
    if (handler) handler(before[keyword], after[keyword], keyword, cx);
    else cx.broken(`${keyword} changed`);
  }
}

/** Keys added, removed, and shared between two records, each sorted. */
export function diffKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { added: string[]; removed: string[]; common: string[] } {
  const b = Object.keys(before).sort();
  const a = Object.keys(after).sort();
  return {
    added: a.filter((k) => !(k in before)),
    removed: b.filter((k) => !(k in after)),
    common: a.filter((k) => k in before),
  };
}

/** Elements of `after` not in `before` and vice versa, by structural equality; order is ignored. */
export function diffValues<T>(before: T[], after: T[]): { added: T[]; removed: T[] } {
  return {
    added: after.filter((v) => !before.some((o) => deepEqual(v, o))),
    removed: before.filter((v) => !after.some((o) => deepEqual(v, o))),
  };
}

function child(path: string, name: string): string {
  return `${path}.${name}`;
}

/** A value for an error message, cut short when it is a large schema fragment. */
function show(value: unknown): string {
  const json = JSON.stringify(value) ?? String(value);
  return json.length > 40 ? `${json.slice(0, 37)}...` : json;
}

function typeSet(type: unknown): Set<string> {
  return new Set(typeof type === "string" ? [type] : stringArray(type));
}

function formatTypes(types: Set<string>): string {
  return types.size === 0 ? "any" : [...types].sort().join("|");
}

function formatValues(values: unknown[]): string {
  const shown = values.slice(0, 3).map((v) => JSON.stringify(v));
  return values.length > 3 ? `${shown.join(", ")}, ...` : shown.join(", ");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function setEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && isSubset(a, b);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON data: key order does not matter, array order does. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    return ak.every((k, i) => k === bk[i] && deepEqual(ao[k], bo[k]));
  }
  return false;
}
