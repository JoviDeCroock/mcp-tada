// `mcp-tada doctor`: the setup checks people otherwise discover one failed command at a time.
// Installed package versions, the config file, each server's snapshot, and (unless offline)
// whether each server answers and still matches its snapshot.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  DEFAULT_TIMEOUT_MS,
  loadConfig,
  type McpTadaConfig,
  type ServerConfigEntry,
  type ServerTarget,
} from "./connect.js";
import { diffIntrospection } from "./check.js";
import { DEFAULT_CONFIG_PATH } from "./init.js";
import { buildIntrospectionData, introspectTarget } from "./introspect.js";
import { detectFormat, parseSnapshotText } from "./snapshot.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorStatus;
  /** What was checked, e.g. `@modelcontextprotocol/sdk` or a server alias. */
  subject: string;
  detail: string;
}

export interface DoctorOptions {
  /** Directory the config and snapshots are resolved from, and packages are resolved for.
   * Defaults to `process.cwd()`. */
  cwd?: string;
  /** Config path, relative to `cwd`. Defaults to `mcp-tada.config.json`. */
  configPath?: string;
  /** Set false to skip connecting to the configured servers. */
  connect?: boolean;
  /** Connect and list timeout for the reachability check; a server's `timeoutMs` wins when set. */
  timeoutMs?: number;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** False when any check failed. Warnings do not affect it. */
  ok: boolean;
  text: string;
}

/** Minimum SDK the client is tested against; matches the `peerDependencies` range. */
export const MIN_SDK_VERSION = "1.20.0";
/** `const` type parameters, which the server package relies on, arrived in TypeScript 5.0;
 * 5.4 is the tested floor and the `peerDependencies` range. */
export const MIN_TYPESCRIPT_VERSION = "5.4.0";

