import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig, parseDtsSnapshot, type IntrospectionData } from "mcp-tada/cli";
import { validate } from "mcp-tada-server";
import { expect } from "vitest";

export const e2eRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const configPath = join(e2eRoot, "mcp-tada.config.json");

/** Every server in `mcp-tada.config.json`, with its committed snapshot path made absolute. */
export function configuredServers() {
  const { servers } = loadConfig(configPath);
  return Object.entries(servers).map(([alias, entry]) => ({
    alias,
    target: entry,
    output: join(e2eRoot, entry.output ?? `${alias}.introspection.d.ts`),
  }));
}

/** The committed snapshot for one server, parsed back to data. */
export function committedSnapshot(alias: string): IntrospectionData {
  const server = configuredServers().find((s) => s.alias === alias);
  if (!server) throw new Error(`no configured server named ${alias}`);
  return parseDtsSnapshot(readFileSync(server.output, "utf8"));
}

// The published stdio servers, pinned so an upstream release cannot fail the drift check.
export const FILESYSTEM_SERVER = "@modelcontextprotocol/server-filesystem@2026.8.31";
export const MEMORY_SERVER = "@modelcontextprotocol/server-memory@2026.8.31";

/** Spawn a stdio server. The SDK only passes a minimal environment to the child, so anything the
 * server reads from `process.env` must be given explicitly here. Its stderr is dropped: `npx -y`
 * is chatty there, and a piped stream nobody reads would block the child once the buffer fills. */
export async function connectStdio(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<Client> {
  const client = new Client({ name: "mcp-tada-e2e", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command,
      args,
      env: { ...getDefaultEnvironment(), ...env },
      stderr: "ignore",
    }),
  );
  return client;
}

export async function connectHttp(url: string): Promise<Client> {
  const client = new Client({ name: "mcp-tada-e2e", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

/**
 * The contract every typed call rests on: what the server actually sent back as
 * `structuredContent` satisfies the `outputSchema` the snapshot typed it from. Checked with the
 * same validator `mcp-tada-server` uses on the wire.
 */
export function expectStructuredContentToMatch(
  snapshot: IntrospectionData,
  tool: string,
  structuredContent: unknown,
): void {
  const entry = snapshot.tools[tool];
  if (!entry) throw new Error(`snapshot has no tool named ${tool}`);
  if (entry.outputSchema === undefined) throw new Error(`${tool} declares no outputSchema`);
  expect(validate(entry.outputSchema, structuredContent)).toEqual([]);
}

// `typescript`'s exports map does not expose `bin/tsc`, so locate it next to package.json.
const require = createRequire(import.meta.url);
const tscBin = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const execFileAsync = promisify(execFile);

export interface CompileResult {
  diagnostics: string;
  instantiations: number;
}

/**
 * Compiles a freshly generated snapshot together with a probe that forces every derived type
 * (`ToolArgs`, `ToolOutput`, `PromptNames`, the `readOnly` view) to be fully evaluated through
 * declaration emit. Returns tsc's diagnostics text (empty on success) and its instantiation
 * count from `--extendedDiagnostics`.
 */
export async function compileSnapshot(alias: string, snapshotText: string): Promise<CompileResult> {
  const dir = join(e2eRoot, "generated", alias);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "introspection.d.ts"), snapshotText);
  writeFileSync(
    join(dir, "probe.ts"),
    `import { initMcpTada, readOnly } from "mcp-tada";
import type { PromptArgs, PromptNames, ToolArgs, ToolNames, ToolOutput } from "mcp-tada";
import type { introspection } from "./introspection.js";

type Names = ToolNames<introspection>;
export type Args = { [N in Names]: ToolArgs<introspection, N> };
export type Outputs = { [N in Names]: ToolOutput<introspection, N> };
export type Prompts = { [N in PromptNames<introspection>]: PromptArgs<introspection, N> };
export const typed = initMcpTada<introspection>().typed(undefined as never);
export const safe = readOnly(typed);
`,
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: "../../tsconfig.json",
        compilerOptions: {
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: "out",
        },
        include: ["probe.ts", "introspection.d.ts"],
      },
      null,
      2,
    ),
  );

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      process.execPath,
      [tscBin, "-p", join(dir, "tsconfig.json"), "--extendedDiagnostics"],
      { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const diagnostics = (e.stdout ?? "") + (e.stderr ?? "");
    return { diagnostics: diagnostics.trim() || e.message, instantiations: -1 };
  }
  const match = /Instantiations:\s+([\d,]+)/.exec(stdout);
  const instantiations = match ? Number(match[1]!.replace(/,/g, "")) : -1;
  const errors = stdout
    .split("\n")
    .filter((line) => /error TS\d+/.test(line))
    .join("\n");
  return { diagnostics: errors, instantiations };
}
