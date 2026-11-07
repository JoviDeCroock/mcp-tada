// Runtime validation belongs to the server package; the client mapper stays type-only.
import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

export type ValidationError = { path: string; message: string };

const MAX_DEPTH = 64;
const MAX_SCHEMA_NODES = 4096;
const MAX_VALUE_NODES = 100_000;
const MAX_SCHEMA_BYTES = 256_000;
const MAX_CACHED_SCHEMAS = 128;
const ROOT_ID = "urn:mcp-tada:validation-root";
const validators = new Map<string, ValidateFunction>();

/** Validate JSON Schema 2020-12 (the default) or explicit draft-07 without fetching references.
 * When supplied, `root` must contain `schema`; local references resolve against that root.
 * Invalid/unsupported schemas and exceeded limits return errors rather than accepting data.
 */
export function validate(
  schema: unknown,
  value: unknown,
  root: unknown = schema,
): ValidationError[] {
  try {
    assertBounds(root, MAX_SCHEMA_NODES, "schema");
    assertBounds(value, MAX_VALUE_NODES, "value");
    const pointer = schema === root ? "" : pointerTo(root, schema);
    if (pointer === undefined) throw new Error("schema is not contained in the supplied root");
    const key = JSON.stringify([root, pointer]);
    if (new TextEncoder().encode(key).byteLength > MAX_SCHEMA_BYTES)
      throw new Error("schema exceeds the 256000 byte limit");
    let validator = validators.get(key);
    if (validator === undefined) {
      validator = compile(root, pointer);
      if (validators.size >= MAX_CACHED_SCHEMAS) validators.delete(validators.keys().next().value!);
      validators.set(key, validator);
    }
    if (validator(value)) return [];
    return (validator.errors ?? []).map(toError);
  } catch (error) {
    return [
      {
        path: "",
        message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
}

function compile(root: unknown, pointer: string): ValidateFunction {
  const dialect =
    typeof root === "object" && root !== null && "$schema" in root ? root.$schema : undefined;
  const draft7 =
    dialect === "http://json-schema.org/draft-07/schema#" ||
    dialect === "http://json-schema.org/draft-07/schema";
  if (
    dialect !== undefined &&
    !draft7 &&
    dialect !== "https://json-schema.org/draft/2020-12/schema"
  ) {
    throw new Error(`unsupported JSON Schema dialect: ${String(dialect)}`);
  }
  // No loadSchema hook or compileAsync: unresolved external references are compile errors.
  // No coercion, defaults or property removal: validation never rewrites handler arguments.
  const options = {
    strict: false,
    strictNumbers: true,
    ownProperties: true,
    validateFormats: false,
    inlineRefs: false,
    logger: false as const,
  };
  const ajv = draft7 ? new Ajv(options) : new Ajv2020(options);
  ajv.addSchema(root as AnySchema, ROOT_ID);
  const validator = ajv.getSchema(`${ROOT_ID}#${pointer}`);
  if (validator === undefined || ("$async" in validator && validator.$async))
    throw new Error("schema must support synchronous validation");
  return validator;
}

function toError(error: ErrorObject): ValidationError {
  const path = error.instancePath.split("/").slice(1).map(unescapePointer);
  if (error.keyword === "required") path.push(String(error.params.missingProperty));
  if (error.keyword === "additionalProperties") path.push(String(error.params.additionalProperty));
  return {
    path: path.join("."),
    message:
      error.keyword === "required"
        ? "required property is missing"
        : (error.message ?? error.keyword),
  };
}

function assertBounds(value: unknown, maxNodes: number, label: string): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (++nodes > maxNodes || entry.depth > MAX_DEPTH)
      throw new Error(`${label} exceeds validation size or depth limits`);
    if (entry.value !== null && typeof entry.value === "object") {
      const children = Object.values(entry.value);
      if (children.length + nodes + pending.length > maxNodes)
        throw new Error(`${label} exceeds validation size or depth limits`);
      for (const child of children) pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
}

function pointerTo(root: unknown, schema: unknown, pointer = ""): string | undefined {
  if (root === schema) return pointer;
  if (typeof root !== "object" || root === null) return undefined;
  for (const [key, child] of Object.entries(root)) {
    const found = pointerTo(
      child,
      schema,
      `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

function unescapePointer(value: string): string {
  return value.replace(/~1/g, "/").replace(/~0/g, "~");
}
