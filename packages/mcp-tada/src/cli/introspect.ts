// Connects to an MCP server, pages through tools/list (and prompts/list when the server declares
// the prompts capability), and emits either a typed `introspection.d.ts` snapshot or the raw
// data as JSON.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Prompt, Tool } from "@modelcontextprotocol/sdk/types.js";
import { listAllPrompts, listAllTools } from "../list.js";
import {
  connectClient,
  getNegotiatedProtocolVersion,
  withTimeoutWrapping,
  type ServerTarget,
} from "./connect.js";
import type {
  IntrospectionData,
  PromptSnapshot,
  ToolAnnotationsSnapshot,
  ToolSnapshot,
} from "./snapshot.js";

export interface IntrospectMeta {
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  toolsListChanged?: boolean;
  /** Set when the server declares the `prompts` capability. */
  promptsListChanged?: boolean;
  /** Read defensively: not present in @modelcontextprotocol/sdk 1.30's ListToolsResult type,
   * but the 2026-07-28 spec RC adds server-controlled result caching hints. */
  ttlMs?: number;
  /** Same caveat as ttlMs above. */
  cacheScope?: string;
}

export interface RawToolListResult {
  tools?: unknown;
  nextCursor?: string;
  ttlMs?: number;
  cacheScope?: string;
}

/** What `introspectTarget` read from a server: every tool, and every prompt when the server
 * declares the `prompts` capability (`undefined` when it does not, so a snapshot of such a
 * server has no `prompts` key at all). */
export interface IntrospectSource {
  tools: Tool[];
  prompts?: Prompt[];
}

/** Connect, page through tools/list (and prompts/list when offered) until nextCursor is
 * exhausted, then disconnect. */
export async function introspectTarget(
  target: ServerTarget,
): Promise<IntrospectSource & { meta: IntrospectMeta }> {
  const { client, transport } = await connectClient(target);
  try {
    const caps = client.getServerCapabilities();
    const version = client.getServerVersion();
    let lastRaw: RawToolListResult | undefined;
    const listOptions = target.timeoutMs !== undefined ? { timeout: target.timeoutMs } : undefined;
    const tools = await withTimeoutWrapping(target, transport, () =>
      listAllTools<RawToolListResult & { tools: Tool[] }>(
        (params) =>
          client.listTools(params, listOptions) as Promise<RawToolListResult & { tools: Tool[] }>,
        (page) => {
          lastRaw = page;
        },
      ),
    );
    let prompts: Prompt[] | undefined;
    if (caps?.prompts !== undefined) {
      try {
        prompts = await withTimeoutWrapping(target, transport, () =>
          listAllPrompts((params) => client.listPrompts(params, listOptions)),
        );
      } catch (err) {
        // A server that advertises prompts but cannot list them should not take the tool
        // snapshot down with it; the omitted key reads as "no prompts recorded".
        console.error(
          `mcp-tada: prompts/list failed, snapshot will not include prompts: ${(err as Error).message}`,
        );
      }
    }

    // NOTE: getNegotiatedProtocolVersion() only tells us anything for the streamable HTTP
    // transport, which exposes it publicly; stdio/SSE don't expose the negotiated version
    // on the SDK 1.30 Transport type, so this can legitimately be undefined.
    const meta: IntrospectMeta = {};
    if (version?.name !== undefined) meta.serverName = version.name;
    if (version?.version !== undefined) meta.serverVersion = version.version;
    if (caps?.tools?.listChanged !== undefined) meta.toolsListChanged = caps.tools.listChanged;
    if (caps?.prompts !== undefined) meta.promptsListChanged = caps.prompts.listChanged ?? false;
    if (lastRaw?.ttlMs !== undefined) meta.ttlMs = lastRaw.ttlMs;
    if (lastRaw?.cacheScope !== undefined) meta.cacheScope = lastRaw.cacheScope;
    const protocolVersion = getNegotiatedProtocolVersion(transport);
    if (protocolVersion !== undefined) meta.protocolVersion = protocolVersion;
    return prompts !== undefined ? { tools, prompts, meta } : { tools, meta };
  } finally {
    // withTimeoutWrapping already closed the transport on a timeout; a second close is a no-op
    // in the happy path and best-effort (never fatal) if the transport is already gone.
    try {
      await client.close();
    } catch {
      // already closed, or closing failed after a prior error we're already propagating
    }
  }
}

/** The snapshot entry for one tool: `inputSchema`, plus `outputSchema` and `annotations` when
 * the server sent them. Annotation keys are emitted in the spec's order so the file is stable
 * regardless of how a server happens to order them. */
export function toToolSnapshot(tool: Tool): ToolSnapshot {
  const entry: ToolSnapshot = { inputSchema: tool.inputSchema };
  if (tool.outputSchema !== undefined) entry.outputSchema = tool.outputSchema;
  if (tool.annotations !== undefined) entry.annotations = orderAnnotations(tool.annotations);
  return entry;
}

