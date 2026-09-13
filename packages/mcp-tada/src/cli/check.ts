// `mcp-tada check`: re-introspect a live server and diff it against a previously generated
// snapshot (a `.d.ts` from `introspect`, or a `--json` dump).
//
// Every difference gets a severity: additive (code written against the snapshot keeps working),
// dangerous (it keeps working but a behavioural guarantee was withdrawn), or breaking. CI picks
// the threshold with `--fail-on`. The schema-level rules live in `compat.ts`.
import { readFileSync } from "node:fs";
import {
  bySeverity,
  compareSchemas,
  deepEqual,
  diffKeys,
  worstOf,
  type SchemaChange,
  type Severity,
} from "./compat.js";
import type { ServerTarget } from "./connect.js";
import { buildIntrospectionData, introspectTarget } from "./introspect.js";
import {
  detectFormat,
  parseSnapshotText,
  type IntrospectionData,
  type PromptArgumentSnapshot,
  type ToolAnnotationsSnapshot,
} from "./snapshot.js";

export type { Severity } from "./compat.js";

export interface CheckOptions {
  target: ServerTarget;
  against: string;
}

/** What kind of thing changed, for a consumer that wants to group or filter `changes`. */
export type CheckChangeKind =
  | "toolAdded"
  | "toolRemoved"
  | "inputSchema"
  | "outputSchemaAppeared"
  | "outputSchemaDisappeared"
  | "outputSchema"
  | "annotations"
  | "promptAdded"
  | "promptRemoved"
  | "promptArguments"
  | "resourceAdded"
  | "resourceRemoved"
  | "resourceChanged"
  | "resourceTemplateAdded"
  | "resourceTemplateRemoved"
  | "resourceTemplateChanged";

export interface CheckChange {
  kind: CheckChangeKind;
  /** The tool, prompt, or template name, or the resource URI, the change belongs to. */
  subject: string;
  severity: Severity;
  /** One line describing the change, e.g. `removed tool` or `inputSchema changed`. */
  summary: string;
  /** Why, one entry per underlying difference, worst first. Empty when `summary` says it all. */
  reasons: string[];
}

export interface CheckReport {
  added: string[];
  removed: string[];
  inputChanged: string[];
  outputAppeared: string[];
  outputDisappeared: string[];
  outputChanged: string[];
  /** Tools whose `annotations` differ in any way (appeared, disappeared, or changed). */
  annotationsChanged: string[];
  /** The subset of `annotationsChanged` where a tool withdrew a safety guarantee; see `SAFETY_HINTS`. */
  safetyWeakened: string[];
  promptsAdded: string[];
  promptsRemoved: string[];
  /** Prompts whose argument list (names, order, or `required` flags) changed. */
  promptsChanged: string[];
  resourcesAdded: string[];
  resourcesRemoved: string[];
  /** Static resources whose `name` or `mimeType` changed. */
  resourcesChanged: string[];
  resourceTemplatesAdded: string[];
  resourceTemplatesRemoved: string[];
  /** Templates whose `uriTemplate` or `mimeType` changed. */
  resourceTemplatesChanged: string[];
  /** Every difference, classified. Ordered worst first, then by subject. */
  changes: CheckChange[];
  /** The worst severity among `changes`; `additive` when there are none (see `identical`). */
  severity: Severity;
  identical: boolean;
}

export interface CheckRunResult {
  report: CheckReport;
  text: string;
}

/** Re-introspect `opts.target` live and diff it against the snapshot at `opts.against`. */
export async function check(opts: CheckOptions): Promise<CheckRunResult> {
  const snapshotText = readFileSync(opts.against, "utf8");
  const snapshot = parseSnapshotText(snapshotText, detectFormat(opts.against));
  const { meta: _meta, ...source } = await introspectTarget(opts.target);
  const live = buildIntrospectionData(source);
  const report = diffIntrospection(snapshot, live);
  const text = formatReport(report, opts.against);
  return { report, text };
}

