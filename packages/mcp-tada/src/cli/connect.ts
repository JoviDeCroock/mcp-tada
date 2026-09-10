// Building blocks for connecting an MCP SDK Client to a target server, from either
// CLI flags or a config file. Used by both `introspect` and `check`.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/** Applied to connecting and to each `tools/list` request when no `--timeout` is given and the
 * config file sets no `timeoutMs` for the server. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Where to reach a single MCP server: stdio (command/args/env) or HTTP (url/headers). */
export interface ServerTarget {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Timeout (ms) applied to connecting and to each `tools/list` request. Callers should default
   * this to `DEFAULT_TIMEOUT_MS` when building a `ServerTarget`; `connectClient` does not apply
   * its own default so that "unset" and "explicitly 30000" stay distinguishable upstream. */
  timeoutMs?: number;
}

/** One entry of an mcp-tada config file's "servers" map (or a normalized mcpServers entry). */
export interface ServerConfigEntry extends ServerTarget {
  output?: string;
}

export interface McpTadaConfig {
  servers: Record<string, ServerConfigEntry>;
}

/** Split a shell-like command line into tokens, honoring single/double quotes. */
export function splitCommandLine(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

/** Parse "KEY=VALUE" as used by repeated --env flags. */
export function parseEnvFlag(input: string): [string, string] {
  const idx = input.indexOf("=");
  if (idx === -1) {
    throw new Error(`Invalid --env value ${JSON.stringify(input)}, expected KEY=VALUE`);
  }
  return [input.slice(0, idx), input.slice(idx + 1)];
}

/** Parse "Name: Value" as used by repeated --header flags. */
export function parseHeaderFlag(input: string): [string, string] {
  const idx = input.indexOf(":");
  if (idx === -1) {
    throw new Error(`Invalid --header value ${JSON.stringify(input)}, expected "Name: Value"`);
  }
  return [input.slice(0, idx).trim(), input.slice(idx + 1).trim()];
}

/** Load a config file, normalizing either mcp-tada's own shape or a Claude/Cursor `mcpServers` block. */
export function loadConfig(path: string): McpTadaConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const block = (raw["servers"] ?? raw["mcpServers"]) as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!block || typeof block !== "object") {
    throw new Error(`Config file ${path} has neither a "servers" nor an "mcpServers" object`);
  }
  const servers: Record<string, ServerConfigEntry> = {};
  for (const [alias, entry] of Object.entries(block)) {
    const command = typeof entry["command"] === "string" ? (entry["command"] as string) : undefined;
    const args = Array.isArray(entry["args"]) ? (entry["args"] as string[]) : undefined;
    const env =
      entry["env"] && typeof entry["env"] === "object"
        ? (entry["env"] as Record<string, string>)
        : undefined;
    const url = typeof entry["url"] === "string" ? (entry["url"] as string) : undefined;
    const headers =
      entry["headers"] && typeof entry["headers"] === "object"
        ? (entry["headers"] as Record<string, string>)
        : undefined;
    const output = typeof entry["output"] === "string" ? (entry["output"] as string) : undefined;
    const timeoutMs =
      typeof entry["timeoutMs"] === "number" ? (entry["timeoutMs"] as number) : undefined;
    const normalized: ServerConfigEntry = {};
    if (command !== undefined) normalized.command = command;
    if (args !== undefined) normalized.args = args;
    if (env !== undefined) normalized.env = env;
    if (url !== undefined) normalized.url = url;
    if (headers !== undefined) normalized.headers = headers;
    if (output !== undefined) normalized.output = output;
    if (timeoutMs !== undefined) normalized.timeoutMs = timeoutMs;
    servers[alias] = normalized;
  }
  return { servers };
}

/** A fetch implementation that injects fixed headers into every request. */
function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const merged = new Headers(init?.headers);
    for (const [k, v] of Object.entries(headers)) merged.set(k, v);
    return fetch(input, { ...init, headers: merged });
  };
}

export interface ConnectedClient {
  client: Client;
  transport: Transport;
  kind: "stdio" | "streamable-http" | "sse";
}

export interface ConnectOptions {
  clientName?: string;
  clientVersion?: string;
}

/** A short, human-readable name for a target, for error messages ("filesystem timed out..."). */
export function describeTarget(target: ServerTarget): string {
  if (target.url) return target.url;
  if (target.command) return target.command;
  return "target";
}

/** True for an `McpError` with code `RequestTimeout`, or a `DOMException`/`Error` produced by an
 * aborted-on-timeout fetch (the streamable HTTP / SSE transports surface those as plain aborts
 * rather than wrapping them in an `McpError`). */
function isTimeoutError(err: unknown): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.RequestTimeout;
  if (err instanceof Error) return err.name === "AbortError" || err.name === "TimeoutError";
  return false;
}

/** Best-effort close; swallows errors since we're already handling a different failure. */
async function closeQuietly(transport: Transport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // already failing for another reason; nothing more to do here
  }
}