/** `a` is at least `b`, comparing the leading `major.minor.patch` of each. */
export function versionAtLeast(a: string, b: string): boolean {
  const parse = (v: string) => (v.match(/^(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1, 4).map(Number);
  const [am = 0, an = 0, ap = 0] = parse(a);
  const [bm = 0, bn = 0, bp = 0] = parse(b);
  return am !== bm ? am > bm : an !== bn ? an > bn : ap >= bp;
}

/** Version of `name` as installed for `cwd`, or `undefined` when it is not. Looks for
 * `node_modules/<name>/package.json` in `cwd` and each parent, the same directories Node's
 * resolver would search, but reads the manifest directly since the SDK does not export it. */
export function installedVersion(name: string, cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { version?: string };
        if (typeof pkg.version === "string") return pkg.version;
      } catch {
        // unreadable manifest; keep looking further up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function toTarget(entry: ServerConfigEntry, timeoutMs: number | undefined): ServerTarget {
  const target: ServerTarget = {};
  if (entry.command !== undefined) target.command = entry.command;
  if (entry.args !== undefined) target.args = entry.args;
  if (entry.env !== undefined) target.env = entry.env;
  if (entry.url !== undefined) target.url = entry.url;
  if (entry.headers !== undefined) target.headers = entry.headers;
  target.timeoutMs = entry.timeoutMs ?? timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return target;
}

export async function doctor(opts: DoctorOptions = {}): Promise<DoctorResult> {
  const cwd = opts.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];
  const push = (status: DoctorStatus, subject: string, detail: string) =>
    checks.push({ status, subject, detail });

  const sdk = installedVersion("@modelcontextprotocol/sdk", cwd);
  if (sdk === undefined) {
    push(
      "fail",
      "@modelcontextprotocol/sdk",
      "not installed (it is a peer dependency of mcp-tada)",
    );
  } else if (!versionAtLeast(sdk, MIN_SDK_VERSION)) {
    push(
      "warn",
      "@modelcontextprotocol/sdk",
      `${sdk} installed, ${MIN_SDK_VERSION} or newer expected`,
    );
  } else {
    push("ok", "@modelcontextprotocol/sdk", sdk);
  }

  const ts = installedVersion("typescript", cwd);
  if (ts === undefined) {
    push(
      "warn",
      "typescript",
      "not installed; the typed client is type-level only, so nothing is checked",
    );
  } else if (!versionAtLeast(ts, MIN_TYPESCRIPT_VERSION)) {
    push("warn", "typescript", `${ts} installed, ${MIN_TYPESCRIPT_VERSION} or newer expected`);
  } else {
    push("ok", "typescript", ts);
  }

  const configRel = opts.configPath ?? DEFAULT_CONFIG_PATH;
  const configPath = resolve(cwd, configRel);
  let config: McpTadaConfig | undefined;
  if (!existsSync(configPath)) {
    push("fail", configRel, "not found (run `mcp-tada init`, or pass --config)");
  } else {
    try {
      config = loadConfig(configPath);
      const n = Object.keys(config.servers).length;
      push(
        n === 0 ? "warn" : "ok",
        configRel,
        n === 0 ? "configures no servers" : `${n} server${n === 1 ? "" : "s"}`,
      );
    } catch (err) {
      push("fail", configRel, (err as Error).message);
    }
  }

  if (config !== undefined) {
    const outputs = new Map<string, string[]>();
    for (const [alias, entry] of Object.entries(config.servers)) {
      if (entry.output !== undefined) {
        const key = resolve(cwd, entry.output);
        outputs.set(key, [...(outputs.get(key) ?? []), alias]);
      }
    }
    for (const [output, aliases] of outputs) {
      if (aliases.length > 1) {
        push(
          "fail",
          aliases.join(", "),
          `share the output ${relative(cwd, output)}; each server needs its own`,
        );
      }
    }

    for (const [alias, entry] of Object.entries(config.servers)) {
      if (entry.command === undefined && entry.url === undefined) {
        push("fail", alias, 'has neither "command" nor "url"');
        continue;
      }
      let snapshot: ReturnType<typeof parseSnapshotText> | undefined;
      if (entry.output === undefined) {
        push(
          "warn",
          alias,
          'no "output"; introspect will write <alias>.introspection.d.ts in the current directory',
        );
      } else {
        const snapshotPath = resolve(cwd, entry.output);
        if (!existsSync(snapshotPath)) {
          push(
            "warn",
            alias,
            `snapshot ${entry.output} not found (run \`mcp-tada introspect ${alias}\`)`,
          );
        } else {
          try {
            snapshot = parseSnapshotText(
              readFileSync(snapshotPath, "utf8"),
              detectFormat(snapshotPath),
            );
            push(
              "ok",
              alias,
              `snapshot ${entry.output}, ${Object.keys(snapshot.tools).length} tools`,
            );
          } catch (err) {
            push(
              "fail",
              alias,
              `snapshot ${entry.output} cannot be read back (${(err as Error).message}); regenerate it, and keep formatters off it`,
            );
          }
        }
      }
      if (opts.connect === false) continue;
      try {
        const { meta, ...source } = await introspectTarget(toTarget(entry, opts.timeoutMs));
        const live = buildIntrospectionData(source);
        const name =
          meta.serverName !== undefined
            ? `${meta.serverName}@${meta.serverVersion ?? "?"}`
            : "server";
        const count = Object.keys(live.tools).length;
        if (snapshot === undefined) {
          push("ok", alias, `reachable: ${name}, ${count} tools`);
        } else if (diffIntrospection(snapshot, live).identical) {
          push("ok", alias, `reachable: ${name}, ${count} tools, snapshot up to date`);
        } else {
          push(
            "warn",
            alias,
            `reachable: ${name}, ${count} tools, snapshot differs (run \`mcp-tada check ${alias}\`)`,
          );
        }
      } catch (err) {
        push("fail", alias, `unreachable: ${(err as Error).message}`);
      }
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { checks, ok, text: formatDoctorReport(checks) };
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const lines = ["mcp-tada doctor"];
  for (const c of checks) lines.push(`  ${c.status.padEnd(4)}  ${c.subject}: ${c.detail}`);
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  lines.push(
    fails === 0 && warns === 0
      ? "all checks passed"
      : `${fails} failed, ${warns} warning${warns === 1 ? "" : "s"}`,
    "",
  );
  return lines.join("\n");
}