const annotationOrder = [
  "title",
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const;

function orderAnnotations(annotations: Record<string, unknown>): ToolAnnotationsSnapshot {
  const out: Record<string, unknown> = {};
  for (const key of annotationOrder) {
    if (annotations[key] !== undefined) out[key] = annotations[key];
  }
  for (const key of Object.keys(annotations).sort()) {
    if (!(key in out) && annotations[key] !== undefined) out[key] = annotations[key];
  }
  return out as ToolAnnotationsSnapshot;
}

/** The snapshot entry for one prompt: its argument names and `required` flags, in the server's
 * order. Descriptions live in the JSDoc block, not here. */
export function toPromptSnapshot(prompt: Prompt): PromptSnapshot {
  return {
    arguments: (prompt.arguments ?? []).map((arg) =>
      arg.required !== undefined ? { name: arg.name, required: arg.required } : { name: arg.name },
    ),
  };
}

/** Sort by name, keeping the last definition when a server lists a name twice. */
function sortedByName<T extends { name: string }>(items: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of items) byName.set(item.name, item);
  return [...byName.keys()].sort().map((name) => byName.get(name) as T);
}

/** Build the sorted, name-keyed snapshot data: `tools` as `{ inputSchema, outputSchema?,
 * annotations? }`, and `prompts` as `{ arguments }` when the source has them. Accepts a bare
 * `Tool[]` for callers that only have tools. */
export function buildIntrospectionData(source: IntrospectSource | Tool[]): IntrospectionData {
  const { tools, prompts } = Array.isArray(source) ? { tools: source } : source;
  const data: IntrospectionData = { tools: {} };
  for (const tool of sortedByName(tools)) data.tools[tool.name] = toToolSnapshot(tool);
  if (prompts !== undefined) {
    data.prompts = {};
    for (const prompt of sortedByName(prompts))
      data.prompts[prompt.name] = toPromptSnapshot(prompt);
  }
  return data;
}

export interface IntrospectWarnings {
  externalRefTools: string[];
  missingOutputSchemaTools: string[];
}

/** Warn about tools with an external-URI $ref in inputSchema, and tools without outputSchema. */
export function collectWarnings(tools: Tool[]): IntrospectWarnings {
  const externalRefTools: string[] = [];
  const missingOutputSchemaTools: string[] = [];
  for (const tool of tools) {
    if (hasExternalRef(tool.inputSchema)) externalRefTools.push(tool.name);
    if (tool.outputSchema === undefined) missingOutputSchemaTools.push(tool.name);
  }
  return { externalRefTools, missingOutputSchemaTools };
}

function hasExternalRef(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasExternalRef);
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const ref = obj["$ref"];
    if (typeof ref === "string" && !ref.startsWith("#")) return true;
    return Object.values(obj).some(hasExternalRef);
  }
  return false;
}

function jsonReindented(value: unknown, indent: number): string {
  const s = JSON.stringify(value, null, 2);
  const pad = " ".repeat(indent);
  return s
    .split("\n")
    .map((line, i) => (i === 0 ? line : pad + line))
    .join("\n");
}

function buildJsDoc(lines: string[], indent: string): string | undefined {
  if (lines.length === 0) return undefined;
  const body = lines.map((l) => `${indent} * ${l.replace(/\*\//g, "*\\/")}`).join("\n");
  return `${indent}/**\n${body}\n${indent} */`;
}

function toolDocLines(tool: Tool): string[] {
  const lines: string[] = [];
  if (tool.title !== undefined) lines.push(tool.title);
  if (tool.description !== undefined) lines.push(tool.description);
  return lines;
}

// Argument descriptions are only in the JSDoc, as `@param` tags, so they show on hover without
// making a reworded description count as drift in `check`.
function promptDocLines(prompt: Prompt): string[] {
  const lines: string[] = [];
  if (prompt.title !== undefined) lines.push(prompt.title);
  if (prompt.description !== undefined) lines.push(prompt.description);
  for (const arg of prompt.arguments ?? []) {
    if (arg.description !== undefined) lines.push(`@param ${arg.name} ${arg.description}`);
  }
  return lines;
}

/** One `"name": {...}` member per item, each preceded by its JSDoc block when it has one. */
function formatMembers<T extends { name: string }>(
  items: T[],
  indent: string,
  toEntry: (item: T) => unknown,
  toDoc: (item: T) => string[],
): string {
  return sortedByName(items)
    .map((item) => {
      const doc = buildJsDoc(toDoc(item), indent);
      const line = `${indent}${JSON.stringify(item.name)}: ${jsonReindented(toEntry(item), indent.length)}`;
      return doc ? `${doc}\n${line}` : line;
    })
    .join(",\n");
}

export interface FormatDtsOptions {
  name?: string;
}

