#!/usr/bin/env node
// mcp-tada CLI entry point: `introspect` and `check` subcommands, plus --help/--version.
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TIMEOUT_MS,
  loadConfig,
  parseEnvFlag,
  parseHeaderFlag,
  splitCommandLine,
  type ServerConfigEntry,
  type ServerTarget,
} from "./connect.js";
import { introspect } from "./introspect.js";
import { check } from "./check.js";
import { init } from "./init.js";
import { doctor } from "./doctor.js";

const HELP = `mcp-tada: typed tool calls derived from a live server's tools/list

Usage:
  mcp-tada init [--from <path>] [--out-dir <dir>] [--force]
  mcp-tada doctor [--config <path>] [--offline] [--timeout <ms>]
  mcp-tada introspect [target flags] [--out <path>] [--name <TypeName>] [--json] [--verbose]
  mcp-tada check [target flags] --against <path>
  mcp-tada --help
  mcp-tada --version

init writes mcp-tada.config.json from the servers in .mcp.json, .cursor/mcp.json, .vscode/mcp.json
or the Claude Desktop config (first found), or from --from <path>. doctor checks installed
versions, the config, every snapshot, and (unless --offline) that each server answers.

Target flags (one of):
  --command "node server.js"     stdio server, whitespace-split like --stdio
  --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp"
  --arg <value>                  extra stdio arg, repeatable, appended after --command/--stdio
  --env KEY=VALUE                stdio env var, repeatable, merged over the inherited environment
  --url https://example.com/mcp  HTTP server (StreamableHTTP, falling back to SSE on 4xx)
  --header "Authorization: Bearer x"   HTTP header, repeatable
  --config <path>                mcp-tada.config.json, or a Claude/Cursor mcpServers file;
                                  with no other target flags, introspects every configured server
                                  (or just [alias] if given as a positional argument)
  --timeout <ms>                 connect and tools/list timeout, default 30000 (overrides a
                                  server's "timeoutMs" in --config)

With --config and more than one server selected, --out is rejected: it would make every server
overwrite the same file. Use each server's "output" in the config, or select one alias.

See docs/cli.md for the config file format and more examples.`;

interface TargetFlagValues {
  command?: string;
  stdio?: string;
  arg?: string[];
  env?: string[];
  url?: string;
  header?: string[];
  config?: string;
  timeout?: string;
}

const TARGET_OPTIONS = {
  command: { type: "string" },
  stdio: { type: "string" },
  arg: { type: "string", multiple: true },
  env: { type: "string", multiple: true },
  url: { type: "string" },
  header: { type: "string", multiple: true },
  config: { type: "string" },
  timeout: { type: "string" },
} as const;

/** Parses `--timeout`, throwing a plain `Error` (no stack noise) on a non-positive-integer value. */
function parseTimeoutFlag(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `Invalid --timeout value ${JSON.stringify(value)}, expected a positive number of milliseconds`,
    );
  }
  return ms;
}

function targetFromFlags(values: TargetFlagValues): ServerTarget | undefined {
  if (!values.command && !values.stdio && !values.url) return undefined;
  const target: ServerTarget = {};
  const base = values.stdio ?? values.command;
  if (base) {
    const [command, ...baseArgs] = splitCommandLine(base);
    if (command) target.command = command;
    const args = [...baseArgs, ...(values.arg ?? [])];
    if (args.length > 0) target.args = args;
  } else if (values.arg && values.arg.length > 0) {
    target.args = values.arg;
  }
  if (values.env && values.env.length > 0) {
    target.env = Object.fromEntries(values.env.map(parseEnvFlag));
  }
  if (values.url) target.url = values.url;
  if (values.header && values.header.length > 0) {
    target.headers = Object.fromEntries(values.header.map(parseHeaderFlag));
  }
  target.timeoutMs = parseTimeoutFlag(values.timeout) ?? DEFAULT_TIMEOUT_MS;
  return target;
}

