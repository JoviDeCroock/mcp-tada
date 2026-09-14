// Shared fixture for the runtime suites: server-everything spawned over stdio behind a `Client`
// from either SDK, so a suite can run once per SDK (or mix the two) without repeating the
// connection boilerplate.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client as ClientV2 } from "@modelcontextprotocol/client";
import { StdioClientTransport as StdioClientTransportV2 } from "@modelcontextprotocol/client/stdio";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport as StdioClientTransportV1 } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ClientLike } from "../src/index.js";

export const serverPath = fileURLToPath(
  new URL("../node_modules/@modelcontextprotocol/server-everything/dist/index.js", import.meta.url),
);
export const serverAvailable = existsSync(serverPath);

/** `close` is the one method beyond `ClientLike` the suites need. */
export type SdkClient = ClientLike & { close(): Promise<void> };

export type SdkName = "v1" | "v2";

export async function connectEverything(sdk: SdkName, name = "mcp-tada-test"): Promise<SdkClient> {
  const info = { name, version: "0.0.0" };
  const stdio = { command: "node", args: [serverPath] };
  if (sdk === "v2") {
    const client = new ClientV2(info);
    await client.connect(new StdioClientTransportV2(stdio));
    return client;
  }
  const client = new ClientV1(info);
  await client.connect(new StdioClientTransportV1(stdio));
  return client;
}

/** One row per SDK, for `describe.each`. */
export const sdks: { sdk: SdkName; label: string }[] = [
  { sdk: "v2", label: "v2 @modelcontextprotocol/client" },
  { sdk: "v1", label: "v1 @modelcontextprotocol/sdk" },
];