/** Emit the `.d.ts` snapshot text. The type literal itself is strict, quoted-key JSON,
 * so `snapshot.ts` can parse it back by stripping the header/JSDoc comments. Accepts a bare
 * `Tool[]` for callers that only have tools. */
export function formatDts(
  source: IntrospectSource | Tool[],
  meta: IntrospectMeta,
  opts: FormatDtsOptions = {},
): string {
  const { tools, prompts } = Array.isArray(source) ? { tools: source } : source;

  const header: string[] = ["// Generated by mcp-tada. Do not edit."];
  header.push(`// server: ${meta.serverName ?? "unknown"}@${meta.serverVersion ?? "unknown"}`);
  header.push(`// protocolVersion: ${meta.protocolVersion ?? "unknown"}`);
  header.push(`// capabilities.tools.listChanged: ${meta.toolsListChanged ?? false}`);
  if (meta.promptsListChanged !== undefined) {
    header.push(`// capabilities.prompts.listChanged: ${meta.promptsListChanged}`);
  }
  if (meta.ttlMs !== undefined) header.push(`// ttlMs: ${meta.ttlMs}`);
  if (meta.cacheScope !== undefined) header.push(`// cacheScope: ${meta.cacheScope}`);

  const indent = "    "; // member keys sit 4 spaces in (introspection = { tools: { <here> } })
  const exportName = opts.name;

  const parts = [
    header.join("\n"),
    "",
    "export type introspection = {",
    '  "tools": {',
    formatMembers(tools, indent, toToolSnapshot, toolDocLines),
  ];
  if (prompts !== undefined) {
    parts.push(
      "  },",
      '  "prompts": {',
      formatMembers(prompts, indent, toPromptSnapshot, promptDocLines),
    );
  }
  parts.push("  }", "};");
  if (exportName && exportName !== "introspection") {
    parts.push("", `export type ${exportName} = introspection;`);
  }
  parts.push("");
  return parts.join("\n");
}

/** Emit the raw introspection data (the same `{ tools: {...}, prompts?: {...} }` shape as the
 * `.d.ts` literal) as plain JSON, useful for `check` and other tooling. */
export function formatJson(source: IntrospectSource | Tool[]): string {
  return `${JSON.stringify(buildIntrospectionData(source), null, 2)}\n`;
}

export interface IntrospectOptions {
  target: ServerTarget;
  out?: string;
  name?: string;
  json?: boolean;
  verbose?: boolean;
  /** Set false to skip writing to disk (used by tests that only need the text/data). */
  write?: boolean;
}

export interface IntrospectRunResult {
  text: string;
  data: IntrospectionData;
  meta: IntrospectMeta;
  warnings: IntrospectWarnings;
  outPath: string;
  wrote: boolean;
}

const DEFAULT_OUT = "introspection.d.ts";

/** High-level entry used by both the CLI and tests: introspect one target and, by default,
 * write the snapshot to disk (skipping the write if the content is byte-identical). */
export async function introspect(opts: IntrospectOptions): Promise<IntrospectRunResult> {
  const { meta, ...source } = await introspectTarget(opts.target);
  const { tools } = source;

  const data = buildIntrospectionData(source);
  const warnings = collectWarnings(tools);
  reportWarnings(warnings, opts.verbose ?? false);

  const outPath = opts.out ?? (opts.json ? "introspection.json" : DEFAULT_OUT);
  const formatOpts: FormatDtsOptions = {};
  if (opts.name !== undefined) formatOpts.name = opts.name;
  const text = opts.json ? formatJson(source) : formatDts(source, meta, formatOpts);

  let wrote = false;
  if (opts.write ?? true) {
    wrote = writeIfChanged(outPath, text);
  }

  return { text, data, meta, warnings, outPath, wrote };
}

function reportWarnings(warnings: IntrospectWarnings, verbose: boolean): void {
  if (warnings.externalRefTools.length > 0) {
    if (verbose) {
      console.error(
        `mcp-tada: tools with external $ref in inputSchema: ${warnings.externalRefTools.join(", ")}`,
      );
    } else {
      console.error(
        `mcp-tada: ${warnings.externalRefTools.length} tool(s) use an external $ref in inputSchema (--verbose for names)`,
      );
    }
  }
  if (warnings.missingOutputSchemaTools.length > 0) {
    if (verbose) {
      console.error(
        `mcp-tada: tools without outputSchema: ${warnings.missingOutputSchemaTools.join(", ")}`,
      );
    } else {
      console.error(
        `mcp-tada: ${warnings.missingOutputSchemaTools.length} tool(s) have no outputSchema (--verbose for names)`,
      );
    }
  }
}

/** Write `text` to `path` unless it is already there with identical content. Returns true if written. */
export function writeIfChanged(path: string, text: string): boolean {
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing === text) {
      console.log(`unchanged: ${path}`);
      return false;
    }
  }
  const dir = dirname(path);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, text);
  console.log(`wrote: ${path}`);
  return true;
}