export function diffIntrospection(
  before: IntrospectionData,
  after: IntrospectionData,
): CheckReport {
  const changes: CheckChange[] = [];
  const push = (
    kind: CheckChangeKind,
    subject: string,
    summary: string,
    severity: Severity,
    details: Detail[] = [],
  ): void => {
    changes.push({ kind, subject, severity, summary, reasons: formatDetails(details, severity) });
  };
  /** A schema-level diff; no entries means only documentation keywords or set order differed. */
  const pushSchema = (kind: CheckChangeKind, subject: string, details: SchemaChange[]): void => {
    if (details.length === 0) {
      push(kind, subject, `${kind} changed`, "additive", [
        { severity: "additive", message: "documentation or ordering only" },
      ]);
    } else {
      push(kind, subject, `${kind} changed`, worstOf(details), details);
    }
  };

  const tools = diffKeys(before.tools, after.tools);
  for (const name of tools.added) push("toolAdded", name, "added tool", "additive");
  for (const name of tools.removed) push("toolRemoved", name, "removed tool", "breaking");
  for (const name of tools.common) {
    const b = before.tools[name];
    const a = after.tools[name];
    if (!b || !a) continue;
    if (!deepEqual(b.inputSchema, a.inputSchema)) {
      pushSchema("inputSchema", name, compareSchemas(b.inputSchema, a.inputSchema, "input"));
    }
    if (b.outputSchema === undefined && a.outputSchema !== undefined) {
      push("outputSchemaAppeared", name, "outputSchema appeared", "additive");
    } else if (b.outputSchema !== undefined && a.outputSchema === undefined) {
      push("outputSchemaDisappeared", name, "outputSchema disappeared", "breaking");
    } else if (!deepEqual(b.outputSchema, a.outputSchema)) {
      pushSchema("outputSchema", name, compareSchemas(b.outputSchema, a.outputSchema, "output"));
    }
    if (!deepEqual(b.annotations, a.annotations)) {
      const weakened = weakenedHints(b.annotations, a.annotations);
      if (weakened.length > 0) {
        push("annotations", name, "lost a safety guarantee", "dangerous", weakened);
      } else {
        push("annotations", name, "annotations changed", "additive");
      }
    }
  }

  // A snapshot taken before prompts were recorded, or of a server without the capability, has
  // no `prompts` key; diffing it as empty means a live server's prompts show up as added, which
  // is the honest answer (regenerating the snapshot resolves it).
  const beforePrompts = before.prompts ?? {};
  const afterPrompts = after.prompts ?? {};
  const prompts = diffKeys(beforePrompts, afterPrompts);
  for (const name of prompts.added) push("promptAdded", name, "added prompt", "additive");
  for (const name of prompts.removed) push("promptRemoved", name, "removed prompt", "breaking");
  for (const name of prompts.common) {
    const b = beforePrompts[name];
    const a = afterPrompts[name];
    if (!b || !a || deepEqual(b, a)) continue;
    const details = promptArgumentChanges(b.arguments, a.arguments);
    push("promptArguments", name, "prompt arguments changed", worstOf(details), details);
  }

  // Resources follow the prompts policy: a snapshot without the keys diffs as empty.
  const beforeResources = before.resources ?? {};
  const afterResources = after.resources ?? {};
  const resources = diffKeys(beforeResources, afterResources);
  for (const uri of resources.added) push("resourceAdded", uri, "added resource", "additive");
  for (const uri of resources.removed) push("resourceRemoved", uri, "removed resource", "breaking");
  for (const uri of resources.common) {
    const b = beforeResources[uri];
    const a = afterResources[uri];
    if (!b || !a || deepEqual(b, a)) continue;
    const details: Detail[] = [];
    if (b.mimeType !== a.mimeType) details.push(mimeTypeChange(b.mimeType, a.mimeType));
    if (b.name !== a.name)
      details.push({ severity: "additive", message: `name is now ${JSON.stringify(a.name)}` });
    push("resourceChanged", uri, "resource changed", worstOf(details), details);
  }

  const beforeTemplates = before.resourceTemplates ?? {};
  const afterTemplates = after.resourceTemplates ?? {};
  const templates = diffKeys(beforeTemplates, afterTemplates);
  for (const name of templates.added)
    push("resourceTemplateAdded", name, "added resource template", "additive");
  for (const name of templates.removed)
    push("resourceTemplateRemoved", name, "removed resource template", "breaking");
  for (const name of templates.common) {
    const b = beforeTemplates[name];
    const a = afterTemplates[name];
    if (!b || !a || deepEqual(b, a)) continue;
    const details: Detail[] = [];
    // The variables a caller passes come from the template string, so any edit to it can
    // invalidate a typed call; there is no cheap way to tell a widening from a narrowing.
    if (b.uriTemplate !== a.uriTemplate)
      details.push({
        severity: "breaking",
        message: `uriTemplate is now ${JSON.stringify(a.uriTemplate)}`,
      });
    if (b.mimeType !== a.mimeType) details.push(mimeTypeChange(b.mimeType, a.mimeType));
    push("resourceTemplateChanged", name, "resource template changed", worstOf(details), details);
  }

  const subjects = (...kinds: CheckChangeKind[]): string[] =>
    changes
      .filter((c) => kinds.includes(c.kind))
      .map((c) => c.subject)
      .sort();

  return {
    added: subjects("toolAdded"),
    removed: subjects("toolRemoved"),
    inputChanged: subjects("inputSchema"),
    outputAppeared: subjects("outputSchemaAppeared"),
    outputDisappeared: subjects("outputSchemaDisappeared"),
    outputChanged: subjects("outputSchemaAppeared", "outputSchemaDisappeared", "outputSchema"),
    annotationsChanged: subjects("annotations"),
    safetyWeakened: changes
      .filter((c) => c.kind === "annotations" && c.severity === "dangerous")
      .map((c) => c.subject),
    promptsAdded: subjects("promptAdded"),
    promptsRemoved: subjects("promptRemoved"),
    promptsChanged: subjects("promptArguments"),
    resourcesAdded: subjects("resourceAdded"),
    resourcesRemoved: subjects("resourceRemoved"),
    resourcesChanged: subjects("resourceChanged"),
    resourceTemplatesAdded: subjects("resourceTemplateAdded"),
    resourceTemplatesRemoved: subjects("resourceTemplateRemoved"),
    resourceTemplatesChanged: subjects("resourceTemplateChanged"),
    changes: [...changes].sort(
      (a, b) =>
        bySeverity(a, b) || a.subject.localeCompare(b.subject) || a.kind.localeCompare(b.kind),
    ),
    severity: worstOf(changes),
    identical: changes.length === 0,
  };
}

