// The same typed client on the v1 SDK (`@modelcontextprotocol/sdk`). The server, the snapshot and
// `initMcpTada` are unchanged; only the `Client` class and transport come from a different
// package, which is how a project still on v1 keeps using mcp-tada. Run with `pnpm start:v1`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./notes.introspection.js";

const client = new Client({ name: "notes-example-v1", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [new URL("./server.js", import.meta.url).pathname],
    stderr: "pipe",
  }),
);
const notes = initMcpTada<introspection>().typed(client);

const added = await notes.callTool("add_note", { title: "From v1", body: "same types" });
if (added.isError) throw new Error("add_note failed");
console.log("added note", added.structuredContent.id, added.structuredContent.title);

// Per-call options reach v1's third `callTool` argument: a 10s timeout here.
const all = await notes.tools.list_notes(undefined, { timeout: 10_000 });
if (!all.isError)
  console.log(
    "stored notes:",
    all.structuredContent.notes.map((n) => n.title),
  );

// `client` keeps its concrete v1 type, so the rest of the SDK stays reachable.
console.log("server:", notes.client.getServerVersion()?.name);
await client.close();
