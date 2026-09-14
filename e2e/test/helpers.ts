import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as StdioClientTransportV1 } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport as StreamableHTTPClientTransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

// The published stdio servers are pinned devDependencies of this package and run from
// node_modules, not `npx -y`: several test files spawn them concurrently, and parallel `npx`
// installs into a cold cache race each other into a half-installed tree.
export const FILESYSTEM_SERVER = join(
  e2eRoot,
  "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js",
);
export const MEMORY_SERVER = join(
  e2eRoot,
  "node_modules/@modelcontextprotocol/server-memory/dist/index.js",
);

/** Which SDK a helper builds its `Client` with; the typed client accepts either, and the v1 SDK
 * stays a devDependency here so the suites can prove it. */
export type SdkName = "v1" | "v2";

const clientInfo = { name: "mcp-tada-e2e", version: "0.0.0" };

/** Spawn a stdio server script with node. The SDK only passes a minimal environment to the child,
 * so anything the server reads from `process.env` must be given explicitly here. Its stderr is
 * dropped: a piped stream nobody reads would block the child once the buffer fills. */
export function connectStdio(
  script: string,
  args: string[],
  env?: Record<string, string>,
  sdk?: "v2",
): Promise<Client>;
export function connectStdio(
  script: string,
  args: string[],
  env: Record<string, string>,
  sdk: "v1",
): Promise<ClientV1>;
export async function connectStdio(
  script: string,
  args: string[],
  env: Record<string, string> = {},
  sdk: SdkName = "v2",
): Promise<Client | ClientV1> {
  const options = {
    command: process.execPath,
    args: [script, ...args],
    env: { ...getDefaultEnvironment(), ...env },
    stderr: "ignore" as const,
  };
  if (sdk === "v1") {
    const client = new ClientV1(clientInfo);
    await client.connect(new StdioClientTransportV1(options));
    return client;
  }
  const client = new Client(clientInfo);
  await client.connect(new StdioClientTransport(options));
  return client;
}

export function connectHttp(url: string, sdk?: "v2"): Promise<Client>;
export function connectHttp(url: string, sdk: "v1"): Promise<ClientV1>;
export async function connectHttp(url: string, sdk: SdkName = "v2"): Promise<Client | ClientV1> {
  if (sdk === "v1") {
    const client = new ClientV1(clientInfo);
    await client.connect(new StreamableHTTPClientTransportV1(new URL(url)));
    return client;
  }
  const client = new Client(clientInfo);
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