function configEntryToTarget(
  entry: ServerConfigEntry,
  timeoutFlagMs: number | undefined,
): ServerTarget {
  const target: ServerTarget = {};
  if (entry.command !== undefined) target.command = entry.command;
  if (entry.args !== undefined) target.args = entry.args;
  if (entry.env !== undefined) target.env = entry.env;
  if (entry.url !== undefined) target.url = entry.url;
  if (entry.headers !== undefined) target.headers = entry.headers;
  target.timeoutMs = timeoutFlagMs ?? entry.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return target;
}

/** Parsed `mcp-tada introspect` flags, independent of `node:util`'s `parseArgs` value shape, so
 * this can be driven directly from tests without spawning the CLI. */
export interface RunIntrospectArgs extends TargetFlagValues {
  out?: string;
  name?: string;
  json?: boolean;
  verbose?: boolean;
  help?: boolean;
  aliasFilter?: string | undefined;
}

/** Core of `mcp-tada introspect`, factored out of argv parsing so it's directly testable. */
export async function runIntrospectWith(values: RunIntrospectArgs): Promise<number> {
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  let timeoutMs: number | undefined;
  try {
    timeoutMs = parseTimeoutFlag(values.timeout);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const explicitTarget = targetFromFlags(values);
  if (explicitTarget) {
    const result = await introspect({
      target: explicitTarget,
      ...(values.out !== undefined ? { out: values.out } : {}),
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.json !== undefined ? { json: values.json } : {}),
      ...(values.verbose !== undefined ? { verbose: values.verbose } : {}),
    });
    if (values.json) console.log(result.text);
    return 0;
  }

  const configPath =
    values.config ?? (existsSync("mcp-tada.config.json") ? "mcp-tada.config.json" : undefined);
  if (!configPath) {
    console.error(
      "mcp-tada introspect: no target specified. Pass --command/--stdio/--url, or --config.",
    );
    console.error(HELP);
    return 1;
  }
  const config = loadConfig(configPath);
  const aliasFilter = values.aliasFilter;
  const aliases = aliasFilter ? [aliasFilter] : Object.keys(config.servers);
  if (aliasFilter && !config.servers[aliasFilter]) {
    console.error(`mcp-tada introspect: no server "${aliasFilter}" in ${configPath}`);
    return 1;
  }
  if (values.out !== undefined && aliases.length > 1) {
    console.error(
      `mcp-tada introspect: --out cannot be used with ${aliases.length} servers selected from ${configPath} ` +
        `(every server would overwrite the same file). Pass a server alias to select one, or rely on each ` +
        `server's "output" in the config.`,
    );
    return 1;
  }
  for (const alias of aliases) {
    const entry = config.servers[alias];
    if (!entry) continue;
    const out =
      values.out ?? entry.output ?? `${alias}.introspection.${values.json ? "json" : "d.ts"}`;
    console.error(`mcp-tada introspect: ${alias}`);
    const result = await introspect({
      target: configEntryToTarget(entry, timeoutMs),
      out,
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.json !== undefined ? { json: values.json } : {}),
      ...(values.verbose !== undefined ? { verbose: values.verbose } : {}),
    });
    if (values.json) console.log(result.text);
  }
  return 0;
}

