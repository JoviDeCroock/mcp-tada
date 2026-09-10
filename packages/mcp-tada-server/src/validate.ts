// Purpose-built runtime JSON Schema validator for the same subset `mcp-tada`'s type-level
// `FromSchema` mapper supports (see `packages/mcp-tada/src/schema.ts`): `type` (incl. arrays of
// types), `integer` vs `number`, `const`, `enum`, `required`, `properties`,
// `additionalProperties` (false or a schema), `items`, `prefixItems`, `anyOf`, `oneOf`, `allOf`,
// `nullable`, and `$ref` to `#/$defs/*` / `#/definitions/*` with a recursion cap. `properties`
// with no `type` is treated as an object, matching the mapper. Unknown keywords are ignored.

export type ValidationError = { path: string; message: string };

const MAX_DEPTH = 8;

/** Validates `value` against `schema`, returning a list of errors (empty means valid). */
export function validate(
  schema: unknown,
  value: unknown,
  root: unknown = schema,
): ValidationError[] {
  return validateAt(schema, value, root, "", 0);
}

function validateAt(
  schema: unknown,
  value: unknown,
  root: unknown,
  path: string,
  depth: number,
): ValidationError[] {
  if (typeof schema === "boolean") {
    return schema ? [] : [{ path, message: "value is not allowed here" }];
  }
  if (!isPlainObject(schema)) return [];

  const errors: ValidationError[] = [];

  if (typeof schema.$ref === "string" && depth < MAX_DEPTH) {
    const resolved = resolveRef(schema.$ref, root);
    if (resolved !== undefined) {
      errors.push(...validateAt(resolved, value, root, path, depth + 1));
    }
  }

  const nullable = schema.nullable === true;
  if (nullable && value === null) {
    return errors;
  }

  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? (schema.type as unknown[]) : [schema.type];
    if (!types.some((t) => matchesType(t, value))) {
      errors.push({
        path,
        message: `expected type ${types.join(" | ")}, got ${describe(value)}`,
      });
      return errors;
    }
  } else if ("properties" in schema && !isPlainObject(value)) {
    errors.push({ path, message: `expected type object, got ${describe(value)}` });
    return errors;
  }

  if ("const" in schema) {
    if (!deepEqual(value, schema.const)) {
      errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
    }
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
    const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in value)) {
        errors.push({ path: joinPath(path, key), message: "required property is missing" });
      }
    }
    const known = new Set(Object.keys(properties ?? {}));
    if (properties) {
      for (const key of Object.keys(properties)) {
        if (key in value) {
          errors.push(...validateAt(properties[key], value[key], root, joinPath(path, key), depth));
        }
      }
    }
    if ("additionalProperties" in schema) {
      const additional = schema.additionalProperties;
      for (const key of Object.keys(value)) {
        if (known.has(key)) continue;
        if (additional === false) {
          errors.push({ path: joinPath(path, key), message: "additional property is not allowed" });
        } else {
          errors.push(...validateAt(additional, value[key], root, joinPath(path, key), depth));
        }
      }
    }
  }

  if (Array.isArray(value)) {
    const prefixItems = Array.isArray(schema.prefixItems)
      ? (schema.prefixItems as unknown[])
      : undefined;
    const items = "items" in schema ? schema.items : undefined;

    if (prefixItems) {
      prefixItems.forEach((itemSchema, i) => {
        if (i < value.length) {
          errors.push(...validateAt(itemSchema, value[i], root, joinPath(path, String(i)), depth));
        }
      });
      if (items === false) {
        if (value.length > prefixItems.length) {
          errors.push({ path, message: "array has more items than prefixItems allows" });
        }
      } else if (items !== undefined) {
        for (let i = prefixItems.length; i < value.length; i++) {
          errors.push(...validateAt(items, value[i], root, joinPath(path, String(i)), depth));
        }
      }
    } else if (items === false) {
      if (value.length > 0) {
        errors.push({ path, message: "array items are not allowed" });
      }
    } else if (items !== undefined) {
      value.forEach((item, i) => {
        errors.push(...validateAt(items, item, root, joinPath(path, String(i)), depth));
      });
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      errors.push(...validateAt(sub, value, root, path, depth));
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matches = (schema.anyOf as unknown[]).some(
      (sub) => validateAt(sub, value, root, path, depth).length === 0,
    );
    if (!matches) {
      errors.push({ path, message: "value does not match any schema in anyOf" });
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matchCount = (schema.oneOf as unknown[]).filter(
      (sub) => validateAt(sub, value, root, path, depth).length === 0,
    ).length;
    if (matchCount !== 1) {
      errors.push({ path, message: `expected exactly one oneOf match, matched ${matchCount}` });
    }
  }

  return errors;
}

function matchesType(type: unknown, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      return true;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function resolveRef(ref: string, root: unknown): unknown {
  const defsMatch = /^#\/\$defs\/(.+)$/.exec(ref) ?? /^#\/definitions\/(.+)$/.exec(ref);
  if (!defsMatch) return undefined;
  if (!isPlainObject(root)) return undefined;
  const container = isPlainObject(root.$defs)
    ? root.$defs
    : isPlainObject(root.definitions)
      ? root.definitions
      : undefined;
  const name = defsMatch[1];
  return name === undefined ? undefined : container?.[name];
}
