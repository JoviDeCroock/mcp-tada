// Connects to an MCP server, pages through tools/list (plus prompts/list, resources/list, and
// resources/templates/list when the server declares those capabilities), and emits either a
// typed `introspection.d.ts` snapshot or the raw data as JSON.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  listAllPrompts,
  listAllResourceTemplates,
  listAllResources,
  listAllTools,
} from "../list.js";
import type { Prompt, Resource, ResourceTemplate, Tool } from "../wire.js";
import { connectClient, withTimeoutWrapping, type ServerTarget } from "./connect.js";
import type {
  IntrospectionData,
  PromptSnapshot,
  ResourceSnapshot,
  ResourceTemplateSnapshot,
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
  /** Set when the server declares the `resources` capability. */
  resourcesListChanged?: boolean;
  /** Read defensively: the 2026-07-28 spec revision adds server-controlled result caching hints
   * to `tools/list`, but a server only sends them on a connection that negotiated that revision,
   * and the CLI uses the legacy handshake unless protocol selection opts in. */
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

/** What `introspectTarget` read from a server: every tool; every prompt when the server
 * declares the `prompts` capability; and every static resource and resource template when it
 * declares `resources` (`undefined` when it does not, so a snapshot of such a server has no
 * key for them at all). */
export interface IntrospectSource {
  tools: Tool[];
  prompts?: Prompt[];
  resources?: Resource[];
  resourceTemplates?: ResourceTemplate[];
}

/** Connect, page through tools/list (and prompts/list when offered) until nextCursor is
 * exhausted, then disconnect. */
export async function introspectTarget(
  target: ServerTarget,
): Promise<IntrospectSource & { meta: IntrospectMeta }> {
  const connected = await connectClient(target);
  const { client } = connected;
  try {
    const caps = client.getServerCapabilities();
    const version = client.getServerVersion();
    let lastRaw: RawToolListResult | undefined;
    const listOptions = target.timeoutMs !== undefined ? { timeout: target.timeoutMs } : undefined;
    const tools = await withTimeoutWrapping(target, connected, () =>
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
        prompts = await withTimeoutWrapping(target, connected, () =>
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
    let resources: Resource[] | undefined;
    let resourceTemplates: ResourceTemplate[] | undefined;
    if (caps?.resources !== undefined) {
      try {
        resources = await withTimeoutWrapping(target, connected, () =>
          listAllResources((params) => client.listResources(params, listOptions)),
        );
        resourceTemplates = await withTimeoutWrapping(target, connected, () =>
          listAllResourceTemplates((params) => client.listResourceTemplates(params, listOptions)),
        );
      } catch (err) {
        // Same policy as prompts: both keys are omitted together, so a partial read never
        // masquerades as "this server has resources but no templates".
        resources = undefined;
        resourceTemplates = undefined;
        console.error(
          `mcp-tada: resources/list failed, snapshot will not include resources: ${(err as Error).message}`,
        );
      }
    }

    const meta: IntrospectMeta = {};
    if (version?.name !== undefined) meta.serverName = version.name;
    if (version?.version !== undefined) meta.serverVersion = version.version;
    if (caps?.tools?.listChanged !== undefined) meta.toolsListChanged = caps.tools.listChanged;
    if (caps?.prompts !== undefined) meta.promptsListChanged = caps.prompts.listChanged ?? false;
    if (caps?.resources !== undefined)
      meta.resourcesListChanged = caps.resources.listChanged ?? false;
    if (lastRaw?.ttlMs !== undefined) meta.ttlMs = lastRaw.ttlMs;
    if (lastRaw?.cacheScope !== undefined) meta.cacheScope = lastRaw.cacheScope;
    if (connected.protocolVersion !== undefined) meta.protocolVersion = connected.protocolVersion;
    const source: IntrospectSource & { meta: IntrospectMeta } = { tools, meta };
    if (prompts !== undefined) source.prompts = prompts;
    if (resources !== undefined && resourceTemplates !== undefined) {
      source.resources = resources;
      source.resourceTemplates = resourceTemplates;
    }
    return source;
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

/** The snapshot entry for one static resource, keyed by URI: its `name` and, when the server
 * sent one, its `mimeType`. Description and title live in the JSDoc block. */
export function toResourceSnapshot(resource: Resource): ResourceSnapshot {
  const entry: ResourceSnapshot = { name: resource.name };
  if (resource.mimeType !== undefined) entry.mimeType = resource.mimeType;
  return entry;
}

/** The snapshot entry for one resource template, keyed by name: its `uriTemplate` and, when
 * the server sent one, its `mimeType`. */
export function toResourceTemplateSnapshot(template: ResourceTemplate): ResourceTemplateSnapshot {
  const entry: ResourceTemplateSnapshot = { uriTemplate: template.uriTemplate };
  if (template.mimeType !== undefined) entry.mimeType = template.mimeType;
  return entry;
}

/** Sort by key, keeping the last definition when a server lists a key twice. */
function sortedBy<T>(items: T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(key(item), item);
  return [...byKey.keys()].sort().map((k) => byKey.get(k) as T);
}

const byName = <T extends { name: string }>(item: T): string => item.name;
const byUri = <T extends { uri: string }>(item: T): string => item.uri;

/** Sort by name, keeping the last definition when a server lists a name twice. */
function sortedByName<T extends { name: string }>(items: T[]): T[] {
  return sortedBy(items, byName);
}

/** Build the sorted, keyed snapshot data: `tools` as `{ inputSchema, outputSchema?,
 * annotations? }`, `prompts` as `{ arguments }`, `resources` (by URI) as `{ name, mimeType? }`,
 * and `resourceTemplates` (by name) as `{ uriTemplate, mimeType? }`, each map only when the
 * source has it. Accepts a bare `Tool[]` for callers that only have tools. */
export function buildIntrospectionData(source: IntrospectSource | Tool[]): IntrospectionData {
  const { tools, prompts, resources, resourceTemplates } = Array.isArray(source)
    ? { tools: source }
    : source;
  const data: IntrospectionData = { tools: {} };
  for (const tool of sortedByName(tools)) data.tools[tool.name] = toToolSnapshot(tool);
  if (prompts !== undefined) {
    data.prompts = {};
    for (const prompt of sortedByName(prompts))
      data.prompts[prompt.name] = toPromptSnapshot(prompt);
  }
  if (resources !== undefined) {
    data.resources = {};
    for (const resource of sortedBy(resources, byUri))
      data.resources[resource.uri] = toResourceSnapshot(resource);
  }
  if (resourceTemplates !== undefined) {
    data.resourceTemplates = {};
    for (const template of sortedByName(resourceTemplates))
      data.resourceTemplates[template.name] = toResourceTemplateSnapshot(template);
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

// Every physical line gets its own ` * ` prefix, so a multi-line description still reads as one
// JSDoc block instead of leaving bare lines inside the comment.
function buildJsDoc(lines: string[], indent: string): string | undefined {
  if (lines.length === 0) return undefined;
  const body = lines
    .flatMap((l) => l.replace(/\*\//g, "*\\/").split("\n"))
    .map((l) => (l === "" ? `${indent} *` : `${indent} * ${l}`))
    .join("\n");
  return `${indent}/**\n${body}\n${indent} */`;
}

// The description of each top-level `inputSchema` property, in schema order. Nested schemas
// are not walked: the tags document the `args` object as the caller writes it.
function argumentDescriptions(inputSchema: unknown): Array<[name: string, description: string]> {
  const out: Array<[string, string]> = [];
  if (typeof inputSchema !== "object" || inputSchema === null) return out;
  const properties = (inputSchema as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return out;
  for (const [name, schema] of Object.entries(properties as Record<string, unknown>)) {
    if (typeof schema !== "object" || schema === null) continue;
    const description = (schema as { description?: unknown }).description;
    if (typeof description === "string" && description !== "") out.push([name, description]);
  }
  return out;
}

// The tool's JSDoc is the only documentation that reaches an editor: `mcp.tools.<name>` maps
// homomorphically over the snapshot so hover shows this block, whereas the `description`
// strings inside `inputSchema` are plain type-level values TypeScript cannot surface. The
// argument descriptions are therefore repeated here as `@param args.<name>` tags. `check`
// ignores JSDoc, so a reworded description is not drift.
function toolDocLines(tool: Tool): string[] {
  const lines: string[] = [];
  // The spec has top-level `title` win over `annotations.title`; older servers only set the latter.
  const title = tool.title ?? tool.annotations?.title;
  if (title !== undefined) lines.push(title);
  if (tool.description !== undefined) lines.push(tool.description);
  for (const [name, description] of argumentDescriptions(tool.inputSchema)) {
    lines.push(`@param args.${name} ${description}`);
  }
  return lines;
}

// Prompt argument descriptions live only in the JSDoc, as `@param` tags: the snapshot entry
// records just `{ name, required }`, so a reworded description is not drift in `check`.
function promptDocLines(prompt: Prompt): string[] {
  const lines: string[] = [];
  if (prompt.title !== undefined) lines.push(prompt.title);
  if (prompt.description !== undefined) lines.push(prompt.description);
  for (const arg of prompt.arguments ?? []) {
    if (arg.description !== undefined) lines.push(`@param ${arg.name} ${arg.description}`);
  }
  return lines;
}

// A resource's or template's JSDoc: title, then description. `mimeType` is in the entry itself.
function resourceDocLines(item: {
  title?: string | undefined;
  description?: string | undefined;
}): string[] {
  const lines: string[] = [];
  if (item.title !== undefined) lines.push(item.title);
  if (item.description !== undefined) lines.push(item.description);
  return lines;
}

/** One `"key": {...}` member per item, each preceded by its JSDoc block when it has one. */
function formatMembers<T>(
  items: T[],
  indent: string,
  key: (item: T) => string,
  toEntry: (item: T) => unknown,
  toDoc: (item: T) => string[],
): string {
  return sortedBy(items, key)
    .map((item) => {
      const doc = buildJsDoc(toDoc(item), indent);
      const line = `${indent}${JSON.stringify(key(item))}: ${jsonReindented(toEntry(item), indent.length)}`;
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
  const { tools, prompts, resources, resourceTemplates } = Array.isArray(source)
    ? { tools: source }
    : source;

  // The type literal must stay strict JSON for `parseDtsSnapshot`. Prettier (and oxfmt) would
  // otherwise unquote every key, so the file opts out of formatting and linting up front.
  const header: string[] = ["/* eslint-disable */", "// Generated by mcp-tada. Do not edit."];
  header.push(`// server: ${meta.serverName ?? "unknown"}@${meta.serverVersion ?? "unknown"}`);
  // Only the streamable HTTP transport exposes the negotiated version; the line is omitted
  // rather than printing "unknown" for stdio servers.
  if (meta.protocolVersion !== undefined)
    header.push(`// protocolVersion: ${meta.protocolVersion}`);
  header.push(`// capabilities.tools.listChanged: ${meta.toolsListChanged ?? false}`);
  if (meta.promptsListChanged !== undefined) {
    header.push(`// capabilities.prompts.listChanged: ${meta.promptsListChanged}`);
  }
  if (meta.resourcesListChanged !== undefined) {
    header.push(`// capabilities.resources.listChanged: ${meta.resourcesListChanged}`);
  }
  if (meta.ttlMs !== undefined) header.push(`// ttlMs: ${meta.ttlMs}`);
  if (meta.cacheScope !== undefined) header.push(`// cacheScope: ${meta.cacheScope}`);

  const indent = "    "; // member keys sit 4 spaces in (introspection = { tools: { <here> } })
  const exportName = opts.name;

  const parts = [
    header.join("\n"),
    "",
    "/* prettier-ignore */",
    "export type introspection = {",
    '  "tools": {',
    formatMembers(tools, indent, byName, toToolSnapshot, toolDocLines),
  ];
  if (prompts !== undefined) {
    parts.push(
      "  },",
      '  "prompts": {',
      formatMembers(prompts, indent, byName, toPromptSnapshot, promptDocLines),
    );
  }
  if (resources !== undefined) {
    parts.push(
      "  },",
      '  "resources": {',
      formatMembers(resources, indent, byUri, toResourceSnapshot, resourceDocLines),
    );
  }
  if (resourceTemplates !== undefined) {
    parts.push(
      "  },",
      '  "resourceTemplates": {',
      formatMembers(
        resourceTemplates,
        indent,
        byName,
        toResourceTemplateSnapshot,
        resourceDocLines,
      ),
    );
  }
  parts.push("  }", "};");
  if (exportName && exportName !== "introspection") {
    parts.push("", `export type ${exportName} = introspection;`);
  }
  parts.push("");
  return parts.join("\n");
}

/** Emit the raw introspection data (the same `{ tools, prompts?, resources?, resourceTemplates? }`
 * shape as the `.d.ts` literal) as plain JSON, useful for `check` and other tooling. */
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
  if (opts.json && outPath.endsWith(".d.ts")) {
    throw new Error(
      `mcp-tada introspect: --json writes raw JSON, which would corrupt the .d.ts at ${outPath}; use a .json output path or drop --json`,
    );
  }
  if (!opts.json && outPath.endsWith(".json")) {
    throw new Error(
      `mcp-tada introspect: the .d.ts snapshot would be written to ${outPath}; pass --json for JSON output or use a .d.ts output path`,
    );
  }
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