/**
 * Close a stdio transport whose handshake failed, and make sure the child is gone. The SDK's
 * `close()` ends stdin and only escalates to SIGTERM after a 2s grace period; if the calling
 * process exits before that (a CI step or a test runner tearing down), the child is orphaned and
 * keeps any inherited stdio pipe open. A server that never completed the handshake has nothing to
 * flush, so kill it outright once `close()` has had its chance.
 */
async function closeStdioHard(stdio: StdioClientTransport): Promise<void> {
  const pid = stdio.pid;
  await closeQuietly(stdio);
  if (pid === null || pid === undefined) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already exited
  }
}

/** Wraps a connect/list failure so it names the target: a timeout reads as such, and any other
 * failure (a bare `fetch failed`, a spawn error) carries the target and the underlying cause. */
function wrapConnectError(err: unknown, target: ServerTarget): unknown {
  if (isTimeoutError(err)) {
    const ms = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Error(`mcp-tada: connecting to "${describeTarget(target)}" timed out after ${ms}ms`);
  }
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined;
  const detail = cause && !message.includes(cause) ? `${message} (${cause})` : message;
  return new Error(`mcp-tada: connecting to "${describeTarget(target)}" failed: ${detail}`, {
    cause: err,
  });
}

/** Build and connect an SDK Client for the given target, stdio or HTTP (with SSE fallback).
 * `target.timeoutMs` (when set) is applied to the connect handshake; on timeout the transport is
 * closed and the rejection names the target. */
export async function connectClient(
  target: ServerTarget,
  opts: ConnectOptions = {},
): Promise<ConnectedClient> {
  const client = new Client({
    name: opts.clientName ?? "mcp-tada-cli",
    version: opts.clientVersion ?? "0.0.0",
  });
  const requestOptions: RequestOptions | undefined =
    target.timeoutMs !== undefined ? { timeout: target.timeoutMs } : undefined;

  if (target.url) {
    const url = new URL(target.url);
    const headers = target.headers ?? {};
    const hasHeaders = Object.keys(headers).length > 0;
    const streamable = new StreamableHTTPClientTransport(url, {
      ...(hasHeaders ? { requestInit: { headers } } : {}),
      ...(hasHeaders ? { fetch: fetchWithHeaders(headers) } : {}),
    });
    try {
      // The SDK's own StreamableHTTPClientTransport doesn't satisfy its Transport type under
      // exactOptionalPropertyTypes (sessionId is `string | undefined` vs `string`); cast at
      // this boundary rather than relaxing our own tsconfig.
      await client.connect(streamable as unknown as Transport, requestOptions);
      return { client, transport: streamable as unknown as Transport, kind: "streamable-http" };
    } catch (err) {
      if (!isLikelyClientError(err)) {
        await closeQuietly(streamable as unknown as Transport);
        throw wrapConnectError(err, target);
      }
      // Fall back to the deprecated SSE transport for older servers, per SDK guidance.
      const sse = new SSEClientTransport(url, {
        ...(hasHeaders ? { requestInit: { headers } } : {}),
        ...(hasHeaders ? { eventSourceInit: { fetch: fetchWithHeaders(headers) } } : {}),
      });
      try {
        await client.connect(sse, requestOptions);
        return { client, transport: sse, kind: "sse" };
      } catch (err2) {
        await closeQuietly(sse);
        throw wrapConnectError(err2, target);
      }
    }
  }

  if (target.command) {
    const [command, ...baseArgs] = splitCommandLine(target.command);
    if (!command) {
      throw new Error("Empty --command / --stdio value");
    }
    const args = [...baseArgs, ...(target.args ?? [])];
    const stdio = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...target.env } as Record<string, string>,
    });
    try {
      await client.connect(stdio, requestOptions);
      return { client, transport: stdio, kind: "stdio" };
    } catch (err) {
      await closeStdioHard(stdio);
      throw wrapConnectError(err, target);
    }
  }

  throw new Error("No target specified: pass --command/--stdio or --url (or --config)");
}

/** Wraps a `tools/list` failure the same way `connectClient` wraps a connect failure: a timeout
 * closes the transport and rejects with a clear, target-naming error. */
export async function withTimeoutWrapping<T>(
  target: ServerTarget,
  transport: Transport,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isTimeoutError(err)) {
      if (transport instanceof StdioClientTransport) await closeStdioHard(transport);
      else await closeQuietly(transport);
      throw wrapConnectError(err, target);
    }
    throw err;
  }
}

function isLikelyClientError(err: unknown): boolean {
  if (err instanceof StreamableHTTPError) {
    return err.code !== undefined && err.code >= 400 && err.code < 500;
  }
  if (err instanceof SseError) {
    return err.code !== undefined && err.code >= 400 && err.code < 500;
  }
  return false;
}

/** Best-effort read of the negotiated protocol version; not all transports expose it. */
export function getNegotiatedProtocolVersion(transport: Transport): string | undefined {
  const withVersion = transport as unknown as { protocolVersion?: string };
  return withVersion.protocolVersion;
}