async function runIntrospect(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      ...TARGET_OPTIONS,
      out: { type: "string" },
      name: { type: "string" },
      json: { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  return runIntrospectWith({ ...values, aliasFilter: positionals[0] });
}

export interface RunCheckArgs extends TargetFlagValues {
  against?: string;
  help?: boolean;
  aliasFilter?: string | undefined;
}

/** Core of `mcp-tada check`, factored out of argv parsing so it's directly testable. */
export async function runCheckWith(values: RunCheckArgs): Promise<number> {
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  let timeoutMs: number | undefined;
  try {
    timeoutMs = parseTimeoutFlag(values.timeout);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const explicitTarget = targetFromFlags(values);
  if (explicitTarget) {
    if (!values.against) {
      console.error("mcp-tada check: --against <path> is required");
      return 1;
    }
    const { report, text } = await check({ target: explicitTarget, against: values.against });
    process.stdout.write(text);
    return report.identical ? 0 : 1;
  }

  const configPath =
    values.config ?? (existsSync("mcp-tada.config.json") ? "mcp-tada.config.json" : undefined);
  if (!configPath) {
    console.error(
      "mcp-tada check: no target specified. Pass --command/--stdio/--url, or --config.",
    );
    return 1;
  }
  const config = loadConfig(configPath);
  const aliasFilter = values.aliasFilter;
  const aliases = aliasFilter ? [aliasFilter] : Object.keys(config.servers);
  if (aliasFilter && !config.servers[aliasFilter]) {
    console.error(`mcp-tada check: no server "${aliasFilter}" in ${configPath}`);
    return 1;
  }
  let anyDiff = false;
  for (const alias of aliases) {
    const entry = config.servers[alias];
    if (!entry) continue;
    const against = values.against ?? entry.output;
    if (!against) {
      console.error(
        `mcp-tada check: ${alias} has no "output" in ${configPath} and no --against was given`,
      );
      anyDiff = true;
      continue;
    }
    const { report, text } = await check({
      target: configEntryToTarget(entry, timeoutMs),
      against,
    });
    process.stdout.write(text);
    if (!report.identical) anyDiff = true;
  }
  return anyDiff ? 1 : 0;
}

async function runCheck(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      ...TARGET_OPTIONS,
      against: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  return runCheckWith({ ...values, aliasFilter: positionals[0] });
}

export interface RunInitArgs {
  from?: string;
  "out-dir"?: string;
  force?: boolean;
  config?: string;
  help?: boolean;
}

/** Core of `mcp-tada init`: import servers into a config and print what to do next. */
export function runInitWith(values: RunInitArgs): number {
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  let result;
  try {
    result = init({
      ...(values.from !== undefined ? { from: values.from } : {}),
      ...(values["out-dir"] !== undefined ? { outDir: values["out-dir"] } : {}),
      ...(values.config !== undefined ? { configPath: values.config } : {}),
      ...(values.force !== undefined ? { force: values.force } : {}),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const aliases = Object.keys(result.config.servers);
  console.error(`mcp-tada init: imported ${aliases.join(", ")} from ${result.source}`);
  for (const warning of result.warnings) console.error(`mcp-tada init: ${warning}`);
  console.error(
    "\nNext:\n  mcp-tada introspect        # write each server's snapshot\n" +
      "  mcp-tada check             # in CI, fail when a server drifts from its snapshot",
  );
  return 0;
}

async function runInit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: "string" },
      "out-dir": { type: "string" },
      force: { type: "boolean" },
      config: { type: "string" },
      help: { type: "boolean" },
    },
  });
  return runInitWith(values);
}

export interface RunDoctorArgs {
  config?: string;
  offline?: boolean;
  timeout?: string;
  help?: boolean;
}

/** Core of `mcp-tada doctor`: exit 1 when any check fails; warnings alone exit 0. */
export async function runDoctorWith(values: RunDoctorArgs): Promise<number> {
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  let timeoutMs: number | undefined;
  try {
    timeoutMs = parseTimeoutFlag(values.timeout);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const result = await doctor({
    ...(values.config !== undefined ? { configPath: values.config } : {}),
    ...(values.offline ? { connect: false } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  process.stdout.write(result.text);
  return result.ok ? 0 : 1;
}

async function runDoctor(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      offline: { type: "boolean" },
      timeout: { type: "string" },
      help: { type: "boolean" },
    },
  });
  return runDoctorWith(values);
}

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return 0;
  }
  if (sub === "--version" || sub === "-v") {
    console.log(readVersion());
    return 0;
  }
  switch (sub) {
    case "init":
      return runInit(rest);
    case "doctor":
      return runDoctor(rest);
    case "introspect":
      return runIntrospect(rest);
    case "check":
      return runCheck(rest);
    default:
      console.error(`mcp-tada: unknown command "${sub}"`);
      console.error(HELP);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
