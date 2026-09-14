// Loads whichever MCP SDK the project has installed, so the CLI works in a v1-only project
// (`@modelcontextprotocol/sdk`) as well as a v2-only one (`@modelcontextprotocol/client`), v2
// preferred when both are present. Everything else in the CLI goes through the `LoadedSdk`
// adapter, which normalises the handful of differences: import paths, error classes, and
// transport option names.
//
// Both SDKs are imported dynamically and only from `loadSdk`, never at module top level, so
// `mcp-tada --help` and `mcp-tada init` run with no SDK installed, and `doctor` gets to explain
// what is missing instead of Node failing the import first. Whether an SDK is installed is
// decided by resolving its entry specifier, the same way `import()` would from this file, so an
// SDK that is present but broken (a missing dependency of its own, say) surfaces its real error
// instead of being mistaken for an absent one.
import { versionNegotiationFor, type ProtocolMode } from "./protocol.js";
import type { ClientLike } from "../wire.js";

export type SdkChoice = "v1" | "v2";

export interface SdkInfo {
  choice: SdkChoice;
  packageName: string;
  /** The specifier whose resolution decides whether the SDK is installed. */
  entry: string;
  /** The oldest release the CLI is tested against; `doctor` warns below it. */
  minVersion: string;
}

export const SDKS: Record<SdkChoice, SdkInfo> = {
  v2: {
    choice: "v2",
    packageName: "@modelcontextprotocol/client",
    entry: "@modelcontextprotocol/client",
    minVersion: "2.0.0",
  },
  v1: {
    choice: "v1",
    packageName: "@modelcontextprotocol/sdk",
    entry: "@modelcontextprotocol/sdk/client/index.js",
    minVersion: "1.20.0",
  },
};

/** The order the CLI tries the SDKs in when nothing forces a choice. */
export const SDK_PREFERENCE: readonly SdkChoice[] = ["v2", "v1"];

/** The environment variable that forces `v1` or `v2` for the CLI. */
export const SDK_ENV = "MCP_TADA_SDK";

/** What the CLI needs from a transport: that it can be closed, and, for a stdio transport, the
 * child's pid, which stays readable after `close()` (see `rememberPid`). */
export interface CliTransport {
  close(): Promise<void>;
  pid?: number | null;
}

/** What the CLI needs from a client beyond `ClientLike`: connecting, closing, and the server's
 * identity as reported during the handshake. */
export interface CliClient extends ClientLike {
  connect(transport: CliTransport, options?: { timeout?: number }): Promise<void>;
  close(): Promise<void>;
  getServerVersion(): { name: string; version: string } | undefined;
}

export interface StdioTransportOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** One installed SDK behind a uniform surface. */
export interface LoadedSdk {
  choice: SdkChoice;
  createClient(info: { name: string; version: string }, protocol?: ProtocolMode): CliClient;
  stdioTransport(options: StdioTransportOptions): CliTransport;
  /** `headers`, when given, are sent on every request. */
  streamableHttpTransport(url: URL, headers: Record<string, string> | undefined): CliTransport;
  sseTransport(url: URL, headers: Record<string, string> | undefined): CliTransport;
  /** A request-timeout error as this SDK reports it (or a plain aborted fetch). */
  isTimeoutError(err: unknown): boolean;
  /** An HTTP 4xx from the streamable transport or the SSE fallback, the signal to try SSE. */
  isLikelyClientError(err: unknown): boolean;
}

/** A fetch implementation that injects fixed headers into every request. */
function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const merged = new Headers(init?.headers);
    for (const [k, v] of Object.entries(headers)) merged.set(k, v);
    return fetch(input, { ...init, headers: merged });
  };
}

// The streamable HTTP and SSE transports take the same options in both SDKs; only the SSE one
// nests the fetch override under `eventSourceInit`.
function httpOptions(headers: Record<string, string> | undefined) {
  return headers ? { requestInit: { headers }, fetch: fetchWithHeaders(headers) } : {};
}

