// `mcp-tada init`: write an `mcp-tada.config.json` from the MCP servers a project already
// configures for its editor or agent, so the first `mcp-tada introspect` needs no flags.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { loadConfig, type McpTadaConfig, type ServerConfigEntry } from "./connect.js";
import { writeIfChanged } from "./introspect.js";

export const DEFAULT_CONFIG_PATH = "mcp-tada.config.json";

/** Files consulted, in order, when `--from` is not given. Project files first, then the user's
 * Claude Desktop config, so a project-scoped server list wins over a machine-wide one. */
export function candidateSources(cwd: string, platform = process.platform, home = homedir()) {
  const project = [".mcp.json", join(".cursor", "mcp.json"), join(".vscode", "mcp.json")].map((p) =>
    join(cwd, p),
  );
  const desktop =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : platform === "win32"
        ? join(
            process.env["APPDATA"] ?? join(home, "AppData", "Roaming"),
            "Claude",
            "claude_desktop_config.json",
          )
        : join(
            process.env["XDG_CONFIG_HOME"] ?? join(home, ".config"),
            "Claude",
            "claude_desktop_config.json",
          );
  return [...project, desktop];
}

export interface InitOptions {
  /** Directory the config is written to and paths are resolved from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** A specific file to import servers from, instead of searching the candidates. */
  from?: string;
  /** Where each server's snapshot goes, relative to `cwd`. Defaults to `src` when it exists. */
  outDir?: string;
  /** Path of the config to write, relative to `cwd`. Defaults to `mcp-tada.config.json`. */
  configPath?: string;
  /** Overwrite an existing config. */
  force?: boolean;
  /** Set false to skip writing to disk. */
  write?: boolean;
}

export interface InitResult {
  configPath: string;
  /** The file the servers were imported from. */
  source: string;
  config: McpTadaConfig;
  text: string;
  wrote: boolean;
  /** Human-readable notes, e.g. env values that were copied verbatim. */
  warnings: string[];
}

const secretLike = /key|token|secret|password|authorization|credential/i;

function snapshotFileName(alias: string): string {
  return `${alias.replace(/[^A-Za-z0-9._-]+/g, "-")}.introspection.d.ts`;
}

/** Import servers from an existing MCP config and write `mcp-tada.config.json`. Throws when the
 * config already exists (without `force`) or when no source can be found. */
export function init(opts: InitOptions = {}): InitResult {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = resolve(cwd, opts.configPath ?? DEFAULT_CONFIG_PATH);
  if (existsSync(configPath) && !opts.force) {
    throw new Error(
      `mcp-tada init: ${relative(cwd, configPath) || configPath} already exists (pass --force to overwrite)`,
    );
  }

  let source: string | undefined;
  if (opts.from !== undefined) {
    source = resolve(cwd, opts.from);
    if (!existsSync(source)) throw new Error(`mcp-tada init: ${opts.from} does not exist`);
  } else {
    const candidates = candidateSources(cwd);
    source = candidates.find((p) => existsSync(p));
    if (source === undefined) {
      throw new Error(
        `mcp-tada init: no MCP config found. Looked for:\n${candidates.map((p) => `  ${p}`).join("\n")}\n` +
          `Pass --from <path> to import a specific file.`,
      );
    }
  }

  const imported = loadConfig(source);
  const aliases = Object.keys(imported.servers);
  if (aliases.length === 0) {
    throw new Error(`mcp-tada init: ${source} configures no servers`);
  }

  const outDir = opts.outDir ?? (existsSync(join(cwd, "src")) ? "src" : ".");
  const warnings: string[] = [];
  const servers: Record<string, ServerConfigEntry> = {};
  for (const alias of aliases) {
    const entry = imported.servers[alias] as ServerConfigEntry;
    if (entry.command === undefined && entry.url === undefined) {
      warnings.push(`${alias}: skipped, it has neither "command" nor "url"`);
      continue;
    }
    const secrets = [...Object.keys(entry.env ?? {}), ...Object.keys(entry.headers ?? {})].filter(
      (k) => secretLike.test(k),
    );
    if (secrets.length > 0) {
      warnings.push(
        `${alias}: copied ${secrets.join(", ")} verbatim; keep secrets out of a committed config`,
      );
    }
    const { output: _ignored, ...rest } = entry;
    const output = join(outDir, snapshotFileName(alias)).split("\\").join("/");
    servers[alias] = { ...rest, output: output.startsWith("./") ? output.slice(2) : output };
  }
  if (Object.keys(servers).length === 0) {
    throw new Error(
      `mcp-tada init: none of the servers in ${source} can be reached (no command or url)`,
    );
  }

  const config: McpTadaConfig = { servers };
  const text = `${JSON.stringify(config, null, 2)}\n`;
  const wrote = (opts.write ?? true) ? writeIfChanged(configPath, text) : false;
  return { configPath, source, config, text, wrote, warnings };
}
