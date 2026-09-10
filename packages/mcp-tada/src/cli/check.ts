// `mcp-tada check`: re-introspect a live server and diff it against a previously generated
// snapshot (a `.d.ts` from `introspect`, or a `--json` dump).
import { readFileSync } from "node:fs";
import type { ServerTarget } from "./connect.js";
import { buildIntrospectionData, introspectTarget } from "./introspect.js";
import { detectFormat, parseSnapshotText, type IntrospectionData } from "./snapshot.js";

export interface CheckOptions {
  target: ServerTarget;
  against: string;
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
  /** The subset of `annotationsChanged` where a tool lost a safety guarantee: `readOnlyHint`
   * went from `true` to anything else, or `destructiveHint` went from `false` to anything else. */
  safetyWeakened: string[];
  promptsAdded: string[];
  promptsRemoved: string[];
  /** Prompts whose argument list (names, order, or `required` flags) changed. */
  promptsChanged: string[];
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
  const beforeNames = Object.keys(before.tools).sort();
  const afterNames = Object.keys(after.tools).sort();
  const beforeSet = new Set(beforeNames);
  const afterSet = new Set(afterNames);

  const added = afterNames.filter((n) => !beforeSet.has(n));
  const removed = beforeNames.filter((n) => !afterSet.has(n));

  const inputChanged: string[] = [];
  const outputAppeared: string[] = [];
  const outputDisappeared: string[] = [];
  const outputChangedInPlace: string[] = [];
  const annotationsChanged: string[] = [];
  const safetyWeakened: string[] = [];

  for (const name of afterNames) {
    if (!beforeSet.has(name)) continue;
    const b = before.tools[name];
    const a = after.tools[name];
    if (!b || !a) continue;
    if (!deepEqual(b.inputSchema, a.inputSchema)) inputChanged.push(name);

    const bHasOut = b.outputSchema !== undefined;
    const aHasOut = a.outputSchema !== undefined;
    if (!bHasOut && aHasOut) outputAppeared.push(name);
    else if (bHasOut && !aHasOut) outputDisappeared.push(name);
    else if (bHasOut && aHasOut && !deepEqual(b.outputSchema, a.outputSchema)) {
      outputChangedInPlace.push(name);
    }

    if (!deepEqual(b.annotations, a.annotations)) {
      annotationsChanged.push(name);
      if (
        (b.annotations?.readOnlyHint === true && a.annotations?.readOnlyHint !== true) ||
        (b.annotations?.destructiveHint === false && a.annotations?.destructiveHint !== false)
      ) {
        safetyWeakened.push(name);
      }
    }
  }

  const outputChanged = [...outputAppeared, ...outputDisappeared, ...outputChangedInPlace].sort();

  // A snapshot taken before prompts were recorded, or of a server without the capability, has
  // no `prompts` key; diffing it as empty means a live server's prompts show up as added, which
  // is the honest answer (regenerating the snapshot resolves it).
  const beforePrompts = before.prompts ?? {};
  const afterPrompts = after.prompts ?? {};
  const beforePromptNames = Object.keys(beforePrompts).sort();
  const afterPromptNames = Object.keys(afterPrompts).sort();
  const promptsAdded = afterPromptNames.filter((n) => !(n in beforePrompts));
  const promptsRemoved = beforePromptNames.filter((n) => !(n in afterPrompts));
  const promptsChanged = afterPromptNames.filter(
    (n) => n in beforePrompts && !deepEqual(beforePrompts[n], afterPrompts[n]),
  );

  const identical =
    added.length === 0 &&
    removed.length === 0 &&
    inputChanged.length === 0 &&
    outputChanged.length === 0 &&
    annotationsChanged.length === 0 &&
    promptsAdded.length === 0 &&
    promptsRemoved.length === 0 &&
    promptsChanged.length === 0;

  return {
    added,
    removed,
    inputChanged,
    outputAppeared,
    outputDisappeared,
    outputChanged,
    annotationsChanged,
    safetyWeakened,
    promptsAdded,
    promptsRemoved,
    promptsChanged,
    identical,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
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

export function formatReport(report: CheckReport, against: string): string {
  if (report.identical) {
    return `mcp-tada check: no differences from ${against}\n`;
  }
  const lines: string[] = [`mcp-tada check: differences from ${against}`];
  if (report.added.length > 0) lines.push(`  added tools: ${report.added.join(", ")}`);
  if (report.removed.length > 0) lines.push(`  removed tools: ${report.removed.join(", ")}`);
  if (report.inputChanged.length > 0) {
    lines.push(`  inputSchema changed: ${report.inputChanged.join(", ")}`);
  }
  if (report.outputAppeared.length > 0) {
    lines.push(`  outputSchema appeared: ${report.outputAppeared.join(", ")}`);
  }
  if (report.outputDisappeared.length > 0) {
    lines.push(`  outputSchema disappeared: ${report.outputDisappeared.join(", ")}`);
  }
  if (report.outputChanged.length > 0) {
    lines.push(`  outputSchema changed: ${report.outputChanged.join(", ")}`);
  }
  if (report.annotationsChanged.length > 0) {
    lines.push(`  annotations changed: ${report.annotationsChanged.join(", ")}`);
  }
  if (report.safetyWeakened.length > 0) {
    lines.push(`  no longer read-only or non-destructive: ${report.safetyWeakened.join(", ")}`);
  }
  if (report.promptsAdded.length > 0) {
    lines.push(`  added prompts: ${report.promptsAdded.join(", ")}`);
  }
  if (report.promptsRemoved.length > 0) {
    lines.push(`  removed prompts: ${report.promptsRemoved.join(", ")}`);
  }
  if (report.promptsChanged.length > 0) {
    lines.push(`  prompt arguments changed: ${report.promptsChanged.join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}