/** One underlying difference behind a `CheckChange`; `path` is prefixed when present. */
interface Detail {
  severity: Severity;
  message: string;
  path?: string;
}

/** Worst first; when the change as a whole is not additive, the additive lines say so. */
function formatDetails(details: Detail[], severity: Severity): string[] {
  return [...details].sort(bySeverity).map((d) => {
    const text =
      d.path === undefined ? d.message : `${d.path === "" ? "(root)" : d.path}: ${d.message}`;
    return severity !== "additive" && d.severity === "additive" ? `${text} (additive)` : text;
  });
}

/**
 * The annotations that promise something about a tool's behaviour, and the value that makes the
 * promise. Going from that value to anything else withdraws it.
 */
const SAFETY_HINTS: ReadonlyArray<{ hint: string; safe: boolean }> = [
  { hint: "readOnlyHint", safe: true },
  { hint: "destructiveHint", safe: false },
  { hint: "idempotentHint", safe: true },
  { hint: "openWorldHint", safe: false },
];

function weakenedHints(
  before: ToolAnnotationsSnapshot | undefined,
  after: ToolAnnotationsSnapshot | undefined,
): Detail[] {
  return SAFETY_HINTS.filter(
    ({ hint, safe }) => before?.[hint] === safe && after?.[hint] !== safe,
  ).map(({ hint, safe }) => ({ severity: "dangerous", message: `${hint} is no longer ${safe}` }));
}

// A recorded `mimeType` is what `readResource`'s contents are typed with. Gaining one where
// there was none narrows `string` to a literal, which existing code still satisfies; losing or
// changing one does not.
function mimeTypeChange(before: string | undefined, after: string | undefined): Detail {
  if (before === undefined) {
    return { severity: "additive", message: `mimeType is now ${JSON.stringify(after)}` };
  }
  return {
    severity: "breaking",
    message:
      after === undefined
        ? `mimeType ${JSON.stringify(before)} is no longer declared`
        : `mimeType is now ${JSON.stringify(after)}, was ${JSON.stringify(before)}`,
  };
}

/** Prompt arguments are passed by name, so only the name set and the required flags matter. */
function promptArgumentChanges(
  before: PromptArgumentSnapshot[],
  after: PromptArgumentSnapshot[],
): Detail[] {
  const b = Object.fromEntries(before.map((arg) => [arg.name, arg.required === true]));
  const a = Object.fromEntries(after.map((arg) => [arg.name, arg.required === true]));
  const { added, removed, common } = diffKeys(b, a);
  const details: Detail[] = [];
  for (const name of added) {
    details.push({
      path: name,
      severity: a[name] ? "breaking" : "additive",
      message: a[name] ? "new required argument" : "new optional argument",
    });
  }
  for (const name of common) {
    if (a[name] === b[name]) continue;
    details.push({
      path: name,
      severity: a[name] ? "breaking" : "additive",
      message: a[name] ? "is now required" : "is no longer required",
    });
  }
  for (const name of removed)
    details.push({ path: name, severity: "breaking", message: "argument removed" });
  // Same names and flags in a different order: nothing a caller can observe.
  if (details.length === 0)
    details.push({ severity: "additive", message: "argument order changed" });
  return details;
}

/** How many `reasons` lines a single change is allowed before the rest are summarized. */
const MAX_REASON_LINES = 6;

/** Report sections, worst first. */
const SEVERITIES: readonly Severity[] = ["breaking", "dangerous", "additive"];

export function formatReport(report: CheckReport, against: string): string {
  if (report.identical) {
    return `mcp-tada check: no differences from ${against}\n`;
  }
  const groups = SEVERITIES.map((severity) => ({
    severity,
    changes: report.changes.filter((c) => c.severity === severity),
  })).filter((g) => g.changes.length > 0);
  const counts = groups.map((g) => `${g.changes.length} ${g.severity}`).join(", ");
  const lines: string[] = [`mcp-tada check: differences from ${against} (${counts})`];
  for (const group of groups) {
    lines.push(`  ${group.severity}:`);
    for (const change of group.changes) lines.push(...formatChange(change));
  }
  lines.push("");
  return lines.join("\n");
}

function formatChange(change: CheckChange): string[] {
  const lines = [`    ${change.subject}: ${change.summary}`];
  for (const reason of change.reasons.slice(0, MAX_REASON_LINES)) lines.push(`      ${reason}`);
  const hidden = change.reasons.length - MAX_REASON_LINES;
  if (hidden > 0) lines.push(`      ... and ${hidden} more difference${hidden === 1 ? "" : "s"}`);
  return lines;
}
