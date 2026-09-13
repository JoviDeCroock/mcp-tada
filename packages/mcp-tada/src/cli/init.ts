// `mcp-tada init`: write an `mcp-tada.config.json` from the MCP servers a project already
// configures for its editor or agent, so the first `mcp-tada introspect` needs no flags.
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

export const DEFAULT_SKILLS_DIR = join(".claude", "skills");

/** The `skills/` directory shipped in the mcp-tada package (next to `dist/`). */
export function packagedSkillsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
}

export interface InstallSkillsOptions {
  /** Directory paths are resolved from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Where the skills go, relative to `cwd`. Defaults to `.claude/skills`. */
  dir?: string;
  /** Where the packaged skills are read from. Defaults to the installed package's `skills/`. */
  source?: string;
  /** Set false to skip writing to disk. */
  write?: boolean;
}

export interface InstallSkillsResult {
  /** Absolute path of the directory the skills were installed into. */
  dir: string;
  /** Skills linked (or copied, where symlinks are unavailable) into `dir`. */
  installed: string[];
  /** Skills already present in `dir`, left as they were. */
  skipped: string[];
}

/** Links each packaged agent skill (`mcp-tada-integration`, `mcp-tada-cli`, ...) into a
 * project's skills directory. A relative symlink keeps the skill current across upgrades; where
 * symlinks are unavailable (Windows without developer mode) the directory is copied instead.
 * Anything already at the target path is left alone. */
export function installSkills(opts: InstallSkillsOptions = {}): InstallSkillsResult {
  const cwd = opts.cwd ?? process.cwd();
  const source = opts.source ?? packagedSkillsDir();
  const dir = resolve(cwd, opts.dir ?? DEFAULT_SKILLS_DIR);
  if (!existsSync(source)) {
    throw new Error(`mcp-tada init: packaged skills not found at ${source}`);
  }
  const names = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(source, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  const installed: string[] = [];
  const skipped: string[] = [];
  const write = opts.write ?? true;
  if (write) mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const target = join(dir, name);
    if (existsSync(target)) {
      skipped.push(name);
      continue;
    }
    if (write) {
      // Relative so the link survives moving the project; from real paths so a symlinked
      // ancestor (macOS's /var -> /private/var, a linked workspace) cannot bend it.
      const link = relative(realpathSync(dir), realpathSync(join(source, name)));
      try {
        symlinkSync(link, target, "dir");
      } catch {
        cpSync(join(source, name), target, { recursive: true });
      }
    }
    installed.push(name);
  }
  return { dir, installed, skipped };
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
  /** Also install the packaged agent skills into `skillsDir` (default `.claude/skills`). */
  skills?: boolean;
  /** Where `skills` installs to, relative to `cwd`. */
  skillsDir?: string;
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
  /** Present when `skills` was requested. */
  skills?: InstallSkillsResult;
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
  const result: InitResult = { configPath, source, config, text, wrote, warnings };
  if (opts.skills) {
    result.skills = installSkills({
      cwd,
      ...(opts.skillsDir !== undefined ? { dir: opts.skillsDir } : {}),
      ...(opts.write !== undefined ? { write: opts.write } : {}),
    });
  }
  return result;
}