function sseOptions(headers: Record<string, string> | undefined) {
  return headers
    ? { requestInit: { headers }, eventSourceInit: { fetch: fetchWithHeaders(headers) } }
    : {};
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function is4xx(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * Both SDKs' stdio transports forget their child once `close()` runs, and both SDKs'
 * `Client.connect` close the transport themselves when the handshake fails (a timeout, say). The
 * CLI then still has to make sure the child is gone (see `closeStdioHard` in `./connect.ts`), so
 * the pid is captured the moment the child is spawned and stays readable afterwards.
 */
function rememberPid<T extends { start(): Promise<void>; pid: number | null }>(transport: T): T {
  let spawned: number | null = null;
  const start = transport.start.bind(transport);
  const readPid = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(transport),
    "pid",
  )!.get!.bind(transport);
  transport.start = async () => {
    await start();
    spawned = readPid();
  };
  Object.defineProperty(transport, "pid", { get: () => spawned, configurable: true });
  return transport;
}

async function loadV2(): Promise<LoadedSdk> {
  const [sdk, stdio] = await Promise.all([
    import("@modelcontextprotocol/client"),
    import("@modelcontextprotocol/client/stdio"),
  ]);
  return {
    choice: "v2",
    createClient: (info, protocol) =>
      new sdk.Client(info, { versionNegotiation: versionNegotiationFor(protocol) }),
    stdioTransport: (options) => rememberPid(new stdio.StdioClientTransport(options)),
    streamableHttpTransport: (url, headers) =>
      new sdk.StreamableHTTPClientTransport(url, httpOptions(headers)),
    sseTransport: (url, headers) => new sdk.SSEClientTransport(url, sseOptions(headers)),
    isTimeoutError: (err) =>
      (err instanceof sdk.SdkError && err.code === sdk.SdkErrorCode.RequestTimeout) ||
      isAbortError(err),
    isLikelyClientError: (err) =>
      (err instanceof sdk.SdkHttpError && is4xx(err.status)) ||
      (err instanceof sdk.SseError && is4xx(err.code)),
  };
}

async function loadV1(): Promise<LoadedSdk> {
  const [client, stdio, streamable, sse, types] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/client/sse.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return {
    choice: "v1",
    createClient: (info, protocol) => {
      if (versionNegotiationFor(protocol).mode !== "legacy") {
        throw new Error(
          "mcp-tada: --protocol auto or a pinned revision requires @modelcontextprotocol/client (SDK v2); use --protocol legacy with SDK v1",
        );
      }
      return new client.Client(info);
    },
    stdioTransport: (options) => rememberPid(new stdio.StdioClientTransport(options)),
    streamableHttpTransport: (url, headers) =>
      new streamable.StreamableHTTPClientTransport(url, httpOptions(headers)),
    sseTransport: (url, headers) => new sse.SSEClientTransport(url, sseOptions(headers)),
    isTimeoutError: (err) =>
      (err instanceof types.McpError && err.code === types.ErrorCode.RequestTimeout) ||
      isAbortError(err),
    isLikelyClientError: (err) =>
      (err instanceof streamable.StreamableHTTPError && is4xx(err.code)) ||
      (err instanceof sse.SseError && is4xx(err.code)),
  };
}

function isInstalled(sdk: SdkInfo): boolean {
  try {
    import.meta.resolve(sdk.entry);
    return true;
  } catch {
    return false;
  }
}

/** The SDK the CLI will use when nothing forces a choice: the first of `SDK_PREFERENCE` that
 * resolves from here, or `undefined` when none is installed. */
export function detectSdk(): SdkInfo | undefined {
  for (const choice of SDK_PREFERENCE) {
    if (isInstalled(SDKS[choice])) return SDKS[choice];
  }
  return undefined;
}

function choiceFromEnv(): SdkChoice | undefined {
  const value = process.env[SDK_ENV];
  if (value === undefined || value === "") return undefined;
  if (value === "v1" || value === "v2") return value;
  throw new Error(`mcp-tada: ${SDK_ENV}=${JSON.stringify(value)} is not "v1" or "v2"`);
}

/**
 * The SDK to run on: `prefer` if given, else the `MCP_TADA_SDK` environment variable if set,
 * else whatever `detectSdk` finds. Rejects, naming both packages, when no SDK is installed.
 */
export async function loadSdk(prefer?: SdkChoice): Promise<LoadedSdk> {
  const choice = prefer ?? choiceFromEnv() ?? detectSdk()?.choice;
  if (choice === undefined) {
    throw new Error(
      `mcp-tada: no MCP SDK installed. The CLI needs ${SDKS.v2.packageName} (SDK v2) or ` +
        `${SDKS.v1.packageName} (v1); install one of them next to mcp-tada.`,
    );
  }
  return choice === "v2" ? loadV2() : loadV1();
}
