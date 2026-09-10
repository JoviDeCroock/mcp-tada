// Parsing a previously generated introspection snapshot back into data, either from the
// `.d.ts` mcp-tada emits (a JSON type literal with JSDoc comments above tool and prompt keys) or from
// the `--json` dump. The emitter in introspect.ts is written to keep the `.d.ts` literal
// strict, quoted-key JSON, so this is a straightforward strip-comments-then-JSON.parse.

/** The behavioural hints a server may attach to a tool (`Tool["annotations"]` in the SDK). */
export interface ToolAnnotationsSnapshot {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

export interface ToolSnapshot {
  inputSchema: unknown;
  outputSchema?: unknown;
  /** Present only when the server sent `annotations` for the tool. */
  annotations?: ToolAnnotationsSnapshot;
}

/** One prompt argument as recorded in the snapshot. The description goes into the prompt's
 * JSDoc block instead, so a reworded description does not read as drift. */
export interface PromptArgumentSnapshot {
  name: string;
  required?: boolean;
}

export interface PromptSnapshot {
  arguments: PromptArgumentSnapshot[];
}

export interface IntrospectionData {
  tools: Record<string, ToolSnapshot>;
  /** Present only when the server declares the `prompts` capability (possibly empty). */
  prompts?: Record<string, PromptSnapshot>;
}

export type SnapshotFormat = "dts" | "json";

/** Infer snapshot format from a file path's extension. */
export function detectFormat(path: string): SnapshotFormat {
  return path.endsWith(".json") ? "json" : "dts";
}

export function parseSnapshotText(text: string, format: SnapshotFormat): IntrospectionData {
  return format === "json" ? parseJsonSnapshot(text) : parseDtsSnapshot(text);
}

function parseJsonSnapshot(text: string): IntrospectionData {
  const data = JSON.parse(text) as unknown;
  assertIntrospectionData(data);
  return data;
}

/** Strip `/** ... *\/` JSDoc blocks (mcp-tada only ever emits these outside of string values). */
function stripJsDoc(text: string): string {
  return text.replace(/\/\*\*[\s\S]*?\*\//g, "");
}

/** Extract the balanced `{ ... }` substring starting at `startIdx`, string-literal aware. */
function extractBalancedObject(text: string, startIdx: number): string {
  if (text[startIdx] !== "{") {
    throw new Error(`Expected '{' at position ${startIdx}`);
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error("Unbalanced braces while parsing introspection snapshot");
}

export function parseDtsSnapshot(text: string): IntrospectionData {
  const withoutJsDoc = stripJsDoc(text);
  const marker = "export type introspection";
  const markerIdx = withoutJsDoc.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error('Could not find "export type introspection" in snapshot file');
  }
  const eqIdx = withoutJsDoc.indexOf("=", markerIdx);
  if (eqIdx === -1) {
    throw new Error('Could not find "=" after "export type introspection"');
  }
  const braceStart = withoutJsDoc.indexOf("{", eqIdx);
  if (braceStart === -1) {
    throw new Error("Could not find the introspection type literal's opening brace");
  }
  const literal = extractBalancedObject(withoutJsDoc, braceStart);
  let data: unknown;
  try {
    data = JSON.parse(literal);
  } catch (err) {
    throw new Error(`Failed to parse introspection snapshot as JSON: ${(err as Error).message}`);
  }
  assertIntrospectionData(data);
  return data;
}

function assertIntrospectionData(data: unknown): asserts data is IntrospectionData {
  if (
    typeof data !== "object" ||
    data === null ||
    !("tools" in data) ||
    typeof (data as { tools: unknown }).tools !== "object" ||
    (data as { tools: unknown }).tools === null
  ) {
    throw new Error('Parsed snapshot is missing a top-level "tools" object');
  }
  const prompts = (data as { prompts?: unknown }).prompts;
  if (prompts !== undefined && (typeof prompts !== "object" || prompts === null)) {
    throw new Error('Parsed snapshot has a top-level "prompts" that is not an object');
  }
}
